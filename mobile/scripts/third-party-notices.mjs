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
 * Vite's does, and native-only packages ship in the APK without passing through
 * Metro at all. That over-credits the few build-time packages React Native
 * lists as dependencies, which is the harmless direction.
 *
 * The MIT, ISC and Apache-2.0 bodies are stored once, and each package keeps
 * its own copyright lines and anything its file says beyond the standard body.
 * Without that the file is mostly six hundred copies of the same three
 * paragraphs, inside the JavaScript every launch parses.
 *
 * ## Running it
 *
 *   node mobile/scripts/third-party-notices.mjs   rewrite the file
 *   node mobile/scripts/third-party-notices.mjs --check
 *                                           exit 1 if it is stale
 *
 * Run it after any `npm install` that changes the phone's dependencies. The
 * test beside the JSON (`third-party-notices.test.ts`) regenerates it in memory
 * and fails when the two differ, so a stale file cannot pass the gate.
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
      heading: 'Native libraries not yet listed (Android and iOS)',
      // This file is generated from npm's tree, and the native side of the app
      // is not in that tree. Saying "every package" without this section would
      // claim more than the list holds.
      text: [
        'This list is generated from the npm packages the app is built from. It does not yet list the',
        'native libraries that React Native and its modules link into the Android app (from Maven, through',
        'Gradle) and the iOS app (from CocoaPods). The main ones are:',
        '',
        '- AndroidX libraries and the Kotlin standard library (Apache-2.0, Google and JetBrains)',
        '- OkHttp and Okio (Apache-2.0, Square)',
        '- Fresco and the Hermes engine (MIT, Meta Platforms); SoLoader and fbjni (Apache-2.0, Meta Platforms)',
        '- Folly, glog, boost, fmt and double-conversion, built into React Native (Apache-2.0, BSD-3-Clause,',
        '  Boost Software License 1.0, MIT and BSD-3-Clause respectively)',
        "- Google's native Firebase SDKs: Firebase Analytics and Firebase Crashlytics, with the Google Play",
        '  services and Google libraries they depend on on Android (Firebase BoM, read from',
        '  @react-native-firebase/app\'s "sdkVersions"), and the Firebase pods on iOS',
        '',
        'The Firebase SDKs are provided by Google LLC. Their use is governed by the Google APIs Terms of',
        'Service (https://developers.google.com/terms) and the Firebase terms',
        '(https://firebase.google.com/terms); the parts Google publishes as open source carry their own',
        'licences, mostly Apache-2.0, in the SDK artefacts. The @react-native-firebase modules listed',
        'below are the Apache-2.0 wrappers around them. Collection by both is off by default',
        '(mobile/firebase.json) and is switched on only from Settings.',
        '',
        "To be done: a Gradle licence plugin (such as Google's oss-licenses plugin) to collect the Android",
        "libraries' notices, and the CocoaPods acknowledgements plist for the iOS pods, shown here",
        'beside this list.',
      ].join('\n'),
    },
  ]
}

/** The whole file, as an object — what the test compares against the committed JSON. */
export function build() {
  const kinds = ['Apache-2.0', 'MIT', 'ISC']
  const packages = uniqueNotices(productionTree(MOBILE).map((p) => noticeFor(p.dir, kinds)))
  const used = new Set(packages.flatMap((p) => p.shared))
  return {
    about:
      'Generated by mobile/scripts/third-party-notices.mjs from the production dependency tree. Do not edit by hand.',
    shared: Object.fromEntries(kinds.filter((k) => used.has(k)).map((k) => [k, SHARED_TEXTS[k]])),
    extra: extras(),
    packages,
  }
}

/** Serialised exactly as committed: two-space JSON and a final newline. */
export const serialise = (data) => `${JSON.stringify(data, null, 2)}\n`

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
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
      `third-party-notices: ${String(data.packages.length)} packages, ${String(Math.round(next.length / 1024))}KB → ${OUT}`,
    )
  }
}
