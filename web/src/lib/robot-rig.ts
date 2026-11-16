import { POSE_MS, type MascotPose } from '@/lib/mascot-context'

/**
 * The motion of jojo's robot, as numbers — no three.js in here.
 *
 * The robot is an artist's rigged model ("Sci-fi O.B. Robot Unit TH-ICC02" by
 * Jungle Jim, CC BY 4.0 — see `scripts/robot/prepare_model.py`), and this
 * module is everything about how it MOVES that can be stated without a
 * renderer: the gesture curves for its whole body, its skeleton and its drawn
 * eyes; where the head looks for a given pointer; and the smoothing that joins
 * them. Pure, so every rule here is tested offline (D20: nothing mounts a
 * component).
 *
 * ## Axes
 *
 * Every rotation is written in the robot's own frame, the same for every
 * bone, whatever the rig's local axes happen to be (RobotScene converts):
 *
 *   x  positive tips the top FORWARD — a nod, a bow
 *   y  positive turns toward +x — the robot's left, the viewer's right
 *   z  positive raises the +x side — rolls toward the robot's right
 *
 * The robot's left arm is at +x, so raising it sideways is +z; `both()` writes
 * the left side and mirrors the right (x kept, y and z negated). Swinging an
 * arm forward, or bending an elbow, is −x on either side.
 *
 * ## Arms move (Q033, revised)
 *
 * The first rule was "body only": arm gestures on the old Spline robot read as
 * a limb flailing near a robot. With a real skeleton the owner asked for the
 * arms back in the dance and in new moves (2026-11-15). Of the five gestures
 * they dropped, Hello came back as Hi at their request; Thumbs up, Head
 * scratch, Thinking and Excited stay dropped.
 */

/** Old scene units to this scene's: about one centimetre. */
export const U = 0.01

/** The bones a gesture may drive, by role. Names are the rig's (`BONE_NAMES`). */
export const BONE_KEYS = [
  'hips',
  'waist',
  'chest',
  'neck',
  'head',
  'lShoulder',
  'lUpper',
  'lFore',
  'lHand',
  'rShoulder',
  'rUpper',
  'rFore',
  'rHand',
  'rIndex1',
  'rIndex2',
  'rIndex3',
  'rThumb1',
  'rThumb2',
] as const
export type BoneKey = (typeof BONE_KEYS)[number]

/** Each role's bone in the model (Character Creator naming). */
export const BONE_NAMES: Record<BoneKey, string> = {
  hips: 'CC_Base_Hip_02',
  waist: 'CC_Base_Waist_028',
  chest: 'CC_Base_Spine02_030',
  neck: 'CC_Base_NeckTwist01_031',
  head: 'CC_Base_Head_033',
  lShoulder: 'CC_Base_L_Clavicle_044',
  lUpper: 'CC_Base_L_Upperarm_046',
  lFore: 'CC_Base_L_Forearm_047',
  lHand: 'CC_Base_L_Hand_051',
  rShoulder: 'CC_Base_R_Clavicle_061',
  rUpper: 'CC_Base_R_Upperarm_062',
  rFore: 'CC_Base_R_Forearm_065',
  rHand: 'CC_Base_R_Hand_070',
  // The right hand's fingers: one index chain carries all four, and a thumb.
  rIndex1: 'CC_Base_R_Index1_074',
  rIndex2: 'CC_Base_R_Index2_075',
  rIndex3: 'CC_Base_R_Index3_076',
  rThumb1: 'CC_Base_R_Thumb1_071',
  rThumb2: 'CC_Base_R_Thumb2_072',
}

/** `bot` is the whole robot — a hop, a spin; the rest are bones. */
type JointKey = 'bot' | BoneKey
type Channel = 'rotation' | 'position' | 'scale'
type Axis = 'x' | 'y' | 'z'

/** `[progress 0..1, offset from rest]`. Rotations are radians, positions OLD units (× `U`). */
export type Track = { joint: JointKey; channel: Channel; axis: Axis; keys: [number, number][] }

const k = (joint: JointKey, channel: Channel, axis: Axis, keys: [number, number][]): Track => ({
  joint,
  channel,
  axis,
  keys,
})

/** A bone rotation on one axis. */
const r = (joint: BoneKey, axis: Axis, keys: [number, number][]): Track =>
  k(joint, 'rotation', axis, keys)

/** The same arm move on both sides: the left as written, the right mirrored. */
const both = (
  part: 'Shoulder' | 'Upper' | 'Fore' | 'Hand',
  axis: Axis,
  keys: [number, number][],
): Track[] => [
  r(`l${part}`, axis, keys),
  r(`r${part}`, axis, axis === 'x' ? keys : keys.map(([t, v]) => [t, -v] as [number, number])),
]

/** Hold `v` from `a` to `b`, easing in and out over `e` on each side. */
const hold = (v: number, a = 0.18, b = 0.82, e = 0.18): [number, number][] => [
  [0, 0],
  [a, v],
  [b, v],
  [Math.min(1, b + e), 0],
  [1, 0],
]

/** Out to `v` and back at each peak, 0.12 of the gesture either side: a punch. */
const strike = (v: number, peaks: readonly number[]): [number, number][] => [
  [0, 0],
  ...peaks.flatMap((p): [number, number][] => [
    [p - 0.12, 0],
    [p, v],
    [p + 0.12, 0],
  ]),
  [1, 0],
]
const LEFT_PUNCHES = [0.24, 0.64] as const
const RIGHT_PUNCHES = [0.44, 0.84] as const

