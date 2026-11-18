import { describe, expect, it } from 'vitest'
import { GESTURES as LABELLED, POSE_MS, type MascotPose } from '@/lib/mascot-context'
import {
  BONE_KEYS,
  BONE_NAMES,
  CAMERA_FROM,
  FACE_AT,
  CAMERA_REST,
  LOOK_FROM,
  LOOK_REST,
  lerp3,
  BLINK_MAX_S,
  BLINK_MIN_S,
  BLINK_S,
  GAZE_DEPTH,
  GESTURES,
  HEAD_PITCH,
  HEAD_YAW,
  REST,
  U,
  blinkDelay,
  breath,
  damp,
  eyeOpen,
  GAZE_SPEED,
  gazeFor,
  gestureBones,
  gestureFace,
  gestureOffset,
  NEUTRAL_FACE,
  gestureSeconds,
  introProgress,
  sample,
  wrapAngle,
} from '@/lib/robot-rig'

/**
 * The robot's motion, as numbers. Everything here is what `RobotScene` puts
 * on transforms each frame, so a rule that holds here holds on screen.
 */

const POSES = LABELLED.map((g) => g.pose)
const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps

describe('the gestures', () => {
  it('has a curve for every gesture the app can ask for, and nothing else', () => {
    expect(new Set(Object.keys(GESTURES))).toEqual(new Set(POSES))
  })

  it('starts every gesture at rest, so nothing jumps when one begins', () => {
    for (const pose of POSES) expect(gestureOffset(pose, 0), pose).toEqual(REST)
  })

  it('leaves nothing running once a gesture has landed', () => {
    // Every curve ends where it began. The one exception is spin, which ends a
    // whole turn round — the same angle — and the scene folds that back.
    for (const pose of POSES) {
      const end = gestureOffset(pose, 1)
      const { ry, ...rest } = end
      expect(
        Object.values(rest).every((v) => close(v, 0)),
        pose,
      ).toBe(true)
      expect(close(wrapAngle(ry), 0), pose).toBe(true)
    }
  })

  it('actually moves the robot somewhere in between', () => {
    // The whole body, or a bone — a nod is the head's, not the body's.
    for (const pose of POSES) {
      const peak = Math.max(
        ...Array.from({ length: 41 }, (_, i) => {
          const o = gestureOffset(pose, i / 40)
          const bones = Object.values(gestureBones(pose, i / 40)).flat()
          return Math.max(
            Math.abs(o.rx),
            Math.abs(o.ry),
            Math.abs(o.rz),
            Math.abs(o.py) * 5,
            Math.abs(o.pz) * 5,
            Math.abs(o.sy) * 5,
            ...bones.map(Math.abs),
          )
        }),
      )
      expect(peak, pose).toBeGreaterThan(0.05)
    }
  })

  it('starts and ends every gesture with the skeleton and the eyes at rest', () => {
    for (const pose of POSES) {
      for (const t of [0, 1]) {
        for (const [bone, v] of Object.entries(gestureBones(pose, t))) {
          expect(
            v.every((x) => close(x, 0)),
            `${pose} ${bone} @${t}`,
          ).toBe(true)
        }
        expect(gestureFace(pose, t), `${pose} face @${t}`).toEqual(NEUTRAL_FACE)
      }
    }
  })

  it('moves every bone smoothly: no frame-to-frame snap of a limb', () => {
    // 0.16 rad a frame is a fast, deliberate swing at 60 fps — an arm thrown
    // up in a hop. More than that and the limb teleports between frames.
    // The largest step found, asserted once: an `expect` per bone, axis and
    // frame — a label string built for each — made this the slowest test in
    // the suite, and it timed out under load (review 3, coverage-13).
    let worst = { step: 0, at: '' }
    for (const pose of POSES) {
      const frames = Math.ceil(gestureSeconds(pose) * 60)
      let prev = gestureBones(pose, 0)
      for (let f = 1; f <= frames; f++) {
        const next = gestureBones(pose, f / frames)
        for (const key of BONE_KEYS) {
          for (let i = 0; i < 3; i++) {
            const step = Math.abs(next[key][i] - prev[key][i])
            if (step > worst.step)
              worst = { step, at: `${pose} ${key}[${String(i)}] @${String(f)}` }
          }
        }
        prev = next
      }
    }
    expect(worst.step, worst.at).toBeLessThan(0.16)
  })

  it('never folds a forearm across the chest, where the hand sinks into the armour (Q321)', () => {
    // This robot's chest and shoulders are broad: a forearm turned across the
    // body by much more than the boxing guard's 0.7 puts the hand inside the
    // chest plate. Hands go beside the head or the hips instead.
    for (const pose of POSES) {
      for (let i = 0; i <= 80; i++) {
        const b = gestureBones(pose, i / 80)
        expect(b.lFore[1], `${pose} lFore`).toBeGreaterThanOrEqual(-0.75)
        expect(b.rFore[1], `${pose} rFore`).toBeLessThanOrEqual(0.75)
      }
    }
  })

  it('keeps the eyes on the visor: every expression within its range', () => {
    for (const pose of POSES) {
      for (let i = 0; i <= 40; i++) {
        const face = gestureFace(pose, i / 40)
        for (const key of ['smile', 'squint', 'wide', 'heart', 'wink', 'shut'] as const) {
          expect(face[key], `${pose} ${key}`).toBeGreaterThanOrEqual(0)
          expect(face[key], `${pose} ${key}`).toBeLessThanOrEqual(1)
        }
        expect(Math.abs(face.lookX), pose).toBeLessThanOrEqual(1)
      }
    }
  })

  it('names a real bone for every role, each once', () => {
    const names = Object.values(BONE_NAMES)
    expect(new Set(names).size).toBe(names.length)
    expect(new Set(Object.keys(BONE_NAMES))).toEqual(new Set(BONE_KEYS))
    for (const name of names) expect(name).toMatch(/^CC_Base_/)
  })

  it('moves smoothly: no frame-to-frame jump anywhere in a gesture', () => {
    // At 60 fps the longest gesture is ~160 frames. A step bigger than these
    // between two of them would read as a snap rather than motion. The hop's
    // bound is the bounce itself: 0.2 units up in about ten frames, eased, peaks
    // a little over 0.02 a frame — a quick hop, which is what it is meant to be.
    for (const pose of POSES) {
      const frames = Math.ceil(gestureSeconds(pose) * 60)
      let prev = gestureOffset(pose, 0)
      for (let f = 1; f <= frames; f++) {
        const next = gestureOffset(pose, f / frames)
        expect(Math.abs(next.rx - prev.rx), `${pose} rx @${f}`).toBeLessThan(0.1)
        // A whole turn in 72 frames, eased, peaks at 1.5x its 0.087 average.
        expect(Math.abs(next.ry - prev.ry), `${pose} ry @${f}`).toBeLessThan(0.14)
        expect(Math.abs(next.py - prev.py), `${pose} py @${f}`).toBeLessThan(0.035)
        prev = next
      }
    }
  })

  it('scales the old scene units into this scene, so a hop is a ninth of the robot', () => {
    const bounce = Math.max(
      ...Array.from({ length: 101 }, (_, i) => gestureOffset('bounce', i / 100).py),
    )
    expect(close(bounce, 20 * U, 1e-6)).toBe(true)
    expect(bounce).toBeGreaterThan(0.15)
    expect(bounce).toBeLessThan(0.3)
  })

  it('times every gesture by POSE_MS, the one place a length is written', () => {
    for (const pose of POSES) expect(gestureSeconds(pose)).toBe(POSE_MS[pose] / 1000)
  })

  it('treats idle as rest, whatever the progress', () => {
    expect(gestureOffset('idle' as MascotPose, 0.5)).toEqual(REST)
  })

  it('clamps progress, so a late frame lands rather than overshooting', () => {
    expect(gestureOffset('nod', 7)).toEqual(gestureOffset('nod', 1))
    expect(gestureOffset('nod', -3)).toEqual(gestureOffset('nod', 0))
  })

  it('eases between keys rather than changing gear at them', () => {
    const keys: [number, number][] = [
      [0, 0],
      [1, 1],
    ]
    expect(sample(keys, 0.5)).toBe(0.5)
    expect(sample(keys, 0.1)).toBeLessThan(0.1)
    expect(sample([], 0.5)).toBe(0)
  })
})

