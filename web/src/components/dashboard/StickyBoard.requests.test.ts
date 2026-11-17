/**
 * Q293: a sticky note's shadow has the same rounded corners as the note.
 *
 * A box-shadow follows the border-radius of the element it is on, so the
 * corners come out right as long as two things hold:
 *
 *   - the shadow and the rounding are on the same element, and
 *   - the shadow is not clipped. The board is a scroll box, which clips
 *     whatever overflows it, and a shadow cut at the box's edge is a
 *     square-cornered smudge under a rounded note — the bug that was reported.
 *
 * The second is arithmetic: how far `--shadow-sticky` reaches on each side,
 * read out of `index.css` in both themes, against the padding the board leaves
 * around its notes.
 */

import { describe, expect, it } from 'vitest'
import indexCss from '@/index.css?raw'

const sources = import.meta.glob('/src/components/dashboard/StickyBoard.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const board = sources['/src/components/dashboard/StickyBoard.tsx'] ?? ''

type Reach = { top: number; right: number; bottom: number; left: number }

/** How far a `box-shadow` value paints past its box, side by side. Outer shadows only. */
function shadowReach(value: string): Reach {
  const reach: Reach = { top: 0, right: 0, bottom: 0, left: 0 }
  for (const layer of value.split(/,(?![^(]*\))/)) {
    if (/\binset\b/.test(layer)) continue
    const lengths = layer.replace(/[a-z]+\([^)]*\)/gi, '')
    const [x = 0, y = 0, blur = 0, spread = 0] = [
      ...lengths.matchAll(/(-?\d*\.?\d+)px|\b0\b(?![.\d])/g),
    ].map((m) => (m[1] === undefined ? 0 : Number(m[1])))
    const out = blur + spread
    reach.top = Math.max(reach.top, out - y)
    reach.bottom = Math.max(reach.bottom, out + y)
    reach.left = Math.max(reach.left, out - x)
    reach.right = Math.max(reach.right, out + x)
  }
  return reach
}

/** Tailwind's spacing scale at a 16px root: `px-2.5` is 10px. */
const px = (step: string) => Number(step) * 4

const stickyShadows = [...indexCss.matchAll(/--shadow-sticky:\s*([^;]+);/g)].map((m) => m[1] ?? '')

describe('shadowReach', () => {
  it('measures each side of a layered shadow', () => {
    expect(
      shadowReach('0 1px 2px rgba(0, 0, 0, 0.08), 0 4px 10px -3px rgba(0, 0, 0, 0.14)'),
    ).toEqual({
      top: 3,
      right: 7,
      bottom: 11,
      left: 7,
    })
  })
})

describe('a sticky note’s shadow (Q293)', () => {
  it('is defined for both themes', () => {
    expect(stickyShadows).toHaveLength(2)
  })

  it('is on the rounded note itself', () => {
    const note = /<li\s+className=\{cn\(\s*'([^']*)'/.exec(board)?.[1]?.split(/\s+/) ?? []
    expect(note).toContain('rounded-md')
    expect(note).toContain('shadow-[var(--shadow-sticky)]')
  })

  it('fits inside the padding the board leaves around its notes', () => {
    const list =
      /<ul\s+aria-label=\{t\('sticky\.listLabel'\)\}\s+className="([^"]*)"/
        .exec(board)?.[1]
        ?.split(/\s+/) ?? []
    const pad = (prefix: string) => {
      const step = list.find((c) => c.startsWith(`${prefix}-`))?.slice(prefix.length + 1)
      return step === undefined ? 0 : px(step)
    }
    expect(list).toContain('overflow-y-auto')
    for (const shadow of stickyShadows) {
      const reach = shadowReach(shadow)
      expect(reach.left, shadow).toBeLessThanOrEqual(pad('px'))
      expect(reach.right, shadow).toBeLessThanOrEqual(pad('px'))
      expect(reach.top, shadow).toBeLessThanOrEqual(pad('pt'))
      expect(reach.bottom, shadow).toBeLessThanOrEqual(pad('pb'))
    }
  })
})