export const GESTURES: Record<Exclude<MascotPose, 'idle'>, Track[]> = {
  // Two dips of the head, the neck taking a share. One reads as a stumble.
  nod: [
    r('head', 'x', [
      [0, 0],
      [0.22, 0.32],
      [0.45, 0],
      [0.68, 0.32],
      [1, 0],
    ]),
    r('neck', 'x', [
      [0, 0],
      [0.22, 0.12],
      [0.45, 0],
      [0.68, 0.12],
      [1, 0],
    ]),
    k('bot', 'rotation', 'x', [
      [0, 0],
      [0.22, 0.04],
      [0.45, 0],
      [0.68, 0.04],
      [1, 0],
    ]),
  ],

  // Decaying sweep, the way a real head settles; the chest answers a little.
  shake: [
    r('head', 'y', [
      [0, 0],
      [0.2, -0.38],
      [0.4, 0.38],
      [0.6, -0.24],
      [0.8, 0.12],
      [1, 0],
    ]),
    r('chest', 'y', [
      [0, 0],
      [0.2, -0.08],
      [0.4, 0.08],
      [0.6, -0.05],
      [1, 0],
    ]),
  ],

  // A deep bow from the waist, right hand to the chest, held, then up.
  // Hi: the robot's right hand up beside its head, waving side to side, the
  // head tipped toward it. Asked for by the owner on 2026-11-15 as the first
  // thing the robot does when the page loads (Q033, revised again). The right
  // side's z is mirrored (see `both`). Raised sideways, the hand went to the
  // card's corner — the rest pose angles the arm outward — so it is bent up
  // at the elbow instead.
  hi: [
    // The pose Hands up uses for its right hand — beside the head, which the
    // card keeps in frame — and the forearm rocking about it: the wave.
    r('rUpper', 'z', hold(-0.6, 0.16, 0.8, 0.18)),
    r('rUpper', 'x', hold(-0.3, 0.16, 0.8, 0.18)),
    r('rFore', 'x', hold(-1.8, 0.18, 0.8, 0.18)),
    // Swung mostly inward, toward the face: an outward swing as wide carried
    // the hand behind the moves button in the card's corner.
    r('rFore', 'z', [
      [0, 0],
      [0.26, 0],
      [0.34, 0.35],
      [0.42, -0.1],
      [0.5, 0.35],
      [0.58, -0.1],
      [0.66, 0.35],
      [0.74, 0],
      [1, 0],
    ]),
    // An open, flat palm: the fingers straightened out of their resting
    // curl (one index chain carries all four), the thumb spread away from
    // them, and the hand turned a little so the palm faces out. Measured on
    // frozen frames: a wave with the rig's resting hand read as a fist.
    r('rIndex1', 'z', hold(-0.6, 0.18, 0.8, 0.18)),
    r('rIndex2', 'z', hold(-0.5, 0.18, 0.8, 0.18)),
    r('rIndex3', 'z', hold(-0.4, 0.18, 0.8, 0.18)),
    r('rThumb1', 'z', hold(-0.6, 0.18, 0.8, 0.18)),
    r('rThumb2', 'z', hold(-0.4, 0.18, 0.8, 0.18)),
    r('rHand', 'y', hold(-0.35, 0.18, 0.8, 0.18)),
    r('head', 'z', hold(0.12, 0.2, 0.8, 0.18)),
    r('chest', 'z', hold(-0.05, 0.2, 0.8, 0.18)),
    k('bot', 'position', 'y', [
      [0, 0],
      [0.14, 3],
      [0.3, 0],
      [1, 0],
    ]),
  ],
  bow: [
    k('bot', 'rotation', 'x', hold(0.3, 0.26, 0.68, 0.32)),
    k('bot', 'position', 'y', hold(-6, 0.26, 0.68, 0.32)),
    r('chest', 'x', hold(0.28, 0.26, 0.68, 0.32)),
    r('head', 'x', hold(0.18, 0.26, 0.68, 0.32)),
    r('rUpper', 'x', hold(-0.55, 0.22, 0.7, 0.3)),
    r('rUpper', 'z', hold(0.25, 0.22, 0.7, 0.3)),
    r('rFore', 'x', hold(-1.5, 0.22, 0.7, 0.3)),
  ],

  // Tips forward and comes toward the camera, head cocked, then holds.
  leanIn: [
    k('bot', 'rotation', 'x', hold(0.14, 0.2, 0.82)),
    k('bot', 'position', 'z', hold(22, 0.2, 0.82)),
    r('head', 'z', hold(0.18, 0.24, 0.8)),
    r('head', 'x', hold(0.1, 0.24, 0.8)),
  ],

  // Rocks on the roll axis, arms out a little for balance, and settles.
  wobble: [
    k('bot', 'rotation', 'z', [
      [0, 0],
      [0.18, 0.2],
      [0.38, -0.2],
      [0.56, 0.13],
      [0.74, -0.08],
      [0.88, 0.04],
      [1, 0],
    ]),
    r('head', 'z', [
      [0, 0],
      [0.18, -0.12],
      [0.38, 0.12],
      [0.56, -0.08],
      [1, 0],
    ]),
    ...both('Upper', 'z', hold(0.32, 0.15, 0.8)),
  ],

  // Three decaying hops, squash on each landing, and both fists pumping.
  bounce: [
    k('bot', 'position', 'y', [
      [0, 0],
      [0.16, 20],
      [0.32, 0],
      [0.5, 13],
      [0.66, 0],
      [0.82, 6],
      [1, 0],
    ]),
    k('bot', 'scale', 'y', [
      [0, 0],
      [0.16, 0.04],
      [0.32, -0.05],
      [0.5, 0.03],
      [0.66, -0.04],
      [0.82, 0.02],
      [1, 0],
    ]),
    ...both('Fore', 'x', hold(-1.15, 0.2, 0.8, 0.2)),
    ...both('Upper', 'x', [
      [0, 0],
      [0.16, -0.5],
      [0.32, -0.15],
      [0.5, -0.45],
      [0.66, -0.15],
      [0.82, -0.3],
      [1, 0],
    ]),
  ],

  // A full turn with the arms flung out, landing on exactly 2π.
  spin: [
    k('bot', 'rotation', 'y', [
      [0, 0],
      [1, Math.PI * 2],
    ]),
    k('bot', 'position', 'y', [
      [0, 0],
      [0.5, 11],
      [1, 0],
    ]),
    ...both('Upper', 'z', hold(0.95, 0.2, 0.75, 0.25)),
    ...both('Fore', 'x', hold(-0.3, 0.2, 0.75, 0.25)),
  ],

  // Pulls back, hands up before the chest, then recovers.
  recoil: [
    k('bot', 'rotation', 'x', [
      [0, 0],
      [0.24, -0.22],
      [0.62, -0.06],
      [1, 0],
    ]),
    k('bot', 'position', 'z', [
      [0, 0],
      [0.24, -24],
      [0.62, -7],
      [1, 0],
    ]),
    r('chest', 'x', hold(-0.15, 0.2, 0.6, 0.4)),
    ...both('Upper', 'x', hold(-0.55, 0.28, 0.6, 0.4)),
    ...both('Fore', 'x', hold(-1.25, 0.3, 0.6, 0.4)),
  ],

  // A short upward pop that overshoots and settles; the arms jolt out.
  startle: [
    k('bot', 'position', 'y', [
      [0, 0],
      [0.3, 16],
      [0.6, -3],
      [0.82, 4],
      [1, 0],
    ]),
    k('bot', 'scale', 'y', [
      [0, 0],
      [0.3, 0.05],
      [1, 0],
    ]),
    ...both('Upper', 'z', [
      [0, 0],
      [0.25, 0.45],
      [0.7, 0.1],
      [1, 0],
    ]),
    r('head', 'x', [
      [0, 0],
      [0.25, -0.14],
      [1, 0],
    ]),
  ],

  // Four beats. Hips and chest counter-roll, the hop lands on the off-beat,
  // and the fists pump left and right in turn, so no two channels pulse
  // together. Arms allowed since 2026-11-15 (Q033, revised).
  dance: [
    k('bot', 'position', 'y', [
      [0, 0],
      [0.12, 8],
      [0.25, 0],
      [0.37, 8],
      [0.5, 0],
      [0.62, 8],
      [0.75, 0],
      [0.87, 8],
      [1, 0],
    ]),
    k('bot', 'rotation', 'y', [
      [0, 0],
      [0.25, 0.22],
      [0.75, -0.22],
      [1, 0],
    ]),
    r('hips', 'z', [
      [0, 0],
      [0.125, 0.16],
      [0.375, -0.16],
      [0.625, 0.16],
      [0.875, -0.16],
      [1, 0],
    ]),
    r('chest', 'z', [
      [0, 0],
      [0.125, -0.14],
      [0.375, 0.14],
      [0.625, -0.14],
      [0.875, 0.14],
      [1, 0],
    ]),
    r('head', 'z', [
      [0, 0],
      [0.25, 0.14],
      [0.5, -0.14],
      [0.75, 0.14],
      [1, 0],
    ]),
    ...both('Fore', 'x', hold(-1.35, 0.1, 0.9, 0.1)),
    ...both('Upper', 'z', hold(0.3, 0.1, 0.9, 0.1)),
    r('lUpper', 'x', [
      [0, 0],
      [0.125, -0.7],
      [0.25, -0.1],
      [0.375, -0.1],
      [0.625, -0.7],
      [0.75, -0.1],
      [1, 0],
    ]),
    r('rUpper', 'x', [
      [0, 0],
      [0.25, -0.1],
      [0.375, -0.7],
      [0.5, -0.1],
      [0.875, -0.7],
      [1, 0],
    ]),
  ],

  // Shoulders up, forearms out and open, head cocked: "who knows".
  shrug: [
    ...both('Shoulder', 'z', hold(0.22, 0.25, 0.7, 0.3)),
    ...both('Upper', 'z', hold(0.3, 0.25, 0.7, 0.3)),
    ...both('Fore', 'x', hold(-1.1, 0.22, 0.72, 0.28)),
    ...both('Fore', 'y', hold(0.5, 0.22, 0.72, 0.28)),
    r('head', 'z', hold(0.2, 0.25, 0.7, 0.3)),
    r('chest', 'x', hold(-0.05, 0.25, 0.7, 0.3)),
  ],

  // Scans the room: a look to one side, then the other, the chest following.
  lookAround: [
    r('head', 'y', [
      [0, 0],
      [0.18, 0.62],
      [0.4, 0.62],
      [0.62, -0.62],
      [0.84, -0.62],
      [1, 0],
    ]),
    r('chest', 'y', [
      [0, 0],
      [0.2, 0.2],
      [0.4, 0.2],
      [0.64, -0.2],
      [0.84, -0.2],
      [1, 0],
    ]),
    r('head', 'x', [
      [0, 0],
      [0.18, -0.08],
      [0.62, 0.06],
      [1, 0],
    ]),
  ],

  // Crouch, leap into a full turn with the arms thrown up, land, absorb.
  hopSpin: [
    k('bot', 'position', 'y', [
      [0, 0],
      [0.16, -7],
      // Kept low enough that the head stays in the card at the top of the leap.
      [0.5, 20],
      [0.78, 0],
      [0.86, -5],
      [1, 0],
    ]),
    k('bot', 'scale', 'y', [
      [0, 0],
      [0.16, -0.05],
      [0.3, 0.05],
      [0.78, 0],
      [0.86, -0.05],
      [1, 0],
    ]),
    // The turn takes most of the move: any faster and it snaps between frames.
    k('bot', 'rotation', 'y', [
      [0, 0],
      [0.18, 0],
      [0.8, Math.PI * 2],
      [1, Math.PI * 2],
    ]),
    ...both('Upper', 'z', [
      [0, 0],
      [0.16, -0.1],
      [0.4, 1.9],
      [0.7, 1.9],
      [0.9, 0],
      [1, 0],
    ]),
    r('chest', 'x', [
      [0, 0],
      [0.16, 0.2],
      [0.4, -0.12],
      [0.86, 0.15],
      [1, 0],
    ]),
  ],

  // A long stretch: arms up and over, leaning back, then a loose release.
  stretch: [
    ...both('Upper', 'z', hold(2.5, 0.3, 0.68, 0.24)),
    // Elbows straightened past the resting bend: a full reach, not hands by the head.
    ...both('Fore', 'x', hold(0.3, 0.3, 0.68, 0.24)),
    r('chest', 'x', hold(-0.2, 0.32, 0.68, 0.24)),
    r('head', 'x', hold(-0.22, 0.32, 0.68, 0.24)),
    k('bot', 'position', 'y', hold(5, 0.32, 0.68, 0.24)),
  ],

  // A double-biceps flex: upper arms out level, forearms up (a further raise
  // about the same axis turns them skyward), two pumps, chest out, chin up.
  flex: [
    ...both('Upper', 'z', hold(1.3, 0.2, 0.8, 0.18)),
    ...both('Fore', 'z', [
      [0, 0],
      [0.22, 1.5],
      [0.38, 1.8],
      [0.5, 1.5],
      [0.62, 1.8],
      [0.8, 1.5],
      [0.98, 0],
      [1, 0],
    ]),
    r('chest', 'x', hold(-0.1, 0.2, 0.8, 0.18)),
    r('head', 'x', hold(-0.12, 0.2, 0.8, 0.18)),
    k('bot', 'scale', 'y', hold(0.025, 0.2, 0.8, 0.18)),
  ],

  // Guard up — fists before the shoulders — then left, right, left and a
  // lunging right: each fist shoots straight out as the body turns behind it,
  // and snaps back to the guard. The guard turns the arms in (z) and the
  // forearms across (y): the rig's rest pose hangs its arms outward, so a
  // bend alone leaves the fists out at its sides. A punch undoes that turn,
  // so the fist flies forward of its own shoulder rather than at the face.
  jab: [
    ...both('Upper', 'x', hold(-0.5, 0.12, 0.88, 0.12)),
    ...both('Upper', 'z', hold(-0.35, 0.12, 0.88, 0.12)),
    ...both('Fore', 'x', hold(-1.5, 0.12, 0.88, 0.12)),
    ...both('Fore', 'y', hold(-0.7, 0.12, 0.88, 0.12)),
    r('lUpper', 'x', strike(-0.8, LEFT_PUNCHES)),
    r('lUpper', 'z', strike(0.35, LEFT_PUNCHES)),
    r('lFore', 'x', strike(1.4, LEFT_PUNCHES)),
    r('lFore', 'y', strike(0.7, LEFT_PUNCHES)),
    r('rUpper', 'x', strike(-0.8, RIGHT_PUNCHES)),
    r('rUpper', 'z', strike(-0.35, RIGHT_PUNCHES)),
    r('rFore', 'x', strike(1.4, RIGHT_PUNCHES)),
    r('rFore', 'y', strike(-0.7, RIGHT_PUNCHES)),
    k('bot', 'rotation', 'y', [
      [0, 0],
      [0.24, -0.2],
      [0.44, 0.2],
      [0.64, -0.2],
      [0.84, 0.28],
      [1, 0],
    ]),
    k('bot', 'position', 'z', [
      [0, 0],
      [0.72, 0],
      [0.84, 10],
      [1, 0],
    ]),
    r('head', 'x', hold(0.08, 0.12, 0.88, 0.12)),
  ],

  // Iron-Man charge: crouch with the fists clenched low and the head down,
  // a tremor building, then a burst upward — arms flung wide, head up. The
  // burst barely rises: the card frames the head closely, and a real leap
  // takes it off the top.
  powerUp: [
    k('bot', 'position', 'y', [
      [0, 0],
      [0.2, -8],
      [0.5, -9],
      [0.62, 2],
      [0.82, 1],
      [1, 0],
    ]),
    k('bot', 'rotation', 'z', [
      [0, 0],
      [0.25, 0],
      [0.3, 0.015],
      [0.35, -0.015],
      [0.4, 0.02],
      [0.45, -0.02],
      [0.5, 0.025],
      [0.55, 0],
      [1, 0],
    ]),
    r('chest', 'x', [
      [0, 0],
      [0.2, 0.25],
      [0.5, 0.28],
      [0.62, -0.1],
      [0.84, -0.08],
      [1, 0],
    ]),
    r('head', 'x', [
      [0, 0],
      [0.2, 0.2],
      [0.5, 0.22],
      [0.62, -0.12],
      [0.84, -0.1],
      [1, 0],
    ]),
    ...both('Upper', 'z', [
      [0, 0],
      [0.2, 0.25],
      [0.5, 0.25],
      [0.64, 1.05],
      [0.84, 1.0],
      [1, 0],
    ]),
    ...both('Fore', 'x', [
      [0, 0],
      [0.2, -0.7],
      [0.5, -0.75],
      [0.64, 0.25],
      [0.84, 0.2],
      [1, 0],
    ]),
  ],

  // Nods off — the head sinking, caught once, sinking again, the body
  // slumping — then jolts awake with a little hop.
  doze: [
    r('head', 'x', [
      [0, 0],
      [0.22, 0.3],
      [0.3, 0.12],
      [0.58, 0.42],
      [0.72, 0.42],
      [0.78, -0.04],
      [0.9, 0],
      [1, 0],
    ]),
    r('neck', 'x', [
      [0, 0],
      [0.22, 0.1],
      [0.3, 0.04],
      [0.58, 0.14],
      [0.72, 0.14],
      [0.78, 0],
      [1, 0],
    ]),
    r('chest', 'x', [
      [0, 0],
      [0.58, 0.1],
      [0.72, 0.1],
      [0.78, -0.08],
      [1, 0],
    ]),
    r('head', 'z', [
      [0, 0],
      [0.58, 0.12],
      [0.72, 0.12],
      [0.8, 0],
      [1, 0],
    ]),
    ...both('Upper', 'z', [
      [0, 0],
      [0.58, -0.08],
      [0.72, -0.08],
      [0.78, 0.35],
      [0.92, 0],
      [1, 0],
    ]),
    k('bot', 'position', 'y', [
      [0, 0],
      [0.58, -3],
      [0.72, -3],
      [0.8, 2],
      [0.9, 0],
      [1, 0],
    ]),
  ],

  // A cocked head and a lean while one eye closes.
  wink: [
    r('head', 'z', hold(-0.18, 0.2, 0.62, 0.22)),
    r('head', 'x', hold(-0.06, 0.2, 0.62, 0.22)),
    r('chest', 'y', hold(0.1, 0.2, 0.62, 0.22)),
    k('bot', 'rotation', 'z', hold(-0.04, 0.2, 0.62, 0.22)),
  ],

  // Hearts for eyes, hands raised beside the shoulders, swaying and floating.
  // (Hands pressed to the chest sank into its armour.)
  love: [
    ...both('Upper', 'x', hold(-0.5, 0.15, 0.82, 0.16)),
    ...both('Upper', 'z', hold(0.3, 0.15, 0.82, 0.16)),
    ...both('Fore', 'x', hold(-1.7, 0.15, 0.82, 0.16)),
    ...both('Fore', 'y', hold(-0.3, 0.15, 0.82, 0.16)),
    k('bot', 'rotation', 'z', [
      [0, 0],
      [0.2, 0.06],
      [0.4, -0.06],
      [0.6, 0.06],
      [0.8, -0.06],
      [1, 0],
    ]),
    r('head', 'z', [
      [0, 0],
      [0.2, -0.16],
      [0.4, 0.16],
      [0.6, -0.16],
      [0.8, 0.16],
      [1, 0],
    ]),
    k('bot', 'position', 'y', hold(2, 0.25, 0.8, 0.2)),
  ],

  // The robot dance: upper arms locked level, forearms ticking up and down
  // in opposition, the head and body snapping between held angles.
  robot: [
    ...both('Upper', 'z', hold(1.1, 0.12, 0.86, 0.12)),
    r('lFore', 'z', [
      [0, 0],
      [0.12, 1.3],
      [0.28, 1.3],
      [0.42, -0.65],
      [0.56, -0.65],
      [0.7, 1.3],
      [0.86, 1.3],
      [0.98, 0],
      [1, 0],
    ]),
    r('rFore', 'z', [
      [0, 0],
      [0.12, 0.65],
      [0.28, 0.65],
      [0.42, -1.3],
      [0.56, -1.3],
      [0.7, 0.65],
      [0.86, 0.65],
      [0.98, 0],
      [1, 0],
    ]),
    r('head', 'y', [
      [0, 0],
      [0.28, 0],
      [0.36, 0.35],
      [0.56, 0.35],
      [0.66, -0.35],
      [0.86, -0.35],
      [0.94, 0],
      [1, 0],
    ]),
    k('bot', 'rotation', 'y', [
      [0, 0],
      [0.28, 0],
      [0.38, -0.15],
      [0.56, -0.15],
      [0.68, 0.15],
      [0.86, 0.15],
      [0.96, 0],
      [1, 0],
    ]),
    k('bot', 'position', 'y', [
      [0, 0],
      [0.36, 0],
      [0.4, -3],
      [0.46, 0],
      [0.66, 0],
      [0.7, -3],
      [0.76, 0],
      [1, 0],
    ]),
  ],

  // Jazz hands: both hands up beside the head, wrists shaking, a shimmy.
  // Hands go beside the head, not before the chest: this robot's shoulders and
  // chest are so broad that hands meeting in front of it sink into the armour,
  // and the card frames the head too closely for hands above it.
  jazz: [
    ...both('Upper', 'x', hold(-0.3, 0.18, 0.8, 0.18)),
    ...both('Upper', 'z', hold(0.6, 0.18, 0.8, 0.18)),
    ...both('Fore', 'x', hold(-1.8, 0.18, 0.8, 0.18)),
    ...both('Hand', 'z', [
      [0, 0],
      [0.18, 0],
      [0.23, 0.25],
      [0.28, -0.25],
      [0.33, 0.25],
      [0.38, -0.25],
      [0.43, 0.25],
      [0.48, -0.25],
      [0.53, 0.25],
      [0.58, -0.25],
      [0.63, 0.25],
      [0.68, -0.25],
      [0.73, 0.25],
      [0.78, -0.25],
      [0.84, 0],
      [1, 0],
    ]),
    k('bot', 'rotation', 'z', [
      [0, 0],
      [0.2, 0.03],
      [0.35, -0.03],
      [0.5, 0.03],
      [0.65, -0.03],
      [0.8, 0.03],
      [1, 0],
    ]),
    r('head', 'z', [
      [0, 0],
      [0.2, -0.1],
      [0.35, 0.1],
      [0.5, -0.1],
      [0.65, 0.1],
      [0.8, -0.1],
      [1, 0],
    ]),
  ],

  // "Over there": the left arm straight out to its side, the head and eyes
  // turned the same way, the other hand on its hip.
  point: [
    r('lUpper', 'z', hold(1.25, 0.18, 0.78, 0.2)),
    r('lUpper', 'x', hold(-0.3, 0.18, 0.78, 0.2)),
    r('lFore', 'x', hold(0.25, 0.18, 0.78, 0.2)),
    r('rUpper', 'z', hold(-0.45, 0.18, 0.78, 0.2)),
    r('rFore', 'z', hold(1.2, 0.18, 0.78, 0.2)),
    r('head', 'y', hold(0.45, 0.2, 0.78, 0.2)),
    r('chest', 'y', hold(0.15, 0.2, 0.78, 0.2)),
  ],

  // Hands on hips: elbows out, forearms swung back in (a −z bend on the left
  // brings the hand toward the body), chest out, chin up.
  hero: [
    ...both('Upper', 'z', hold(0.45, 0.18, 0.82, 0.18)),
    ...both('Upper', 'x', hold(0.12, 0.18, 0.82, 0.18)),
    ...both('Fore', 'z', hold(-1.2, 0.18, 0.82, 0.18)),
    r('chest', 'x', hold(-0.1, 0.18, 0.82, 0.18)),
    r('head', 'x', hold(-0.1, 0.2, 0.82, 0.18)),
    k('bot', 'scale', 'y', hold(0.02, 0.18, 0.82, 0.18)),
  ],

  // Hands up beside the head, palms out, leaning back: "I give up".
  handsUp: [
    ...both('Upper', 'x', hold(-0.3, 0.16, 0.82, 0.16)),
    ...both('Upper', 'z', hold(0.6, 0.16, 0.82, 0.16)),
    ...both('Fore', 'x', hold(-1.8, 0.16, 0.82, 0.16)),
    k('bot', 'rotation', 'x', hold(-0.06, 0.16, 0.82, 0.16)),
    k('bot', 'position', 'z', hold(-6, 0.16, 0.82, 0.16)),
    r('head', 'x', hold(-0.08, 0.16, 0.82, 0.16)),
  ],

  // The disco point: the left arm thrown up to the sky, then swept down
  // across the body, twice; the hips sway and the head follows the hand. The
  // right hand rests on the hip.
  disco: [
    r('lUpper', 'z', [
      [0, 0],
      [0.16, 2.3],
      [0.36, -0.3],
      [0.56, 2.3],
      [0.76, -0.3],
      [0.9, 0],
      [1, 0],
    ]),
    r('lUpper', 'x', [
      [0, 0],
      [0.16, 0],
      [0.36, -0.6],
      [0.56, 0],
      [0.76, -0.6],
      [0.9, 0],
      [1, 0],
    ]),
    r('lFore', 'x', hold(0.2, 0.16, 0.8, 0.14)),
    r('rUpper', 'z', hold(-0.45, 0.16, 0.86, 0.12)),
    r('rFore', 'z', hold(1.2, 0.16, 0.86, 0.12)),
    r('head', 'y', [
      [0, 0],
      [0.16, 0.25],
      [0.36, -0.15],
      [0.56, 0.25],
      [0.76, -0.15],
      [0.9, 0],
      [1, 0],
    ]),
    r('head', 'x', [
      [0, 0],
      [0.16, -0.15],
      [0.36, 0.1],
      [0.56, -0.15],
      [0.76, 0.1],
      [0.9, 0],
      [1, 0],
    ]),
    r('hips', 'z', [
      [0, 0],
      [0.16, 0.14],
      [0.36, -0.14],
      [0.56, 0.14],
      [0.76, -0.14],
      [0.9, 0],
      [1, 0],
    ]),
  ],

  // Busy at an imaginary keyboard: forearms forward, hands tapping in turn,
  // head bowed over the work.
  typing: [
    ...both('Upper', 'z', hold(-0.25, 0.14, 0.86, 0.14)),
    ...both('Fore', 'x', hold(-1.4, 0.14, 0.86, 0.14)),
    ...both('Fore', 'y', hold(-0.6, 0.14, 0.86, 0.14)),
    r('lHand', 'x', [
      [0, 0],
      [0.2, 0],
      [0.25, 0.25],
      [0.3, -0.25],
      [0.35, 0.25],
      [0.4, -0.25],
      [0.45, 0.25],
      [0.5, -0.25],
      [0.55, 0.25],
      [0.6, -0.25],
      [0.65, 0.25],
      [0.7, -0.25],
      [0.75, 0.25],
      [0.8, 0],
      [1, 0],
    ]),
    r('rHand', 'x', [
      [0, 0],
      [0.2, 0],
      [0.25, -0.25],
      [0.3, 0.25],
      [0.35, -0.25],
      [0.4, 0.25],
      [0.45, -0.25],
      [0.5, 0.25],
      [0.55, -0.25],
      [0.6, 0.25],
      [0.65, -0.25],
      [0.7, 0.25],
      [0.75, -0.25],
      [0.8, 0],
      [1, 0],
    ]),
    r('head', 'x', hold(0.18, 0.14, 0.86, 0.14)),
  ],

  // A drumroll: forearms up at the shoulders beating in turn, faster and
  // faster, then both come down together on the final hit with a nod.
  drumroll: [
    ...both('Upper', 'x', hold(-0.5, 0.16, 0.84, 0.16)),
    ...both('Upper', 'z', hold(0.3, 0.16, 0.84, 0.16)),
    ...both('Fore', 'x', hold(-1.7, 0.16, 0.84, 0.16)),
    ...both('Fore', 'y', hold(-0.3, 0.16, 0.84, 0.16)),
    r('lFore', 'x', [
      [0, 0],
      [0.16, 0],
      [0.22, 0.35],
      [0.28, 0],
      [0.34, 0.35],
      [0.4, 0],
      [0.45, 0.35],
      [0.5, 0],
      [0.55, 0.35],
      [0.6, 0],
      [0.65, 0.35],
      [0.7, 0],
      [0.82, 0.5],
      [0.9, 0],
      [1, 0],
    ]),
    r('rFore', 'x', [
      [0, 0],
      [0.19, 0],
      [0.25, 0.35],
      [0.31, 0],
      [0.37, 0.35],
      [0.425, 0],
      [0.475, 0.35],
      [0.525, 0],
      [0.575, 0.35],
      [0.625, 0],
      [0.675, 0.35],
      [0.72, 0],
      [0.82, 0.5],
      [0.9, 0],
      [1, 0],
    ]),
    r('head', 'x', [
      [0, 0],
      [0.7, 0],
      [0.82, 0.15],
      [0.92, 0],
      [1, 0],
    ]),
  ],
}

