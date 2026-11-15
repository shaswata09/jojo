/**
 * Q150 — the Android and iOS launcher icons are jojo's favicon robot.
 *
 * Both platforms shipped with their template's icon (React Native's on Android,
 * an Expo-generated one on iOS). The fix draws them from `scripts/jojo-mark.mjs`
 * — the favicon's geometry and palette rasterised in plain Node — via
 * `mobile/scripts/make-app-icons.mjs`, and commits the output.
 *
 * So the strongest check available without a phone is the one this makes:
 * re-draw every launcher image from the mark and compare it byte for byte with
 * what is committed. A template icon restored by a native upgrade, a stale icon
 * after the favicon moved, or a manifest pointing somewhere else all go red.
 * The palette is also checked against `web/public/favicon.svg` itself, so the
 * mark cannot drift from the favicon it claims to be.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
// The shared drawing — the same module the extension's toolbar icons use.
import { ADAPTIVE_SPAN, PALETTE, SILHOUETTE, paint, png } from '../../../scripts/jojo-mark.mjs'

const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ROOT = path.resolve(MOBILE, '..')
const RES = path.join(MOBILE, 'android/app/src/main/res')
const APPICON = path.join(MOBILE, 'ios/jojo/Images.xcassets/AppIcon.appiconset')

/** The densities and dp scale `make-app-icons.mjs` writes. */
const DENSITIES = [
  ['mdpi', 1],
  ['hdpi', 1.5],
  ['xhdpi', 2],
  ['xxhdpi', 3],
  ['xxxhdpi', 4],
] as const

const hex = (rgb: readonly number[]) =>
  `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`

describe('the launcher icons are the favicon robot', () => {
  it('draws with the favicon colours', () => {
    const svg = readFileSync(path.join(ROOT, 'web/public/favicon.svg'), 'utf8').toLowerCase()
    for (const rgb of Object.values(PALETTE) as number[][]) {
      expect(svg).toContain(`fill="${hex(rgb)}"`)
    }
  })

  it.each(DENSITIES)('Android mipmap-%s layers are the mark, redrawn exactly', (bucket, scale) => {
    const size = Math.round(108 * scale)
    const layers: [string, typeof PALETTE][] = [
      ['ic_launcher_foreground', PALETTE],
      // The silhouette knocks the plate and visor out with null, which the
      // inferred type of `paint`'s default does not admit; the script passes it.
      ['ic_launcher_monochrome', SILHOUETTE as unknown as typeof PALETTE],
    ]
    for (const [name, colors] of layers) {
      const expected = png(size, paint(size, { plate: 'none', span: ADAPTIVE_SPAN, colors }))
      const committed = readFileSync(path.join(RES, `mipmap-${bucket}`, `${name}.png`))
      expect(Buffer.compare(committed, expected), `${bucket}/${name}`).toBe(0)
    }
  })

  it('iOS App Store icon is the mark, redrawn exactly and opaque', () => {
    const expected = png(1024, paint(1024, { plate: 'square' }), { opaque: true })
    const committed = readFileSync(path.join(APPICON, 'App-Icon-1024x1024@1x.png'))
    expect(Buffer.compare(committed, expected)).toBe(0)
  })

  it('is the icon both apps actually use', () => {
    const manifest = readFileSync(path.join(RES, '../AndroidManifest.xml'), 'utf8')
    expect(manifest).toContain('android:icon="@mipmap/ic_launcher"')
    expect(manifest).toContain('android:roundIcon="@mipmap/ic_launcher_round"')
    for (const xml of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
      const adaptive = readFileSync(path.join(RES, 'mipmap-anydpi-v26', xml), 'utf8')
      expect(adaptive).toContain('@mipmap/ic_launcher_foreground')
      expect(adaptive).toContain('@mipmap/ic_launcher_monochrome')
    }
    const contents = JSON.parse(readFileSync(path.join(APPICON, 'Contents.json'), 'utf8')) as {
      images: { filename?: string }[]
    }
    expect(contents.images.map((i) => i.filename)).toEqual(['App-Icon-1024x1024@1x.png'])
    const pbx = readFileSync(path.join(MOBILE, 'ios/jojo.xcodeproj/project.pbxproj'), 'utf8')
    expect(pbx).toMatch(/ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;/)
  })
})
