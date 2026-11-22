/**
 * Writes the licence notices the phone app shows on Guide → Built with.
 *
 * ## Why
 *
 * The APK carries some 770 npm packages — React Native, its own dependencies,
 * the Firebase SDK and everything the screens import — and until this script it
 * carried the notice of none of them: the fonts' `OFL.txt` was the only licence
 * text in the package. MIT, ISC and BSD ask for the copyright line and the
 * permission notice to travel with the code, Apache-2.0 (`jsqr`, the
 * `@react-native-firebase` modules, the `@firebase` JS SDK) asks for the licence
 * and any NOTICE file, and a minified bundle keeps none of them.
 *
 * ## What it writes
 *
 * `src/screens/guide/third-party-notices.json`, which the Built with page
 * imports. A module the bundle already contains rather than a file in
 * `android/…/assets`, so one copy reaches both platforms and nothing native has
 * to be taught where it is.
 *
 * Built from the production dependency tree (`productionTree` in
 * `web/scripts/licence-notices.mjs` — the same set `npm ls --omit=dev --all
 * -w mobile` prints, checked to agree when this was written), not from what
 * Metro bundles: there is no hook that reports Metro's module list the way
 * Vite's does. That over-credits the few build-time packages React Native
 * lists as dependencies, which is the harmless direction.
 *
 * The MIT, ISC and Apache-2.0 bodies are stored once, and each package keeps
 * its own copyright lines and anything its file says beyond the standard body.
 * Without that the file is mostly six hundred copies of the same three
 * paragraphs, inside the JavaScript every launch parses.
 *
 * ## The native libraries
 *
 * The apps also ship code that is not an npm package: the Maven artefacts
 * Gradle packages into the APK (AndroidX, Kotlin, OkHttp, Fresco, SoLoader,
 * fbjni, Hermes, the Firebase SDK and Play services …) and the pods CocoaPods
 * links into the iOS app (the Firebase pods, GoogleUtilities, nanopb,
 * PromisesObjC, and the C++ libraries React Native fetches — Folly, glog,
 * boost, fmt, double-conversion, fast_float). They make up the `native`
 * section, one list per platform, shaped like the package rows.
 *
 * Reading them needs Gradle, the Gradle cache and the Pods tree, which neither
 * the test nor CI has, so it is a separate, explicit step whose result is
 * committed: `native-inventory.json` beside this file (see
 * `native-notices.mjs`). It holds:
 *
 * - Android: every component of `:app`'s `releaseRuntimeClasspath`, resolved
 *   by Gradle itself through `native-inventory.gradle` (an init script; it is
 *   not applied to any build). For each artefact that packages a file, the
 *   licences its POM states — following `<parent>` POMs, as Maven inherits
 *   them — and, read out of the AAR/JAR (and an AAR's `classes.jar`), every
 *   LICENSE and NOTICE file verbatim and the `third_party_licenses` list
 *   Google's artefacts carry for the code bundled in them. Components that
 *   package nothing (BOMs, Kotlin Multiplatform roots) are listed apart.
 *   React Native's C++ libraries are compiled into react-android's
 *   `libreactnative.so` rather than shipped as artefacts; they are credited
 *   under react-android, at the versions react-native's
 *   `gradle/libs.versions.toml` builds, when the AAR carries their headers.
 * - iOS: the pods `Podfile.lock` resolves from the CocoaPods trunk or from
 *   React Native's `:podspec:`s (the `:path:` pods are npm packages, already
 *   listed), with the licence type and text from the acknowledgements plist
 *   CocoaPods writes on `pod install`.
 *
 * Licence names become SPDX ids only when a name maps to exactly one ("BSD
 * License" does not); anything else is kept as the source states it, and a
 * library whose POM or podspec states no licence is shown as stating none.
 * Nothing is filled in by hand.
 *
 * Deliberately not listed: `libc++_shared.so`, which the NDK supplies — LLVM's
 * Apache-2.0 with LLVM Exceptions waives the notice for compiled forms.
 * Known gap: Fresco's `libgifimage.so` and `libstatic-webp.so` compile in
 * giflib and libwebp, and the Fresco artefacts ship no licence text for them.
 *
 * ## Running it
 *
 *   node mobile/scripts/third-party-notices.mjs   rewrite the JSON from
 *                                           node_modules and the committed
 *                                           native inventory
 *   node mobile/scripts/third-party-notices.mjs --check
 *                                           exit 1 if the JSON is stale
 *   node mobile/scripts/third-party-notices.mjs --native [--online]
 *                                           rewrite native-inventory.json
 *                                           from Gradle and ios/Pods, then
 *                                           the JSON
 *
 * Run the plain form after any `npm install` that changes the phone's
 * dependencies.
 *
 * Run `--native` after anything that can change the native libraries: a
 * dependency line in `android/build.gradle` or `android/app/build.gradle`,
 * `hermesEnabled`/`newArchEnabled` in `gradle.properties`, an upgrade of
 * React Native, of a native npm module or of `@react-native-firebase/*`
 * (which pins the Firebase BoM and pods), and every `pod install` that changes
 * `ios/Podfile.lock`. It needs `mobile/android/gradlew` to run (JDK 17, which
 * the Gradle daemon settings provide) and `mobile/ios/Pods` to match
 * `Podfile.lock`, so run `pod install` first. Gradle runs `--offline`, which
 * works once the artefacts and POMs are in the Gradle cache; the first run
 * on a machine, or after an upgrade, needs `--online` so Gradle can fetch the
 * POMs (when this was written the cache held every artefact a build had used
 * and none of their POMs). It stops, naming the fix, rather than write an
 * inventory with holes in it.
 *
 * The test beside the JSON (`third-party-notices.test.ts`) regenerates the
 * JSON in memory from node_modules and the inventory and fails when the two
 * differ, so a stale file cannot pass the gate. It also fails when the
 * inventory no longer matches the build: when `Podfile.lock` resolves other
 * pods, or the Android dependency lines and native npm modules it was
 * collected from have changed. It needs no network, Gradle or Xcode.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SHARED_TEXTS,
  noticeFor,
  productionTree,
  uniqueNotices,
} from '../../web/scripts/licence-notices.mjs'
import { INVENTORY, collectInventory, nativeSection } from './native-notices.mjs'

const MOBILE = dirname(dirname(fileURLToPath(import.meta.url)))
export const OUT = join(MOBILE, 'src', 'screens', 'guide', 'third-party-notices.json')

/**
 * What ships in the app that is not an npm package, so the tree walk cannot
 * find it. Each says where its terms are rather than paraphrasing them.
 */
