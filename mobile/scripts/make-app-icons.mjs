/**
 * Draws both app launcher icons — Android's and iOS's — from jojo's mark.
 *
 * Both platforms shipped with the icon their template came with: React Native's
 * default on Android, an Expo-generated 1024 on iOS. So the home screen showed a
 * stranger's logo for an app whose browser tab, extension button and in-app
 * mascot are all the same robot. The drawing is `scripts/jojo-mark.mjs` at the
 * root of the repo, shared with the extension's toolbar icons so that the four
 * places jojo has a mark cannot drift apart.
 *
 * Run by hand — `npm -w jojo-mobile run make-app-icons` — and the output is
 * committed. Deliberately NOT a Gradle or Xcode step: a native build would then
 * need Node on the machine doing it, to regenerate files that change roughly
 * never.
 *
 * ANDROID GETS TWO LAYERS, not a set of finished icons:
 *
 *   ic_launcher_foreground   the robot alone, transparent behind it
 *   ic_launcher_monochrome   its silhouette, for Android 13's themed icons
 *
 * and `mipmap-anydpi-v26/ic_launcher.xml` stacks them over a background. Neither
 * the background nor the legacy whole-icon rasters are written here, and both
 * absences were decided by looking at a phone rather than at the docs:
 *
 * The BACKGROUND is one flat colour, so it is `@color/iconBackground` in
 * `values/colors.xml`. Five PNGs of one flat colour are five files that can
 * disagree with each other.
 *
 * The LEGACY `ic_launcher.png` / `ic_launcher_round.png` rasters are not written
 * either, and the first draft of this file did write them. `minSdkVersion 31`
 * puts every device this ships to above the `-v26` qualifier, so nothing
 * resolves `@mipmap/ic_launcher` to anything but the adaptive XML — which makes
 * them a second copy of the mark that nothing renders, and a second copy that
 * nothing renders is a second copy nobody notices going stale.
 *
 * iOS GETS ONE FILE, square and with no alpha channel. Both halves of that are
 * requirements rather than choices: iOS rounds the corners itself, and App Store
 * Connect rejects an icon that arrives carrying an alpha channel.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ADAPTIVE_SPAN, PALETTE, SILHOUETTE, paint, png } from '../../scripts/jojo-mark.mjs'

const MOBILE = dirname(dirname(fileURLToPath(import.meta.url)))
const RES = join(MOBILE, 'android', 'app', 'src', 'main', 'res')
const APPICON = join(MOBILE, 'ios', 'jojo', 'Images.xcassets', 'AppIcon.appiconset')

/** Android's density buckets and what one dp is worth in each. */
const DENSITIES = [
  ['mdpi', 1],
  ['hdpi', 1.5],
  ['xhdpi', 2],
  ['xxhdpi', 3],
  ['xxxhdpi', 4],
]

/** An adaptive layer is 108dp on a side, whatever the density. */
const ADAPTIVE_DP = 108

const LAYERS = [
  { name: 'ic_launcher_foreground', colors: PALETTE },
  { name: 'ic_launcher_monochrome', colors: SILHOUETTE },
]

/** Whole-icon rasters the template shipped, and the first draft of this wrote. */
const STALE = ['ic_launcher', 'ic_launcher_round', 'ic_launcher_background']

let written = 0

for (const [bucket, scale] of DENSITIES) {
  const dir = join(RES, `mipmap-${bucket}`)
  mkdirSync(dir, { recursive: true })

  for (const layer of LAYERS) {
    const size = Math.round(ADAPTIVE_DP * scale)
    const px = paint(size, { plate: 'none', span: ADAPTIVE_SPAN, colors: layer.colors })
    writeFileSync(join(dir, `${layer.name}.png`), png(size, px))

    // The template shipped these as WebP. Two files with one resource name in
    // one bucket is an AAPT2 error, not a preference, so the one being replaced
    // goes with it rather than waiting to break the next build.
    rmSync(join(dir, `${layer.name}.webp`), { force: true })
    written += 1
  }

  for (const name of STALE) {
    rmSync(join(dir, `${name}.png`), { force: true })
    rmSync(join(dir, `${name}.webp`), { force: true })
  }

  console.log(`  mipmap-${bucket}/ — ${String(LAYERS.length)} layers`)
}

mkdirSync(APPICON, { recursive: true })
writeFileSync(
  join(APPICON, 'App-Icon-1024x1024@1x.png'),
  png(1024, paint(1024, { plate: 'square' }), { opaque: true }),
)
written += 1
console.log('  AppIcon.appiconset/App-Icon-1024x1024@1x.png')

console.log(`make-app-icons: ${String(written)} files -> android/res + ios/Images.xcassets`)
