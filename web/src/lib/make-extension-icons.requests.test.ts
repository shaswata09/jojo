/**
 * Q139 — "the browser extension should use the same favicon of jojo icon and
 * should also be compiled and created in packages."
 *
 * The icons are drawn by `scripts/make-extension-icons.mjs` from the shared
 * mark in `scripts/jojo-mark.mjs`, whose geometry and palette are the
 * favicon's. Asserted on the files the extension actually ships: every icon the
 * manifest names is byte-for-byte what the mark paints at that size, and the
 * mark's colours are the favicon's own. The "compiled into a package" half is
 * `CaptureExtensionPanel.requests.test.ts` (Q110): the zip is packed from this
 * folder before every dev server and build.
 */
import { describe, expect, it } from 'vitest'
import manifest from '../../extension/manifest.json'
import favicon from '../../public/favicon.svg?raw'
import maker from '../../scripts/make-extension-icons.mjs?raw'

// @ts-expect-error TS2307 — node:fs has no types under tsconfig.app.json; the icons are binary files on disk.
const fs = (await import('node:fs')) as { readFileSync: (p: string) => Uint8Array }
// @ts-expect-error TS7016 — a plain ES module shared with the phone, untyped.
const mark = (await import('../../../scripts/jojo-mark.mjs')) as {
  PALETTE: Record<string, [number, number, number]>
  paint: (size: number, options: { plate: string }) => Uint8Array
  png: (size: number, rgba: Uint8Array) => Uint8Array
}

const EXTENSION = new URL('../../extension/', import.meta.url).pathname
const SIZES = ['16', '32', '48', '128'] as const

const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, i) => byte === b[i])

const hex = ([r, g, b]: [number, number, number]) =>
  `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`

describe('Q139 the extension wears the jojo favicon', () => {
  it('names an icon at every size, for the toolbar and the extensions page alike', () => {
    for (const size of SIZES) {
      expect(manifest.action.default_icon[size]).toBe(`icons/icon-${size}.png`)
      expect((manifest as { icons?: Record<string, string> }).icons?.[size]).toBe(
        `icons/icon-${size}.png`,
      )
    }
  })

  it('ships icons that are exactly the mark, painted on the favicon’s rounded plate', () => {
    expect(maker).toContain("import { paint, png } from '../../scripts/jojo-mark.mjs'")
    expect(maker).toContain("png(size, paint(size, { plate: 'rounded' }))")
    for (const size of SIZES) {
      const shipped = fs.readFileSync(`${EXTENSION}icons/icon-${size}.png`)
      const drawn = mark.png(Number(size), mark.paint(Number(size), { plate: 'rounded' }))
      expect(same(shipped, drawn), `icon-${size}.png`).toBe(true)
    }
  })

  it('draws the mark in the favicon’s own colours', () => {
    for (const [part, rgb] of Object.entries(mark.PALETTE)) {
      expect(favicon.toLowerCase(), part).toContain(hex(rgb))
    }
  })
})