/**
 * The eyes' expression over a gesture: offsets from their neutral, open look.
 *
 *   smile  0..1  the eyes curve up into happy arcs
 *   squint 0..1  they narrow (with smile: eyes closed in a grin)
 *   wide   0..1  they grow and round — surprise
 *   lookX  −1..1 they glance toward −x / +x inside the visor
 *   heart  0..1  both eyes become hearts
 *   wink   0..1  one eye closes into a happy arc, the other stays open
 *   shut   0..1  both eyes close to a line — asleep
 */
const FACE_KEYS = ['smile', 'squint', 'wide', 'lookX', 'heart', 'wink', 'shut'] as const
type FaceKey = (typeof FACE_KEYS)[number]
type FaceTrack = { key: FaceKey; keys: [number, number][] }
const f = (key: FaceKey, keys: [number, number][]): FaceTrack => ({ key, keys })

const FACES: Partial<Record<Exclude<MascotPose, 'idle'>, FaceTrack[]>> = {
  nod: [f('smile', hold(0.8, 0.15, 0.8))],
  shake: [f('squint', hold(0.45, 0.12, 0.82))],
  hi: [f('smile', hold(1, 0.15, 0.85, 0.15))],
  bow: [f('smile', hold(0.7, 0.2, 0.7, 0.3)), f('squint', hold(0.5, 0.26, 0.68, 0.3))],
  leanIn: [f('wide', hold(0.55, 0.2, 0.82))],
  wobble: [f('squint', hold(0.35, 0.15, 0.85))],
  bounce: [f('smile', hold(1, 0.1, 0.85, 0.15))],
  spin: [f('smile', hold(0.8, 0.15, 0.8, 0.2))],
  recoil: [f('wide', hold(1, 0.1, 0.55, 0.45))],
  startle: [f('wide', hold(1, 0.12, 0.6, 0.4))],
  dance: [f('smile', hold(1, 0.06, 0.9, 0.1))],
  shrug: [f('squint', hold(0.3, 0.25, 0.7, 0.3)), f('smile', hold(0.35, 0.25, 0.7, 0.3))],
  lookAround: [
    f('lookX', [
      [0, 0],
      [0.14, 1],
      [0.4, 1],
      [0.56, -1],
      [0.84, -1],
      [1, 0],
    ]),
  ],
  hopSpin: [f('smile', hold(1, 0.2, 0.86, 0.14)), f('squint', hold(0.6, 0.35, 0.7, 0.2))],
  stretch: [f('squint', hold(1, 0.3, 0.68, 0.24)), f('smile', hold(0.6, 0.3, 0.68, 0.24))],
  flex: [f('smile', hold(0.7, 0.2, 0.8, 0.18)), f('squint', hold(0.3, 0.2, 0.8, 0.18))],
  jab: [f('squint', hold(0.55, 0.12, 0.88, 0.12))],
  powerUp: [
    f('squint', [
      [0, 0],
      [0.2, 0.7],
      [0.52, 0.7],
      [0.6, 0],
      [1, 0],
    ]),
    f('wide', [
      [0, 0],
      [0.55, 0],
      [0.62, 1],
      [0.84, 0.8],
      [1, 0],
    ]),
  ],
  doze: [
    f('shut', [
      [0, 0],
      [0.22, 0.6],
      [0.3, 0.25],
      [0.58, 1],
      [0.74, 1],
      [0.78, 0],
      [1, 0],
    ]),
    f('wide', [
      [0, 0],
      [0.74, 0],
      [0.8, 1],
      [0.94, 0.2],
      [1, 0],
    ]),
  ],
  wink: [f('wink', hold(1, 0.2, 0.62, 0.22)), f('smile', hold(0.25, 0.2, 0.62, 0.22))],
  love: [f('heart', hold(1, 0.12, 0.84, 0.14))],
  robot: [
    f('squint', hold(0.25, 0.12, 0.86, 0.12)),
    f('lookX', [
      [0, 0],
      [0.28, 0],
      [0.36, 1],
      [0.56, 1],
      [0.66, -1],
      [0.86, -1],
      [0.94, 0],
      [1, 0],
    ]),
  ],
  jazz: [f('smile', hold(1, 0.18, 0.8, 0.18)), f('wide', hold(0.4, 0.18, 0.8, 0.18))],
  point: [f('lookX', hold(1, 0.2, 0.78, 0.2)), f('wide', hold(0.3, 0.2, 0.78, 0.2))],
  hero: [f('smile', hold(0.45, 0.18, 0.82, 0.18)), f('squint', hold(0.3, 0.18, 0.82, 0.18))],
  handsUp: [f('wide', hold(0.8, 0.16, 0.82, 0.16))],
  disco: [f('smile', hold(1, 0.1, 0.9, 0.1))],
  typing: [f('squint', hold(0.4, 0.14, 0.86, 0.14))],
  drumroll: [
    f('squint', [
      [0, 0],
      [0.14, 0.5],
      [0.72, 0.5],
      [0.8, 0],
      [1, 0],
    ]),
    f('smile', [
      [0, 0],
      [0.74, 0],
      [0.82, 1],
      [0.94, 0.6],
      [1, 0],
    ]),
  ],
}

