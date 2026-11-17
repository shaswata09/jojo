/**
 * Q110 — "enable user install that browser extension from this application so
 * that we do not need to launch in the chrome extension store … reuse the
 * extension and build it."
 *
 * Settings offers the extension as a download of the very folder this repo
 * ships, `web/extension`, zipped by `scripts/pack-extension.mjs` into
 * `public/jojo-extension.zip` — and both `npm run dev` and `npm run build` run
 * that pack first, which is what keeps the button from downloading Vite's SPA
 * fallback as a fake .zip. All of it is markup, a script and package.json, so
 * it is read as text (D20).
 */
import { describe, expect, it } from 'vitest'
import panel from './CaptureExtensionPanel.tsx?raw'
import settings from '@/routes/Settings.tsx?raw'
import pack from '../../../scripts/pack-extension.mjs?raw'
import pkg from '../../../package.json'

describe('Q110 the extension is installed from Settings, not from a store', () => {
  it('offers the packed extension as a download in the capture panel', () => {
    expect(panel).toMatch(
      /<a href=\{publicUrl\('jojo-extension\.zip'\)\} download="jojo-extension\.zip">/,
    )
  })

  it('mounts that panel on the Settings page', () => {
    expect(settings).toMatch(/<CaptureExtensionPanel \/>/)
  })

  it('packs the zip from the repo’s own extension folder into public/', () => {
    expect(pack).toContain("const SOURCE = join(WEB, 'extension')")
    expect(pack).toContain("const OUT = join(PUBLIC, 'jojo-extension.zip')")
  })

  it('packs it before every dev server and every build', () => {
    // `--dev` keeps the localhost ports in the dev server's zip; the build's
    // zip leaves them out (scripts/extension-origins.mjs, review 2 security-1).
    expect(pkg.scripts.dev).toMatch(/^npm run pack-extension -- --dev && /)
    expect(pkg.scripts.build).toMatch(/^npm run pack-extension && /)
    expect(pkg.scripts['pack-extension']).toContain('node scripts/pack-extension.mjs')
  })
})