function extras() {
  return [
    {
      heading: 'Inter and JetBrains Mono (SIL Open Font License 1.1)',
      // The file that sits beside the .ttf files in the APK, quoted whole, so
      // the notice on screen and the one in the package are the same text.
      text: readFileSync(
        join(MOBILE, 'android', 'app', 'src', 'main', 'assets', 'fonts', 'OFL.txt'),
        'utf8',
      )
        .replace(/\r\n?/g, '\n')
        .trim(),
    },
    {
      heading: 'Firebase and Google Play services (Google terms)',
      // The native lists below credit these SDKs artefact by artefact, but
      // several are closed source: their POM names the Android SDK License, or
      // their podspec names no licence at all. What governs them is Google's
      // terms, which no licence file in the artefact says.
      text: [
        "Google's native Firebase SDKs (Firebase Analytics and Firebase Crashlytics) and the Google Play",
        'services libraries they depend on are provided by Google LLC. Their use is governed by the Google',
        'APIs Terms of Service (https://developers.google.com/terms) and the Firebase terms',
        '(https://firebase.google.com/terms); the Android artefacts that are not open source state the',
        'Android Software Development Kit License (https://developer.android.com/studio/terms.html). The',
        'parts Google publishes as open source carry their own licences, and the third-party code Google',
        'bundles inside them is listed under each artefact below. Collection by both SDKs is off by default',
        '(mobile/firebase.json) and is switched on only from Settings.',
      ].join('\n'),
    },
  ]
}

/** The committed native inventory (see `native-notices.mjs`). */
export function readInventory() {
  return JSON.parse(readFileSync(INVENTORY, 'utf8'))
}

/** The whole file, as an object — what the test compares against the committed JSON. */
export function build(inventory = readInventory()) {
  const kinds = ['Apache-2.0', 'MIT', 'ISC']
  const packages = uniqueNotices(productionTree(MOBILE).map((p) => noticeFor(p.dir, kinds)))
  const native = nativeSection(inventory)
  const used = new Set(
    [...packages, ...native.android, ...native.ios].flatMap((p) => p.shared),
  )
  return {
    about:
      'Generated by mobile/scripts/third-party-notices.mjs from the production dependency tree and mobile/scripts/native-inventory.json. Do not edit by hand.',
    shared: Object.fromEntries(kinds.filter((k) => used.has(k)).map((k) => [k, SHARED_TEXTS[k]])),
    extra: extras(),
    native,
    packages,
  }
}

/** Serialised exactly as committed: two-space JSON and a final newline. */
export const serialise = (data) => `${JSON.stringify(data, null, 2)}\n`

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--native')) {
    const inventory = collectInventory({ online: process.argv.includes('--online') })
    writeFileSync(INVENTORY, serialise(inventory))
    console.log(
      `third-party-notices: ${String(inventory.android.artifacts.length)} Android artefacts, ${String(inventory.ios.pods.length)} iOS pods → ${INVENTORY}`,
    )
  }
  const next = serialise(build())
  if (process.argv.includes('--check')) {
    let current = ''
    try {
      current = readFileSync(OUT, 'utf8')
    } catch {
      // Missing reads as stale.
    }
    if (current !== next) {
      console.error(
        'third-party-notices: src/screens/guide/third-party-notices.json is stale. Run: node mobile/scripts/third-party-notices.mjs',
      )
      process.exit(1)
    }
    console.log('third-party-notices: up to date')
  } else {
    writeFileSync(OUT, next)
    const data = JSON.parse(next)
    console.log(
      `third-party-notices: ${String(data.packages.length)} packages, ${String(data.native.android.length)} Android artefacts, ${String(data.native.ios.length)} iOS pods, ${String(Math.round(next.length / 1024))}KB → ${OUT}`,
    )
  }
}