/** Smoothstep between keys — linear segments make joints visibly change gear. */
const ease = (t: number) => t * t * (3 - 2 * t)

export function sample(keys: readonly [number, number][], t: number): number {
  const first = keys[0]
  if (!first) return 0
  if (t <= first[0]) return first[1]
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i]!
    if (t > t1) continue
    const [t0, v0] = keys[i - 1]!
    const span = t1 - t0
    return span <= 0 ? v1 : v0 + (v1 - v0) * ease((t - t0) / span)
  }
  return keys[keys.length - 1]![1]
}

/** The body's offset from rest, in this scene's units. */
export type BodyOffset = { rx: number; ry: number; rz: number; py: number; pz: number; sy: number }

export const REST: BodyOffset = Object.freeze({ rx: 0, ry: 0, rz: 0, py: 0, pz: 0, sy: 0 })

/**
 * Where a gesture holds the body at progress `t` (0..1, clamped).
 *
 * Positions come out in this scene's units; rotations and scale are unitless
 * and pass through. `idle` is rest.
 */
export function gestureOffset(pose: MascotPose, t: number): BodyOffset {
  if (pose === 'idle') return { ...REST }
  const at = Math.min(1, Math.max(0, t))
  const out = { ...REST }
  for (const track of GESTURES[pose]) {
    if (track.joint !== 'bot') continue
    const v = sample(track.keys, at)
    if (track.channel === 'rotation') {
      if (track.axis === 'x') out.rx += v
      else if (track.axis === 'y') out.ry += v
      else out.rz += v
    } else if (track.channel === 'position') {
      if (track.axis === 'y') out.py += v * U
      else if (track.axis === 'z') out.pz += v * U
    } else if (track.axis === 'y') {
      out.sy += v
    }
  }
  return out
}

