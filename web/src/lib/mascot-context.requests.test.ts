import { describe, expect, it } from 'vitest'
import { GESTURES, POSE_MS } from '@/lib/mascot-context'
import splineRig from '@/lib/spline-rig.ts?raw'

/**
 * Q033 — the mascot's gesture set.
 *
 * The owner kept Nod, Shake, Startle and a body-only Dance, dropped Hello,
 * Thumbs up, Head scratch, Thinking and Excited, and asked for the rest to be
 * built from movement the body already has.
 */
const poses = GESTURES.map((g) => g.pose)
const labels = GESTURES.map((g) => g.label.toLowerCase())

/** One gesture's track list in `spline-rig.ts`, as text. */
const tracksOf = (pose: string) => {
  const start = splineRig.indexOf(`\n  ${pose}: [`)
  expect(start, `${pose} has tracks in spline-rig.ts`).toBeGreaterThan(-1)
  const end = splineRig.indexOf('\n  ],', start)
  return splineRig.slice(start, end)
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

  it('dances with the body alone — no arm joint moves', () => {
    const dance = tracksOf('dance')
    const joints = [...dance.matchAll(/k\('([^']+)'/g)].map((m) => m[1])
    expect(joints.length).toBeGreaterThan(0)
    expect(new Set(joints)).toEqual(new Set(['bot']))
  })

  it('builds every gesture from the body, the movement the scene already has', () => {
    for (const pose of poses) {
      const joints = [...tracksOf(pose).matchAll(/k\('([^']+)'/g)].map((m) => m[1])
      expect(joints.length, pose).toBeGreaterThan(0)
      expect(new Set(joints), pose).toEqual(new Set(['bot']))
    }
  })
})
