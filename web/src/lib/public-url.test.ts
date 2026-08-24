/**
 * Vendored assets resolve under whatever base the app is served from.
 *
 * The bug this guards against is invisible in development and invisible in the
 * console: at `base: '/'` a root-absolute path is correct, and on GitHub Pages
 * — served at `/<repo>/` — it 404s and the 3D mascot silently becomes the 2D
 * fallback, which is a fallback doing its job and therefore says nothing.
 *
 * `import.meta.env.BASE_URL` is substituted by Vite at build time, so these
 * assert the shape rather than the deployed value; the deployed value is
 * checked by building with `BASE_PATH` set and grepping the bundle.
 */

import { describe, expect, it } from 'vitest'
import { publicUrl } from './public-url'

describe('addressing a file vendored into public/', () => {
  it('hangs the path off the app’s base', () => {
    expect(publicUrl('mascot.splinecode')).toBe(`${import.meta.env.BASE_URL}mascot.splinecode`)
  })

  it('accepts a nested path', () => {
    expect(publicUrl('transfer/scene.png')).toBe(`${import.meta.env.BASE_URL}transfer/scene.png`)
  })

  /*
   * `BASE_URL` always ends in a slash, so a caller who writes the leading one
   * out of habit must not get `//`. A double slash resolves on most servers and
   * breaks on some, which is the worst kind of nearly-working.
   */
  it('does not double the separator when the caller writes a leading slash', () => {
    expect(publicUrl('/mascot.splinecode')).toBe(publicUrl('mascot.splinecode'))
    expect(publicUrl('///transfer/scene.png')).toBe(publicUrl('transfer/scene.png'))
    expect(publicUrl('/x')).not.toContain('//x')
  })

  it('never returns a bare root-absolute path, which is the bug itself', () => {
    // True at base '/' too: the point is that the value always comes FROM the
    // base rather than being written independently of it.
    expect(publicUrl('mascot.splinecode').startsWith(import.meta.env.BASE_URL)).toBe(true)
  })
})