/** A bone's rotation offset, `[x, y, z]` radians in the robot's frame (see Axes). */
export type BoneOffsets = Record<BoneKey, [number, number, number]>

export const restBones = (): BoneOffsets =>
  Object.fromEntries(BONE_KEYS.map((b) => [b, [0, 0, 0]])) as unknown as BoneOffsets

/** Where a gesture holds each bone at progress `t` (0..1, clamped). `idle` is rest. */
export function gestureBones(pose: MascotPose, t: number): BoneOffsets {
  const out = restBones()
  if (pose === 'idle') return out
  const at = Math.min(1, Math.max(0, t))
  for (const track of GESTURES[pose]) {
    if (track.joint === 'bot') continue
    out[track.joint]['xyz'.indexOf(track.axis)] += sample(track.keys, at)
  }
  return out
}

export type Face = Record<FaceKey, number>
export const NEUTRAL_FACE: Face = Object.freeze({
  smile: 0,
  squint: 0,
  wide: 0,
  lookX: 0,
  heart: 0,
  wink: 0,
  shut: 0,
})

/** The eyes' expression at progress `t` of a gesture. `idle` is neutral. */
export function gestureFace(pose: MascotPose, t: number): Face {
  const out = { ...NEUTRAL_FACE }
  if (pose === 'idle') return out
  const at = Math.min(1, Math.max(0, t))
  for (const track of FACES[pose] ?? []) out[track.key] += sample(track.keys, at)
  return out
}

