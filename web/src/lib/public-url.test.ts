/**
 * Vendored assets resolve under whatever base the app is served from.
 *
 * The bug this guards against is invisible in development and invisible in the
 * console: at `base: '/'` a root-absolute path is correct, and on GitHub Pages
 * — served at `/<repo>/` — it 404s. It was found as the 3D mascot silently
 * becoming the 2D fallback, when the mascot was still a scene file loaded from
 * `public/`; the Transfer scene's textures are loaded the same way now.
 *
 * `import.meta.env.BASE_URL` is substituted by Vite at build time, so these
 * assert the shape rather than the deployed value; the deployed value is
 * checked by building with `BASE_PATH` set and grepping the bundle.
 */

import { describe, expect, it } from 'vitest'
import { publicUrl } from './public-url'

describe('addressing a file vendored into public/', () => {
  it('hangs the path off the app’s base', () => {
    expect(publicUrl('favicon.svg')).toBe(`${import.meta.env.BASE_URL}favicon.svg`)
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
    expect(publicUrl('/favicon.svg')).toBe(publicUrl('favicon.svg'))
    expect(publicUrl('///transfer/scene.png')).toBe(publicUrl('transfer/scene.png'))
    expect(publicUrl('/x')).not.toContain('//x')
  })

  it('never returns a bare root-absolute path, which is the bug itself', () => {
    // True at base '/' too: the point is that the value always comes FROM the
    // base rather than being written independently of it.
    expect(publicUrl('transfer/scene.png').startsWith(import.meta.env.BASE_URL)).toBe(true)
  })
})