describe('where the robot looks', () => {
  it('looks straight ahead at a pointer over its own face', () => {
    expect(gazeFor(0, 0)).toEqual({ headYaw: 0, headPitch: 0, bodyYaw: 0 })
  })

  it('turns toward the pointer, the head further than the body', () => {
    const right = gazeFor(GAZE_DEPTH, 0)
    expect(right.headYaw).toBeGreaterThan(0)
    expect(right.bodyYaw).toBeGreaterThan(0)
    expect(right.bodyYaw).toBeLessThan(right.headYaw)
    expect(gazeFor(-GAZE_DEPTH, 0).headYaw).toBeCloseTo(-right.headYaw)
    expect(gazeFor(0, GAZE_DEPTH).headPitch).toBeGreaterThan(0)
  })

  it('points at the pointer, turning hard for one close by, as the old robot did', () => {
    // The true aim near the middle: a pointer 100px off turns the head ~18°.
    expect(gazeFor(100, 0).headYaw).toBeCloseTo(Math.atan2(100, GAZE_DEPTH), 1)
    expect(gazeFor(100, 0).headYaw).toBeGreaterThan(0.3)
    // And most of its range by the time the pointer is a card's width or two away.
    expect(gazeFor(GAZE_DEPTH * 2, 0).headYaw).toBeGreaterThan(HEAD_YAW * 0.7)
  })

  it('catches up with the pointer quickly, the head faster than the body', () => {
    let head = 0
    for (let i = 0; i < 9; i++) head = damp(head, 1, GAZE_SPEED.head, 1 / 60)
    // Most of a turn inside 0.15 s.
    expect(head).toBeGreaterThan(0.85)
    expect(GAZE_SPEED.body).toBeLessThan(GAZE_SPEED.head)
  })

  it('never swings past its limits, however far the pointer goes', () => {
    // The old robot swung its body 58° from one corner of the page to the
    // other. This one is bounded by construction.
    for (const d of [1e3, 1e5, 1e9, Infinity, -Infinity, Number.NaN]) {
      const g = gazeFor(d, d)
      expect(Math.abs(g.headYaw)).toBeLessThanOrEqual(HEAD_YAW)
      expect(Math.abs(g.headPitch)).toBeLessThanOrEqual(HEAD_PITCH)
      expect(Math.abs(g.bodyYaw)).toBeLessThan((15 * Math.PI) / 180)
    }
  })
})

