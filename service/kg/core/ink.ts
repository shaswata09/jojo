/**
 * Turning one colour a person picked into a chip that can be read.
 *
 * ## The problem this solves
 *
 * The eight preset colours each come as three values — the text, its tinted
 * background and its border — chosen by hand per theme and measured against
 * each other (`index.css` records the figures). A colour picked off a spectrum
 * has none of that. It arrives as a single hex, it has to work as text on a
 * tinted fill, and it has to do it on a white page AND on a near-black one,
 * without anybody there to measure it.
 *
 * Whatever is picked, the SAME three jobs have to be done: a legible ink, a
 * background tinted enough to read as that colour but not enough to fight the
 * text on it, and a border between the two. So the hue and the colourfulness
 * are the person's, and the LIGHTNESS is ours — forced into a band that the
 * contrast maths works out at, per theme.
 *
 * ## Why OKLCH
 *
 * Because "the same colour, lighter" is only a sane operation in a perceptual
 * space. Scaling sRGB channels toward white desaturates as it lightens, so a
 * picked red returns a pink and a picked yellow returns something close to
 * white; in OKLCH the hue and chroma stay where they were put and only the
 * lightness moves, which is the whole trick.
 *
 * ## What is guaranteed
 *
 * `ink.test.ts` sweeps all 360 hues at three chromas in both themes and asserts
 * every result clears 4.5:1 against its own background — WCAG AA for body text,
 * the same bar the presets were measured to. That sweep is the specification;
 * the constants below are only the numbers that satisfy it.
 *
 * No DOM, no CSS: the phone needs the same three values as literal colours, and
 * `color-mix()`/`oklch(from …)` exist in one of the two runtimes.
 */

/** A colour as the picker hands it over: '#rrggbb', lower case. */
export type Hex = string

export type Theme = 'light' | 'dark'

/** What a chip needs: text, its fill, and the line between them. */
export type Ink = { readonly fg: Hex; readonly soft: Hex; readonly border: Hex }

/**
 * The lightness each of the three sits at, per theme.
 *
 * Found by sweeping rather than chosen: these are the values at which every hue
 * at every chroma clears 4.5:1, with the fill still far enough from the panel
 * to read as a colour. Dark needs a brighter ink than light needs a darker one,
 * because the fill it sits on cannot go as dark as the light theme's can go
 * pale without losing the hue entirely.
 */
const BAND: Record<Theme, { fg: number; soft: number; border: number; chroma: number }> = {
  light: { fg: 0.45, soft: 0.965, border: 0.88, chroma: 0.9 },
  dark: { fg: 0.82, soft: 0.235, border: 0.35, chroma: 0.8 },
}

/* ------------------------------- conversion ------------------------------- */

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)

/** sRGB (0-1) to OKLab. Björn Ottosson's matrices, unchanged. */
function oklabOf(r: number, g: number, b: number): [number, number, number] {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)]
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** OKLab back to sRGB (0-1), clamped into gamut channel by channel. */
function srgbOf(L: number, a: number, bb: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * bb) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * bb) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * bb) ** 3
  return [
    clamp01(toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    clamp01(toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    clamp01(toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
  ]
}

const pair = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0')

/** '#rrggbb' from sRGB 0-1. */
const hexOf = (rgb: readonly [number, number, number]): Hex =>
  `#${pair(rgb[0])}${pair(rgb[1])}${pair(rgb[2])}`

/**
 * '#rgb' and '#RRGGBB' both in, 0-1 triple out; `null` for anything else.
 *
 * Strict on the way in because this is the boundary a stored value crosses: a
 * hex that came back from a backup, or from a tool call a model made up.
 */
export function rgbOf(hex: string): [number, number, number] | null {
  const text = hex.trim().toLowerCase()
  const short = /^#([0-9a-f]{3})$/.exec(text)
  const long = /^#([0-9a-f]{6})$/.exec(text)
  const digits = short ? [...short[1]!].map((d) => d + d).join('') : long?.[1]
  if (digits === undefined) return null
  return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ]
}

/**
 * A hex from whatever spelling a browser hands back.
 *
 * The DOM is the other boundary this app takes a colour across, and it does not
 * speak hex: the moment `#7c3aed` lands in a style attribute it is read back as
 * `rgb(124, 58, 237)`, so a stored-format parser that only knew hex would see a
 * colour it could not name in every note anybody had coloured.
 *
 * Deliberately NARROW even so — `#rgb`, `#rrggbb`, `rgb()` and an `rgba()` that
 * is fully opaque, and nothing else. Not `color(display-p3 …)`, not a CSS
 * keyword, not `var(--x)`. Everything it refuses is dropped rather than
 * rendered, which is the rule this module is built to keep: what comes out is
 * six hex digits or it is nothing.
 *
 * Transparency is refused rather than flattened. A half-transparent ink over a
 * fill this app chose is a contrast guarantee nobody can make, and silently
 * making it opaque would be answering a different question from the one asked.
 */
export function hexFromCss(value: string): Hex | null {
  const text = value.trim().toLowerCase()
  const direct = normaliseHex(text)
  if (direct !== null) return direct

  const fn = /^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*(?:[,/]\s*([\d.%]+)\s*)?\)$/.exec(
    text,
  )
  if (!fn) return null
  const alpha = fn[4]
  if (alpha !== undefined && alpha !== '1' && alpha !== '100%' && alpha !== '1.0') return null
  const channels = [fn[1], fn[2], fn[3]].map((n) => Number(n))
  if (channels.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null
  return hexOf(channels.map((n) => Math.round(n) / 255) as [number, number, number])
}

/** Whether a string is a colour this app will store. */
export const isHex = (value: string): boolean => rgbOf(value) !== null

/** '#rrggbb' for a value that parses, so storage holds one spelling. */
export const normaliseHex = (value: string): Hex | null => {
  const rgb = rgbOf(value)
  return rgb === null ? null : hexOf(rgb)
}

/* --------------------------------- the rule -------------------------------- */

/** The same hue and chroma at a given lightness, back in sRGB. */
function atLightness(rgb: readonly [number, number, number], L: number, chromaScale: number): Hex {
  const [, a, b] = oklabOf(rgb[0], rgb[1], rgb[2])
  /*
   * Chroma is scaled, not preserved. A fully saturated hue at the ink's
   * lightness is often outside sRGB, and clamping a channel there shifts the
   * hue — a picked violet comes back blue. Pulling the chroma in slightly keeps
   * the conversion inside the gamut for every hue in the sweep.
   */
  return hexOf(srgbOf(L, a * chromaScale, b * chromaScale))
}

/**
 * The three values a chip needs, for one picked colour in one theme.
 *
 * The person's hue and chroma survive; the lightness is replaced. A colour
 * picked as a pale pastel and a colour picked as a deep plum therefore produce
 * chips that are equally readable, which is the point — the alternative is a
 * palette where half the choices are unreadable and the app looks broken rather
 * than the choice looking wrong.
 */
export function inkOf(hex: string, theme: Theme): Ink | null {
  const rgb = rgbOf(hex)
  if (rgb === null) return null
  const band = BAND[theme]
  return {
    fg: atLightness(rgb, band.fg, band.chroma),
    /*
     * The fill and the border keep far less chroma than the ink. At full
     * chroma a 0.965-lightness fill is a neon wash that the ink cannot be read
     * on; these are the values the sweep passes at.
     */
    soft: atLightness(rgb, band.soft, theme === 'light' ? 0.22 : 0.5),
    border: atLightness(rgb, band.border, theme === 'light' ? 0.35 : 0.6),
  }
}
