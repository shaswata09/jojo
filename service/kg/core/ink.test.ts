import { describe, expect, it } from 'vitest'
import { hexFromCss, inkOf, isHex, normaliseHex, rgbOf } from './ink'
import type { Theme } from './ink'

/** WCAG 2.x relative luminance, written out so the assertion owes nothing. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const rgb = rgbOf(hex)
    if (rgb === null) throw new Error(`not a colour: ${hex}`)
    const [r, g, bl] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

/** Every hue, at three colourfulnesses, as a picker would hand them over. */
function sweep(): string[] {
  const out: string[] = []
  for (let hue = 0; hue < 360; hue += 1) {
    for (const [sat, light] of [
      [1, 0.5],
      [0.45, 0.6],
      [0.9, 0.25],
    ] as const) {
      const c = (1 - Math.abs(2 * light - 1)) * sat
      const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
      const m = light - c / 2
      const seg = Math.floor(hue / 60) % 6
      const rgb = [
        [c, x, 0],
        [x, c, 0],
        [0, c, x],
        [0, x, c],
        [x, 0, c],
        [c, 0, x],
      ][seg]!.map((v) => Math.round((v + m) * 255))
      out.push(`#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`)
    }
  }
  return out
}

describe('any colour a person can pick', () => {
  /*
   * THE SPECIFICATION, and the reason this module exists as maths rather than
   * as a list. The eight presets were measured one at a time by hand; a
   * spectrum cannot be, so the guarantee has to be a property of the rule.
   *
   * 4.5:1 is WCAG AA for body text — the bar the presets were held to, and a
   * chip is body text on a fill.
   */
  for (const theme of ['light', 'dark'] as const satisfies readonly Theme[]) {
    it(`is readable on its own fill, ${theme} theme, at every hue`, () => {
      const failures = sweep()
        .map((picked) => ({ picked, ink: inkOf(picked, theme)! }))
        .filter(({ ink }) => contrast(ink.fg, ink.soft) < 4.5)
        .slice(0, 5)
      expect(failures, `${String(failures.length)} hue(s) came back unreadable`).toEqual([])
    })

    it(`keeps the fill distinct from the border, ${theme} theme`, () => {
      // Without this the chip has no edge and reads as a smudge rather than a
      // pill — the tick is the only cue left, and the swatch has none.
      const flat = sweep().filter((picked) => {
        const ink = inkOf(picked, theme)!
        return contrast(ink.border, ink.soft) < 1.15
      })
      expect(flat.slice(0, 5)).toEqual([])
    })
  }

  it('keeps the hue the person chose', () => {
    // A red must not come back pink and a violet must not come back blue —
    // which is what happens when a colour is lightened by scaling sRGB
    // channels instead of moving through a perceptual space.
    const red = inkOf('#ff0000', 'light')!
    const [r, g, b] = rgbOf(red.fg)!
    expect(r).toBeGreaterThan(g)
    expect(r).toBeGreaterThan(b)

    const violet = inkOf('#7c3aed', 'dark')!
    const [vr, vg, vb] = rgbOf(violet.fg)!
    expect(vb).toBeGreaterThan(vg)
    expect(vr).toBeGreaterThan(vg)
  })

  it('answers differently for the two themes', () => {
    // The stored value is one colour; what is drawn is not. A single pair
    // would be unreadable on one of the two surfaces, which is the whole
    // reason the derivation takes a theme.
    const light = inkOf('#3b82f6', 'light')!
    const dark = inkOf('#3b82f6', 'dark')!
    expect(light.fg).not.toBe(dark.fg)
    expect(contrast(light.soft, '#ffffff')).toBeLessThan(1.3)
    expect(contrast(dark.soft, '#1f1f1f')).toBeLessThan(1.3)
  })
})

describe('what counts as a colour', () => {
  it('takes both spellings and stores one', () => {
    expect(normaliseHex('#ABC')).toBe('#aabbcc')
    expect(normaliseHex('#A1B2C3')).toBe('#a1b2c3')
    expect(normaliseHex('  #a1b2c3  ')).toBe('#a1b2c3')
  })

  it('refuses anything else, because this is a boundary', () => {
    // A value off a backup file, or invented by a model in a tool call.
    for (const bad of ['red', '#abcd', 'rgb(1,2,3)', '#12345g', '', 'javascript:alert(1)']) {
      expect(isHex(bad), bad).toBe(false)
      expect(normaliseHex(bad), bad).toBeNull()
    }
  })
})

describe('a colour coming back from the DOM', () => {
  /*
   * The browser rewrites a hex into `rgb()` the moment it lands in a style
   * attribute, so this is the spelling every stored note is actually read back
   * in — and a parser that only knew hex would drop every custom colour
   * anybody had used.
   */
  it('reads the spelling a browser hands back', () => {
    expect(hexFromCss('rgb(124, 58, 237)')).toBe('#7c3aed')
    expect(hexFromCss('rgb(124 58 237)')).toBe('#7c3aed')
    expect(hexFromCss('rgba(124, 58, 237, 1)')).toBe('#7c3aed')
    expect(hexFromCss('#7C3AED')).toBe('#7c3aed')
    expect(hexFromCss('#abc')).toBe('#aabbcc')
  })

  it('refuses anything it cannot be sure of', () => {
    for (const bad of [
      'red',
      'currentColor',
      'var(--kw-cyan)',
      'color(display-p3 1 0 0)',
      'rgb(300, 0, 0)',
      'url(evil)',
      '',
    ]) {
      expect(hexFromCss(bad), bad).toBeNull()
    }
  })

  it('refuses a transparent colour rather than flattening it', () => {
    // Half-transparent ink over a fill this app chose is a contrast guarantee
    // nobody can make.
    expect(hexFromCss('rgba(124, 58, 237, 0.5)')).toBeNull()
    expect(hexFromCss('rgba(124, 58, 237, 50%)')).toBeNull()
  })
})
