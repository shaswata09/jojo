import type { Application, SPEObject } from '@splinetool/runtime'
import { POSE_MS, type MascotPose } from '@/lib/mascot-context'

/**
 * Gesture rig for the Spline robot.
 *
 * The scene is a third-party asset, so none of this is authored in Spline — it
 * defines no gesture states, only a `start` intro and a `lookAt` that follows
 * the cursor. What it does expose is a fully articulated humanoid whose objects
 * have mutable transforms, so the gestures are driven here instead: joints are
 * resolved by uuid, their rest transforms captured on load, and each pose plays
 * as keyframed offsets from that rest.
 *
 * Object uuids and joint pivots were read out of the live scene with
 * `getAllObjects()` and confirmed one axis at a time against rendered frames —
 * the names in the scene are no guide at all (both arm assemblies are called
 * some variant of "Hand", and the real shoulder is the one named "Hand LEFT",
 * on both sides).
 */
const JOINTS = {
  /** The whole robot. Every gesture drives this and nothing else. */
  bot: '95b11be5-c203-4914-a8b9-7a05fa62a46c',
} as const

/**
 * Why everything below moves the whole body and nothing else.
 *
 * Two joints are off limits outright: the scene binds its own `lookAt` to
 * "Top part" and "Head" and rewrites their rotation as the cursor moves, so
 * anything written there is overwritten mid-gesture. Driving `bot` instead
 * means the head keeps tracking the cursor *while* the body gestures — the two
 * compose rather than collide.
 *
 * The arms were tried and dropped. Measured against world-space geometry, they
 * do not move the way the joint names suggest: `elbow.x` swings the hand behind
 * the body rather than curling it toward the face, the shoulder needs three
 * axes together to put the hand anywhere recognisable, and the left arm is an
 * instance whose three.js uuid is regenerated on every scene load, so it cannot
 * be addressed at all through the public API. Poses built on them read as a
 * limb flailing near a robot rather than a robot gesturing.
 *
 * `bot` has six clean channels and they are legible on their own:
 *
 *   rotation.x   pitch — dip forward / lean back
 *   rotation.y   yaw   — turn, sweep, spin
 *   rotation.z   roll  — rock side to side
 *   position.y   hop
 *   position.z   approach / withdraw (+z is toward the camera)
 *   scale        swell / shrink
 *
 * Ten gestures out of six reliable channels beats six out of a rig that will
 * not hold a pose.
 */
type JointKey = keyof typeof JOINTS
type Channel = 'rotation' | 'position' | 'scale'
type Axis = 'x' | 'y' | 'z'

/** `[progress 0..1, offset from rest]`. Rotations are radians, positions scene units. */
type Track = { joint: JointKey; channel: Channel; axis: Axis; keys: [number, number][] }

/**
 * The vocabulary. Values are offsets, never absolutes — several joints rest at
 * a non-zero angle (the elbows sit at y = -0.142), so assigning absolutes would
 * quietly destroy the scene's authored rest pose the first time anything moved.
 */
type Ch = 'rotation' | 'position' | 'scale'
const k = (joint: JointKey, channel: Ch, axis: Axis, keys: [number, number][]): Track => ({
  joint,
  channel,
  axis,
  keys,
})

/**
 * The vocabulary, in offsets from rest — never absolutes. `bot` does not rest
 * at the origin (it sits at -2.8, 25.7, 0 with scale 0.8), so assigning
 * absolutes would drop the robot to a different place the first time anything
 * moved. Offsets also make each gesture legible on its own terms: the numbers
 * below are all "how far from wherever it was".
 */
const GESTURES: Record<Exclude<MascotPose, 'idle'>, Track[]> = {
  // Two dips. One reads as a stumble rather than agreement.
  nod: [
    k('bot', 'rotation', 'x', [
      [0, 0],
      [0.22, 0.24],
      [0.45, 0],
      [0.68, 0.24],
      [1, 0],
    ]),
  ],

  // Decaying sweep, the way a real head settles.
  shake: [
    k('bot', 'rotation', 'y', [
      [0, 0],
      [0.2, -0.3],
      [0.4, 0.3],
      [0.6, -0.2],
      [0.8, 0.12],
      [1, 0],
    ]),
  ],

  // One deep pitch with a hold at the bottom. Twice as deep as a nod and it
  // stops there, which is what separates a bow from agreeing emphatically.
  bow: [
    k('bot', 'rotation', 'x', [
      [0, 0],
      [0.26, 0.55],
      [0.68, 0.55],
      [1, 0],
    ]),
    k('bot', 'position', 'y', [
      [0, 0],
      [0.26, -7],
      [0.68, -7],
      [1, 0],
    ]),
  ],

  // Tips forward and comes toward the camera, then holds. The approach is what
  // sells it — pitch alone reads as the start of a bow.
  leanIn: [
    k('bot', 'rotation', 'x', [
      [0, 0],
      [0.2, 0.2],
      [0.82, 0.2],
      [1, 0],
    ]),
    k('bot', 'position', 'z', [
      [0, 0],
      [0.2, 20],
      [0.82, 20],
      [1, 0],
    ]),
    k('bot', 'position', 'y', [
      [0, 0],
      [0.2, 5],
      [0.82, 5],
      [1, 0],
    ]),
  ],

  // Rocks on the roll axis and settles. Deliberately roll, not yaw, so it can
  // never be mistaken for a shake.
  wobble: [
    k('bot', 'rotation', 'z', [
      [0, 0],
      [0.18, 0.24],
      [0.38, -0.24],
      [0.56, 0.16],
      [0.74, -0.1],
      [0.88, 0.05],
      [1, 0],
    ]),
  ],

  // Three decaying hops, with the body squashing on each landing and stretching
  // at the top — hops without the squash read as an object being teleported.
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
  ],

  // A full turn. The offset lands on exactly 2*PI, so the robot finishes facing
  // forward and settling back to base is invisible.
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
  ],

  // Pulls back and away, then recovers. The mirror of leanIn, and shorter —
  // flinching slowly is not flinching.
  recoil: [
    k('bot', 'rotation', 'x', [
      [0, 0],
      [0.24, -0.3],
      [0.62, -0.08],
      [1, 0],
    ]),
    k('bot', 'position', 'z', [
      [0, 0],
      [0.24, -24],
      [0.62, -7],
      [1, 0],
    ]),
  ],

  // A short upward pop that overshoots and settles.
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
  ],

  // Four-beat routine: roll leads, the hop lands on the off-beat and the yaw
  // runs at half speed, so no two channels pulse together. Body only — the arm
  // tracks that used to run alongside are the reason this file no longer
  // touches the arms at all.
  dance: [
    k('bot', 'rotation', 'z', [
      [0, 0],
      [0.14, 0.2],
      [0.38, -0.2],
      [0.62, 0.2],
      [0.86, -0.2],
      [1, 0],
    ]),
    k('bot', 'position', 'y', [
      [0, 0],
      [0.12, 9],
      [0.26, 0],
      [0.38, 9],
      [0.5, 0],
      [0.62, 9],
      [0.74, 0],
      [0.86, 9],
      [1, 0],
    ]),
    k('bot', 'rotation', 'y', [
      [0, 0],
      [0.25, 0.16],
      [0.75, -0.16],
      [1, 0],
    ]),
  ],
}