describe('smoothing', () => {
  it('reaches the same place whatever the frame rate', () => {
    const run = (fps: number) => {
      let v = 0
      for (let i = 0; i < fps; i++) v = damp(v, 1, 6, 1 / fps)
      return v
    }
    expect(Math.abs(run(30) - run(120))).toBeLessThan(1e-9)
  })

  it('stays put on a zero or broken frame time', () => {
    expect(damp(0.3, 1, 6, 0)).toBe(0.3)
    expect(damp(0.3, 1, 6, Number.NaN)).toBe(0.3)
  })

  it('folds a finished spin back to facing forward', () => {
    expect(close(wrapAngle(Math.PI * 2), 0)).toBe(true)
    expect(close(wrapAngle(-Math.PI * 2 + 0.1), 0.1)).toBe(true)
    expect(wrapAngle(Math.PI)).toBe(Math.PI)
  })
})

describe('idle', () => {
  it('blinks on a jittered timer inside its bounds', () => {
    expect(blinkDelay(0)).toBe(BLINK_MIN_S)
    expect(blinkDelay(0.999999)).toBeLessThanOrEqual(BLINK_MAX_S)
    expect(blinkDelay(Number.NaN)).toBe(BLINK_MIN_S)
    expect(blinkDelay(5)).toBeCloseTo(BLINK_MAX_S)
  })

  it('closes the eyes and opens them again within one blink', () => {
    expect(eyeOpen(0)).toBe(1)
    expect(eyeOpen(BLINK_S / 2)).toBeCloseTo(0)
    expect(eyeOpen(BLINK_S)).toBe(1)
  })

  it('breathes too slowly and too little to read as vibration', () => {
    // The owner's complaint about the old robot was a sidebar that vibrated —
    // a three-second arm loop. This breath is over a degree or two, slowly.
    let max = 0
    let fastest = 0
    let prev = breath(0)
    for (let i = 1; i <= 600; i++) {
      const b = breath(i / 60)
      max = Math.max(max, Math.abs(b.sway), Math.abs(b.lift), Math.abs(b.chest))
      fastest = Math.max(fastest, Math.abs(b.sway - prev.sway) * 60)
      prev = b
    }
    expect(max).toBeLessThan(0.03)
    expect(fastest).toBeLessThan(0.02)
  })

  it('zooms out on arrival: the camera starts closer and higher, on the face', () => {
    const dist = (p: readonly number[]) =>
      Math.hypot(p[0]! - FACE_AT[0], p[1]! - FACE_AT[1], p[2]! - FACE_AT[2])
    expect(dist(CAMERA_FROM)).toBeLessThan(dist(CAMERA_REST) * 0.7)
    expect(LOOK_FROM[1]).toBeGreaterThan(LOOK_REST[1])
    expect(lerp3(CAMERA_FROM, CAMERA_REST, 1)).toEqual([...CAMERA_REST])
    expect(lerp3(CAMERA_FROM, CAMERA_REST, 0)).toEqual([...CAMERA_FROM])
  })

  it('rises into place on arrival, and is settled before it greets', () => {
    expect(introProgress(0)).toBe(0)
    expect(introProgress(10)).toBe(1)
    expect(introProgress(0.45)).toBeGreaterThan(0)
  })
})