/** How long a gesture runs, in seconds — `POSE_MS`, the one place it is written. */
export const gestureSeconds = (pose: MascotPose): number => POSE_MS[pose] / 1000

/**
 * The eyes' glow, linear RGB 0..1: cyan, every channel at or under 1 because
 * the eyes are drawn past the tone curve. The stroke trail on the card is
 * drawn in the same colour, so it is written once, here.
 */
export const EYE_RGB: readonly [number, number, number] = [0.42, 0.9, 1.0]

/* --------------------------------- gaze ---------------------------------- */

/**
 * How far in front of the screen the robot's eyes "are", in CSS pixels: the
 * head aims at the pointer as if it sat this far away, so a pointer this far
 * to the side turns the head 45°.
 *
 * The owner asked for the old Spline robot's quick, pointed look back
 * (2026-11-15): it aimed its face at the cursor rather than easing toward
 * it, and turned hard for a pointer close by. An aim (an arctangent) does
 * that; the first version here mapped distance through a gentle curve over
 * 600px and read as sluggish. Only the head turns that hard — the body's
 * share stays under the 15° the "vibrating" complaint set (see
 * `jojo-mascot-stillness`), so a sweep across the page cannot lurch the robot.
 */
export const GAZE_DEPTH = 280

/**
 * The most the head turns and tips, and how much of that the body follows.
 * 57°, then 49°, turned the face to a profile at a page's far side (the camera
 * is close), the eyes sliding off the visor's edge, and a steep tip hid the
 * face under its brim; these keep the face in view at the extremes. What reads
 * as "pointy" is the aim and the speed near the robot, not the limit.
 */