/** Smoothstep between keys — linear segments make joints visibly change gear. */
const ease = (t: number) => t * t * (3 - 2 * t)

function sample(keys: [number, number][], t: number): number {
  if (t <= keys[0][0]) return keys[0][1]
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i]
    if (t > t1) continue
    const [t0, v0] = keys[i - 1]
    const span = t1 - t0
    return span <= 0 ? v1 : v0 + (v1 - v0) * ease((t - t0) / span)
  }
  return keys[keys.length - 1][1]
}

export type SplineRig = {
  play: (pose: MascotPose) => void
  /**
   * Freezes a gesture at a given progress. The frame loop is the only caller in
   * the app; it exists as public API so a pose can be inspected at an exact
   * moment without racing an animation.
   */
  applyAt: (pose: MascotPose, t: number) => void
  dispose: () => void
}

/**
 * Binds a rig to a loaded scene.
 *
 * No permanent animation loop: the frame callback runs only while a gesture is
 * in flight and cancels itself at the end. Spline renders on demand, so a idle
 * heartbeat writing to a transform would pin an otherwise-quiet WebGL canvas at
 * full frame rate for as long as the app is open.
 */
export function createSplineRig(app: Application): SplineRig {
  const objects = {} as Record<JointKey, SPEObject | undefined>
  for (const key of Object.keys(JOINTS) as JointKey[]) {
    objects[key] = app.findObjectById(JOINTS[key])
  }

  let frame = 0
  let active: { tracks: Track[]; start: number; ms: number } | null = null

  /**
   * Where the joints sat immediately before the current gesture.
   *
   * Captured per gesture rather than once at construction. The scene fires a
   * `start` intro that keeps animating these same objects for seconds after
   * load, so anything captured up front is a mid-intro frame — gestures would
   * be measured from a pose the robot was only passing through, and settling
   * would drop it back there. Reading the values at the moment a gesture begins
   * makes "rest" mean whatever the scene actually had, whenever that is.
   */
  let base: Record<string, number> = {}
  let basedOn: Track[] | null = null

  const slot = (t: Track) => `${t.joint}.${t.channel}.${t.axis}`

  const capture = (tracks: Track[]) => {
    base = {}
    for (const track of tracks) {
      const object = objects[track.joint]
      if (object) base[slot(track)] = object[track.channel][track.axis]
    }
    basedOn = tracks
  }

  /** Puts every joint this gesture touched back where it found them. */
  const settle = (tracks: Track[]) => {
    for (const track of tracks) {
      const object = objects[track.joint]
      const from = base[slot(track)]
      if (object && from !== undefined) object[track.channel][track.axis] = from
    }
  }

  const applyTracks = (tracks: Track[], t: number) => {
    if (basedOn !== tracks) capture(tracks)
    for (const track of tracks) {
      const object = objects[track.joint]
      const from = base[slot(track)]
      if (object && from !== undefined) {
        object[track.channel][track.axis] = from + sample(track.keys, t)
      }
    }
  }

  const step = (now: number) => {
    if (!active) return
    const t = Math.min(1, (now - active.start) / active.ms)
    applyTracks(active.tracks, t)

    if (t < 1) {
      frame = requestAnimationFrame(step)
      return
    }
    // Land on the captured values rather than base + keys[last], so float drift
    // cannot accumulate across repeated gestures.
    settle(active.tracks)
    active = null
    frame = 0
  }

  return {
    play(pose) {
      if (frame) cancelAnimationFrame(frame)
      // An interrupted gesture leaves its joints wherever it was; reset them
      // before the next one starts or the two would compound.
      if (active) settle(active.tracks)

      if (pose === 'idle') {
        active = null
        frame = 0
        return
      }

      const tracks = GESTURES[pose]
      if (!tracks) return
      capture(tracks)
      active = { tracks, start: performance.now(), ms: POSE_MS[pose] }
      frame = requestAnimationFrame(step)
    },
    applyAt(pose, t) {
      const tracks = pose === 'idle' ? null : GESTURES[pose]
      if (tracks) applyTracks(tracks, t)
    },
    dispose() {
      if (frame) cancelAnimationFrame(frame)
      if (active) settle(active.tracks)
      active = null
      frame = 0
    },
  }
}
