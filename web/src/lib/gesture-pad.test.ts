import { describe, expect, it } from 'vitest'
import { GESTURES } from '@/lib/mascot-context'
import {
  PAD_STROKES,
  isDoubleTap,
  poseForStroke,
  recognise,
  strokesFor,
  type PadPoint,
} from '@/lib/gesture-pad'

/**
 * Strokes drawn as a hand would: through the given corners, sampled every
 * couple of pixels, a pixel of wobble on top. `scale` and `ms` vary them so a
 * test cannot pass on one lucky size or speed.
 */
function draw(corners: [number, number][], { scale = 1, ms = 400, wobble = 1.2 } = {}): PadPoint[] {
  const pts: PadPoint[] = []
  const total =
    corners
      .slice(1)
      .reduce((n, c, i) => n + Math.hypot(c[0] - corners[i]![0], c[1] - corners[i]![1]), 0) * scale
  let walked = 0
  for (let i = 1; i < corners.length; i++) {
    const [ax, ay] = corners[i - 1]!
    const [bx, by] = corners[i]!
    const len = Math.hypot(bx - ax, by - ay) * scale
    const n = Math.max(1, Math.round(len / 2))
    for (let j = i === 1 ? 0 : 1; j <= n; j++) {
      const f = j / n
      const d = walked + f * len
      pts.push({
        x: 100 + (ax + (bx - ax) * f) * scale + Math.sin(d * 0.9) * wobble,
        y: 100 + (ay + (by - ay) * f) * scale + Math.cos(d * 0.7) * wobble,
        t: (d / total) * ms,
      })
    }
    walked += len
  }
  return pts
}

function loop(clockwise: boolean, r = 50, ms = 600): PadPoint[] {
  const pts: PadPoint[] = []
  for (let i = 0; i <= 120; i++) {
    const a = (i / 120) * Math.PI * 2 * 0.97 * (clockwise ? 1 : -1)
    pts.push({ x: 100 + Math.cos(a) * r, y: 100 + Math.sin(a) * r, t: (i / 120) * ms })
  }
  return pts
}

describe('the gesture pad', () => {
  it('reads a press as a tap, and a long one as press-and-hold', () => {
    expect(
      recognise([
        { x: 50, y: 50, t: 0 },
        { x: 52, y: 51, t: 120 },
      ]),
    ).toBe('tap')
    expect(
      recognise([
        { x: 50, y: 50, t: 0 },
        { x: 53, y: 52, t: 700 },
      ]),
    ).toBe('hold')
  })

  it('reads straight swipes by direction', () => {
    for (const scale of [0.6, 1, 1.6]) {
      expect(
        recognise(
          draw(
            [
              [0, 60],
              [0, -60],
            ],
            { scale },
          ),
        ),
        `up ×${scale}`,
      ).toBe('up')
      expect(
        recognise(
          draw(
            [
              [0, -60],
              [0, 60],
            ],
            { scale },
          ),
        ),
        `down ×${scale}`,
      ).toBe('down')
      expect(
        recognise(
          draw(
            [
              [-60, 0],
              [60, 0],
            ],
            { scale },
          ),
        ),
        `right ×${scale}`,
      ).toBe('side')
      expect(
        recognise(
          draw(
            [
              [60, 0],
              [-60, 0],
            ],
            { scale },
          ),
        ),
        `left ×${scale}`,
      ).toBe('side')
      expect(
        recognise(
          draw(
            [
              [-40, 40],
              [40, -40],
            ],
            { scale },
          ),
        ),
        `diagonal ×${scale}`,
      ).toBe('diagonal')
    }
  })

  it('tells a back-and-forth from a zigzag, and a vertical scribble from both', () => {
    expect(
      recognise(
        draw([
          [-50, 0],
          [50, 3],
          [-50, 6],
        ]),
      ),
    ).toBe('backForth')
    expect(
      recognise(
        draw([
          [-50, 0],
          [50, 4],
          [-50, 8],
          [50, 12],
        ]),
      ),
    ).toBe('zigzag')
    expect(
      recognise(
        draw([
          [-50, -10],
          [-30, 10],
          [-10, -10],
          [10, 10],
          [30, -10],
          [50, 10],
        ]),
      ),
    ).toBe('zigzag')
    expect(
      recognise(
        draw([
          [0, -50],
          [3, 50],
          [6, -50],
          [9, 50],
        ]),
      ),
    ).toBe('scribbleUp')
  })

  it('reads a V and a peak', () => {
    expect(
      recognise(
        draw([
          [-40, -50],
          [0, 50],
          [40, -50],
        ]),
      ),
    ).toBe('vee')
    // A tick: a short stroke down, a long one up.
    expect(
      recognise(
        draw([
          [-30, 0],
          [-10, 25],
          [40, -50],
        ]),
      ),
    ).toBe('vee')
    expect(
      recognise(
        draw([
          [-40, 50],
          [0, -50],
          [40, 50],
        ]),
      ),
    ).toBe('peak')
  })

  it('reads a Z, drawn either way round', () => {
    expect(
      recognise(
        draw([
          [-40, -40],
          [40, -40],
          [-40, 40],
          [40, 40],
        ]),
      ),
    ).toBe('zed')
    expect(
      recognise(
        draw([
          [40, -40],
          [-40, -40],
          [40, 40],
          [-40, 40],
        ]),
      ),
    ).toBe('zed')
  })

  it('reads a loop either way round, and tells a square from a circle', () => {
    expect(recognise(loop(true))).toBe('circle')
    expect(recognise(loop(false, 35, 300))).toBe('circle')
    expect(
      recognise(
        draw([
          [-45, -45],
          [45, -45],
          [45, 45],
          [-45, 45],
          [-45, -40],
        ]),
      ),
    ).toBe('square')
    expect(
      recognise(
        draw([
          [-45, -45],
          [-45, 45],
          [45, 45],
          [45, -45],
          [-40, -45],
        ]),
      ),
    ).toBe('square')
  })

  it('answers a scrawl it cannot read rather than ignoring it', () => {
    expect(
      recognise(
        draw([
          [0, 0],
          [40, 10],
          [10, 40],
          [50, 60],
          [-20, 30],
          [30, -30],
        ]),
      ),
    ).toBe('other')
  })

  it('pairs two quick, close taps into a double tap, and nothing else', () => {
    expect(isDoubleTap(null, { x: 0, y: 0, t: 0 })).toBe(false)
    expect(isDoubleTap({ x: 10, y: 10, t: 1000 }, { x: 14, y: 12, t: 1250 })).toBe(true)
    expect(isDoubleTap({ x: 10, y: 10, t: 1000 }, { x: 14, y: 12, t: 1500 })).toBe(false)
    expect(isDoubleTap({ x: 10, y: 10, t: 1000 }, { x: 90, y: 12, t: 1100 })).toBe(false)
  })

  it('plays a move the mascot knows for every stroke, and lists each stroke once', () => {
    const known = new Set(GESTURES.map((g) => g.pose))
    for (const s of PAD_STROKES) expect(known.has(s.pose), s.id).toBe(true)
    expect(new Set(PAD_STROKES.map((s) => s.id)).size).toBe(PAD_STROKES.length)
    expect(poseForStroke('circle')).toBe('spin')
    expect(strokesFor('nod').map((s) => s.id)).toEqual(['tap'])
  })
})

