import { describe, expect, it } from 'vitest'
import { hexOfHsv } from '@jojo/service/core/ink'
import spectrum from '@/components/common/SpectrumSwatch.tsx?raw'
import toneSwatches from '@/components/common/ToneSwatches.tsx?raw'
import richText from '@/components/common/RichTextEditor.tsx?raw'

/**
 * The full-spectrum colour picker (G6).
 *
 * Q267 — every colour choice offers it beside the presets, and a picked colour
 * is kept as the colour it is (persistence: `note-format.test.ts` for the
 * editor, `validate-props-vault.requests.test.ts` for keywords).
 * Q282 — clicking or dragging inside it keeps it open and keeps the selection,
 * and the handle can be dragged to any colour, white included.
 *
 * Source reads (D20); comments stripped.
 */
const strip = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const picker = strip(spectrum)

/** The opening tag of each slider surface: the square, then the hue strip. */
const surfaces = [...picker.matchAll(/<div\s+ref=\{(area|strip)\}([\s\S]*?)\n\s*>/g)].map((m) => ({
  name: m[1]!,
  attrs: m[2]!,
}))

describe('the picker is offered wherever a colour is chosen (Q267)', () => {
  it('beside the eight keyword colours', () => {
    expect(strip(toneSwatches)).toMatch(/<SpectrumSwatch\b[\s\S]*?onPick=\{\(hex\) => onChange\(value, hex\)\}/)
  })

  it('in the editor’s text colour menu', () => {
    expect(strip(richText)).toMatch(/<SpectrumPicker value=\{undefined\} onCommit=\{\(hex\) => exec\('foreColor', hex\)\} \/>/)
  })

  it('is built in the page, not the operating system’s panel', () => {
    expect(picker).not.toMatch(/type="color"/)
  })
})

describe('using the picker (Q282)', () => {
  it('found both surfaces', () => {
    expect(surfaces.map((s) => s.name)).toEqual(['area', 'strip'])
  })

  it('keeps focus and the text selection where they were on a click', () => {
    for (const s of surfaces) {
      expect(s.attrs, s.name).toMatch(/onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/)
    }
  })

  it('captures the pointer, so a drag survives leaving the popover', () => {
    for (const s of surfaces) expect(s.attrs, s.name).toMatch(/onPointerDown=\{drag\(/)
    expect(picker).toMatch(/el\.setPointerCapture\(event\.pointerId\)/)
    expect(picker).toMatch(/el\.addEventListener\('pointermove', move\)/)
  })

  it('applies the colour once, on release, rather than on every frame', () => {
    expect(picker).toMatch(/const end = \(\) => \{[\s\S]*?onCommit\(hexOfHsv\(current\)\)/)
    expect(picker).toMatch(/el\.addEventListener\('pointerup', end\)/)
  })

  it('maps the square’s top-left corner to white', () => {
    // fromArea: s across, v down — so x=0, y=0 is s=0, v=1.
    expect(picker).toMatch(/return \{ h: base\.h, s: fx, v: 1 - fy \}/)
    expect(hexOfHsv({ h: 262, s: 0, v: 1 })).toBe('#ffffff')
  })

  it('clamps the point to the square, so its corners are reachable', () => {
    expect(picker).toMatch(/fx: Math\.min\(1, Math\.max\(0, \(x - r\.left\) \/ r\.width\)\)/)
    expect(picker).toMatch(/fy: Math\.min\(1, Math\.max\(0, \(y - r\.top\) \/ r\.height\)\)/)
  })
})