export const HEAD_YAW = 0.72
export const HEAD_PITCH = 0.34
const BODY_SHARE = 0.34

/** How far the eyes glance inside the visor, as a share of the head's turn. */
export const EYE_GLANCE = 0.6

export type Gaze = { headYaw: number; headPitch: number; bodyYaw: number }

/**
 * The angle that points at an offset `d` px, `GAZE_DEPTH` away, eased into a
 * soft stop at `limit`: near the middle it is the true aim, so the face
 * points at the pointer; past the limit it settles rather than hitting a wall.
 */
function aim(d: number, limit: number): number {
  const a = Math.atan2(d, GAZE_DEPTH)
  return Number.isFinite(a) ? limit * Math.tanh(a / limit) : 0
}

/**
 * Where to look for a pointer at `(dx, dy)` CSS pixels from the robot's centre.
 *
 * The body follows a share of the head's yaw and none of its pitch — looking
 * with the head first is what reads as alive; a body that pitched too would
 * read as bowing.
 *
 * Positive yaw turns toward +x on screen (the robot's left, our right);
 * positive pitch tips the face DOWN, toward a pointer below it.
 */
export function gazeFor(dx: number, dy: number): Gaze {
  const headYaw = aim(dx, HEAD_YAW)
  return { headYaw, headPitch: aim(dy, HEAD_PITCH), bodyYaw: headYaw * BODY_SHARE }
}