describe('the hand-gesture strokes (Q319)', () => {
  const arc = (r = 45, from = -Math.PI / 2, to = Math.PI / 2, steps = 40): PadPoint[] =>
    Array.from({ length: steps + 1 }, (_, i) => {
      // A C: from the top, round the left side, to the bottom.
      const a = from + ((to - from) * i) / steps
      return { x: 100 - Math.cos(a) * r, y: 100 + Math.sin(a) * r, t: i * 10 }
    })

  it('reads an arc, an L and a triangle', () => {
    expect(recognise(arc())).toBe('arc')
    expect(recognise(arc(30))).toBe('arc')
    expect(
      recognise(
        draw([
          [-30, -50],
          [-30, 40],
          [40, 40],
        ]),
      ),
    ).toBe('ell')
    expect(
      recognise(
        draw([
          [0, -50],
          [45, 35],
          [-45, 35],
          [-3, -45],
        ]),
      ),
    ).toBe('triangle')
  })

  it('still tells the earlier strokes apart from the new ones', () => {
    expect(recognise(loop(true))).toBe('circle')
    // A lumpy, hand-drawn circle: its radius wanders by a tenth.
    const lumpy = loop(false, 45).map((p, i) => {
      const k = 1 + 0.1 * Math.sin(i * 0.31)
      return { ...p, x: 100 + (p.x - 100) * k, y: 100 + (p.y - 100) * k }
    })
    expect(recognise(lumpy)).toBe('circle')
    expect(
      recognise(
        draw([
          [-40, -50],
          [0, 50],
          [40, -50],
        ]),
      ),
    ).toBe('vee')
    expect(
      recognise(
        draw([
          [-45, -45],
          [45, -45],
          [45, 45],
          [-45, 45],
          [-45, -40],
        ]),
      ),
    ).toBe('square')
    expect(
      recognise(
        draw([
          [-60, 0],
          [60, 0],
        ]),
      ),
    ).toBe('side')
  })

  it('has Jazz hands, Point, Hero pose, Hands up, Disco, Typing and Drumroll', () => {
    for (const pose of [
      'jazz',
      'point',
      'hero',
      'handsUp',
      'disco',
      'typing',
      'drumroll',
    ] as const) {
      expect(
        GESTURES.some((g) => g.pose === pose),
        pose,
      ).toBe(true)
    }
    for (const pose of ['jazz', 'point', 'disco'] as const)
      expect(strokesFor(pose).length, pose).toBeGreaterThan(0)
  })
})

describe('the moves added on 2026-11-15 (Q316)', () => {
  it('has Flex, Punch combo, Power up, Doze off, Wink, Love and Robot dance, each on a stroke', () => {
    for (const pose of ['flex', 'jab', 'powerUp', 'doze', 'wink', 'love', 'robot'] as const) {
      expect(
        GESTURES.some((g) => g.pose === pose),
        pose,
      ).toBe(true)
      expect(strokesFor(pose).length, pose).toBeGreaterThan(0)
    }
  })
})
