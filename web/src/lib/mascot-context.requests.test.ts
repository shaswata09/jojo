import { describe, expect, it } from 'vitest'
import { GESTURES, POSE_MS } from '@/lib/mascot-context'
import robotRig from '@/lib/robot-rig.ts?raw'

/**
 * Q033 — the mascot's gesture set.
 *
 * The owner kept Nod, Shake, Startle and Dance, dropped Hello, Thumbs up,
 * Head scratch, Thinking and Excited, and asked for the rest to be built from
 * movement the body already has. On 2026-11-15, with a rigged model, they
 * allowed the arms back into the dance and into new moves.
 */
const poses = GESTURES.map((g) => g.pose)
const labels = GESTURES.map((g) => g.label.toLowerCase())

/** One gesture's track list in `robot-rig.ts`, as text. */
const tracksOf = (pose: string) => {
  const start = robotRig.indexOf(`\n  ${pose}: [`)
  expect(start, `${pose} has tracks in robot-rig.ts`).toBeGreaterThan(-1)
  const end = robotRig.indexOf('\n  ],', start)
  return robotRig.slice(start, end)
}

describe('the gestures the mascot knows (Q033)', () => {
  it('keeps Nod, Shake, Startle and Dance', () => {
    for (const pose of ['nod', 'shake', 'startle', 'dance'] as const) {
      expect(poses).toContain(pose)
      expect(POSE_MS[pose]).toBeGreaterThan(0)
    }
  })

  it('has none of the five that were dropped', () => {
    for (const dropped of ['hello', 'thumbs', 'scratch', 'thinking', 'excited']) {
      expect(labels.some((l) => l.includes(dropped))).toBe(false)
      expect(poses.some((p) => p.toLowerCase().includes(dropped))).toBe(false)
    }
  })

  /** The joints a gesture's tracks name: `k('bot'`, `r('head'`, and `both('Upper'` for the arms. */
  const jointsOf = (pose: string) => {
    const text = tracksOf(pose)
    return new Set([
      ...[...text.matchAll(/\b(?:k|r)\('([^']+)'/g)].map((m) => m[1]!),
      ...[...text.matchAll(/\bboth\('([^']+)'/g)].map((m) => `arm:${m[1]!}`),
    ])
  }
  const isArm = (joint: string) => joint.startsWith('arm:') || /^[lr](Shoulder|Upper|Fore|Hand)$/.test(joint)

  // Revised 2026-11-15: with a skeleton to drive, the owner asked for the
  // arms back in the dance and in new moves. The five dropped gestures stay
  // dropped (above).
  it('dances with its arms as well as its body (Q033, revised)', () => {
    const joints = [...jointsOf('dance')]
    expect(joints.some(isArm)).toBe(true)
    expect(joints.some((j) => !isArm(j))).toBe(true)
  })

  it('moves the body or head in every gesture, so none is an arm alone', () => {
    for (const pose of poses) {
      const joints = [...jointsOf(pose)]
      expect(joints.length, pose).toBeGreaterThan(0)
      expect(joints.some((j) => !isArm(j)), pose).toBe(true)
    }
  })
})