/**
 * How fast the head, the eyes and the body catch up with the gaze, per
 * second (see `damp`). The head is quick — about a tenth of a second to close
 * most of a turn, as the old robot did — and the body lags behind it.
 */
export const GAZE_SPEED = { head: 16, eyes: 18, body: 5 } as const

/* ------------------------------- smoothing -------------------------------- */

/**
 * Exponential approach to `target`, frame-rate independent.
 *
 * `lambda` is how fast, per second: the gap shrinks by `e^-lambda` each second
 * whatever the frame rate, so a 30 Hz laptop and a 120 Hz display move the
 * head the same way. A plain `lerp(a, b, 0.1)` per frame would track four
 * times faster at 120 Hz than at 30.
 */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  if (!Number.isFinite(dt) || dt <= 0) return current
  return target + (current - target) * Math.exp(-lambda * Math.min(dt, 0.1))
}

/** An angle folded into (-π, π], so a finished spin is not unwound backwards. */
export function wrapAngle(a: number): number {
  const turn = Math.PI * 2
  const r = ((((a + Math.PI) % turn) + turn) % turn) - Math.PI
  return r === -Math.PI ? Math.PI : r
}

/* --------------------------------- idle ----------------------------------- */

/** Blink cadence — jittered, because a metronome reads as a machine. */
export const BLINK_MIN_S = 2.6
export const BLINK_MAX_S = 7.2
export const BLINK_S = 0.16

/** Seconds until the next blink, for a roll in [0, 1). */
export const blinkDelay = (roll: number): number =>
  BLINK_MIN_S +
  Math.min(1, Math.max(0, Number.isFinite(roll) ? roll : 0)) * (BLINK_MAX_S - BLINK_MIN_S)

/** How open the eyes are, `s` seconds into a blink: 1 → 0 → 1. */
export function eyeOpen(s: number): number {
  if (s <= 0 || s >= BLINK_S) return 1
  const half = BLINK_S / 2
  return s < half ? 1 - s / half : (s - half) / half
}

/**
 * The idle breath: a slow rise of the chest and a sway too small to read as a
 * gesture.
 *
 * Slow on purpose. The owner's complaint about the old robot was the sidebar
 * "vibrating", and what it measured as was a three-second loop on the arms
 * changing up to 4.7% of the card every 250 ms. This is a 4.6 s breath and a
 * 9 s sway, both under a degree or two, so the robot is plainly alive and
 * never busy.
 */
export function breath(seconds: number): { lift: number; sway: number; chest: number } {
  const b = Math.sin((seconds / 4.6) * Math.PI * 2)
  return {
    lift: b * 0.008,
    chest: b * 0.012,
    sway: Math.sin((seconds / 9) * Math.PI * 2) * 0.025,
  }
}

/**
 * The arrival: the camera starts close on the face and pulls back to the
 * resting frame while the robot rises into place, over this long, before it
 * greets.
 *
 * A zoom-out because the owner asked for one back (Q083): the Spline scene
 * opened that way, and when a load-time glitch hid it, restoring it was the
 * request. The new robot keeps it.
 */
export const INTRO_S = 1.4

/** The middle of the visor, in the scene: what the camera frames and zooms out from. */
export const FACE_AT: readonly [number, number, number] = [0, 1.9, 0]

/** Where the camera starts and where it rests, and the point it looks at. */
// Starts close on the visor — the eyes are the first thing seen.
export const CAMERA_FROM: readonly [number, number, number] = [0, 1.93, 1.05]
// Square on, and close enough that the card crops the shoulders and waist.
// Square on because the robot spends its life looking at the page beside it:
// from one side a glance turned the face away from the viewer, and from the
// other it turned the body toward the lens, where a turn reads as no turn.
export const CAMERA_REST: readonly [number, number, number] = [0, 1.72, 2.6]
// The look point starts on the face and settles lower, on the chest, so the
// head sits in the upper third of the card at rest.
export const LOOK_FROM: readonly [number, number, number] = [0, 1.88, 0]
export const LOOK_REST: readonly [number, number, number] = [0, 1.6, 0]

/** A point on the way from `a` to `b` at progress `p`. */
export const lerp3 = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  p: number,
): [number, number, number] => [
  a[0] + (b[0] - a[0]) * p,
  a[1] + (b[1] - a[1]) * p,
  a[2] + (b[2] - a[2]) * p,
]

/** How far into the arrival, eased: 0 at mount, 1 when settled. */
export const introProgress = (seconds: number): number =>
  ease(Math.min(1, Math.max(0, seconds / INTRO_S)))
