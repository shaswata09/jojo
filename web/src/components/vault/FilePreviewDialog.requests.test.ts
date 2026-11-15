/**
 * Q252 and Q255: the file preview dialog was widened — first by a quarter over
 * the shared content-modal width, then measured against the window instead.
 *
 * Widths are CSS (D20), so the class is pinned and the arithmetic it implies is
 * checked against the shared width it replaced, both read out of their sources
 * rather than restated here: from `lg` up — where the sidebar is in the row —
 * the preview is at least a quarter wider than `contentModal` at every window
 * width up to 2560px.
 *
 * Below `lg` (640–1023px) the window-measured width comes out slightly under a
 * quarter wider (880px against 900px at 1000px), though still wider than the
 * shared modal; that range is deliberately not claimed here.
 */

import { describe, expect, it } from 'vitest'
import dialogSource from './FilePreviewDialog.tsx?raw'
import indexCss from '@/index.css?raw'

const strip = (source: string) =>
  source.replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')

const dialog = strip(dialogSource)
const css = indexCss.replace(/\/\*[\s\S]*?\*\//g, '')

/** `sm:max-w-[min(1440px,88vw)]` → { cap: 1440, vw: 0.88 }. */
function previewWidth() {
  const m = /'sm:max-w-\[min\((\d+)px,(\d+)vw\)\]'/.exec(dialog)
  if (!m) throw new Error('the preview dialog no longer sizes itself against the window')
  return { cap: Number(m[1]), vw: Number(m[2]) / 100 }
}

/** The `lg` column and the modal's share of it, read out of index.css. */
function sharedModal() {
  const lg = /@media \(min-width: 64rem\)\s*\{\s*:root\s*\{\s*--page-content: calc\(min\(100vw, (\d+)px\) - ([\d.]+)rem - (\d+)px - ([\d.]+)rem\);/.exec(css)
  const share = /--modal-width: calc\(var\(--page-content\) \* ([\d.]+)\);/.exec(css)
  if (!lg || !share) throw new Error('index.css no longer spells the shell widths this reads')
  const [, cap, pad, rail, gap] = lg.map(Number)
  return (vw: number) =>
    (Math.min(vw, cap as number) - (pad as number) * 16 - (rail as number) - (gap as number) * 16) *
    Number(share[1])
}

describe('the file preview dialog’s width (Q252, Q255)', () => {
  it('does not take the shared content-modal width', () => {
    expect(dialog).not.toMatch(/\bcontentModal\b/)
  })

  it('is measured against the window, capped so Expand still means something', () => {
    const { cap, vw } = previewWidth()
    expect(cap).toBe(1440)
    expect(vw).toBeLessThan(0.96) // full screen is `w-[96vw]`
  })

  it('is at least a quarter wider than the shared modal at every desktop width', () => {
    const { cap, vw } = previewWidth()
    const modal = sharedModal()
    for (let width = 1024; width <= 2560; width += 8) {
      const preview = Math.min(cap, vw * width)
      expect(preview, `at ${String(width)}px`).toBeGreaterThanOrEqual(1.25 * modal(width))
    }
  })
})
