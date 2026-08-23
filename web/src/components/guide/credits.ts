/**
 * Everything jojo is built on, and the terms it comes under.
 *
 * Read out of `node_modules`, not out of `package.json`. Two different reasons,
 * and both have bitten acknowledgements pages before:
 *
 *  - VERSIONS. `package.json` holds ranges — `^1.75.0` resolved to 1.78.0 here.
 *    A page that prints the range is telling the reader about a version nobody
 *    is running, and a licence can change between two versions inside one
 *    caret.
 *  - LICENCES. The `license` field is what the publisher declared, and where it
 *    is missing the LICENSE file beside it is the next authority. Two packages
 *    here disagree with the obvious guess: `lucide-react` and `idb` are ISC
 *    rather than MIT, and `class-variance-authority`, `typescript` and
 *    `fake-indexeddb` are Apache-2.0. One package states nothing at all, and
 *    that is recorded as nothing rather than filled in — `licence: null` below
 *    renders as "not stated", which is the honest answer and the only one that
 *    cannot be wrong.
 *
 * Data rather than markup so the page reads as one shape, and so the next
 * person to run `npm install` has one file to reconcile. If you update a
 * dependency, re-read the two fields from `node_modules/<pkg>/package.json`
 * before you touch anything here — a stale version beside a real licence is
 * worse than no page, because it looks checked.
 */

export type Credit = {
  /** The package name, exactly as it is installed. */
  name: string
  /** The INSTALLED version, from node_modules — never the range. */
  version: string
  /** SPDX id as the package states it. `null` means the package states none. */
  licence: string | null
  /** Whose notice the licence carries. `null` where the package ships none. */
  holder: string | null
  /** What it does in this codebase — not what its README says it is for. */
  what: string
  /** Where to look. One path, or a short list; the first place that proves it. */
  where?: string
}

/** What runs in the app itself. */
export const RUNTIME: readonly Credit[] = [
  {
    name: 'idb',
    version: '8.0.3',
    licence: 'ISC',
    holder: '2016 Jake Archibald',
    what: 'The promise wrapper around IndexedDB — the database your records are actually kept in. One file in the whole codebase may import it, and a check in the lint step fails the build if a second one tries.',
    where: 'web/src/kg/storage/idb-driver.ts',
  },
  {
    name: 'three',
    version: '0.185.1',
    licence: 'MIT',
    holder: '2010–2026 three.js authors',
    what: 'The 3D scene on the Transfer page — its WebGPU renderer, its shading language and the bloom pass. Loaded only when that page is opened.',
    where: 'src/components/transfer/DataTransferScene.tsx',
  },
  {
    name: '@react-three/fiber',
    version: '9.7.0',
    licence: 'MIT',
    holder: 'Paul Henschel and contributors',
    what: 'Lets that scene be written as React components rather than as an imperative render loop.',
    where: 'src/components/transfer/DataTransferScene.tsx',
  },
  {
    name: '@react-three/drei',
    version: '10.7.8',
    licence: 'MIT',
    holder: '2020 react-spring',
    what: 'Two helpers in the same scene: fitting the plane to the viewport, and loading its two textures.',
    where: 'src/components/transfer/DataTransferScene.tsx',
  },
  {
    name: '@splinetool/react-spline',
    version: '4.1.0',
    licence: 'MIT',
    holder: '2022 Spline, Inc.',
    what: 'Loads the robot mascot in the sidebar, lazily and behind an error boundary. Its package.json declares no licence; the MIT text ships in the package itself, and that file is what this line is read from.',
    where: 'src/components/ui/splite.tsx',
  },
  {
    name: '@splinetool/runtime',
    version: '1.12.98',
    licence: null,
    holder: null,
    what: 'The engine that plays that scene, and the source of the two types the mascot rig is written against. The package states no licence in its manifest and ships no licence file, so nothing is claimed here about its terms — it is credited by name, and the gap is named rather than filled in with a guess.',
    where: 'src/lib/spline-rig.ts, src/components/brand/SplineRobot.tsx',
  },
  {
    name: '@fontsource-variable/inter',
    version: '5.3.0',
    licence: 'OFL-1.1',
    holder: '2016 The Inter Project Authors',
    what: 'The typeface everything is set in. Self-hosted from this package, which is why no font is fetched from anyone else’s server when the app loads.',
    where: 'src/index.css',
  },
  {
    name: '@fontsource-variable/jetbrains-mono',
    version: '5.3.0',
    licence: 'OFL-1.1',
    holder: '2020 The JetBrains Mono Project Authors',
    what: 'The monospaced face — keys, ids, file names, and every figure that has to line up in a column. Self-hosted for the same reason.',
    where: 'src/index.css',
  },
  {
    name: '@noble/hashes',
    version: '2.3.0',
    licence: 'MIT',
    holder: 'Paul Miller (paulmillr.com)',
    what: 'SHA-256 and HKDF for the transfer handshake. Audited, dependency-free and the same code on both apps — which matters more here than anywhere else in this list, because a hash that differs between the two devices is a pairing that never completes.',
    where: 'kg/crypto',
  },
  {
    name: '@noble/ciphers',
    version: '2.3.0',
    licence: 'MIT',
    holder: 'Paul Miller (paulmillr.com)',
    what: 'The symmetric cipher that encrypts a transfer once the two devices agree on a key.',
    where: 'kg/crypto',
  },
  {
    name: '@noble/curves',
    version: '2.3.0',
    licence: 'MIT',
    holder: 'Paul Miller (paulmillr.com)',
    what: 'The key agreement behind that shared key.',
    where: 'kg/crypto',
  },
]

/**
 * What the phone app is made of.
 *
 * A separate list rather than more rows in `RUNTIME`, because none of it is in
 * the bundle you are reading this page from — a browser never loads React
 * Native. It is here at all because "what jojo is built on" is one question and
 * splitting the answer across two apps would mean the phone's dependencies had
 * no acknowledgements page anywhere.
 *
 * Versions read from `mobile/node_modules`, on the same rule as the lists above.
 */
export const PHONE: readonly Credit[] = [
  {
    name: 'react-native',
    version: '0.81.5',
    licence: 'MIT',
    holder: 'Meta Platforms, Inc. and affiliates',
    what: 'The phone app itself, on both Android and iOS. React Native CLI rather than Expo, so `android/` and `ios/` are checked in and ours.',
    where: 'mobile/src',
  },
  {
    name: '@react-navigation/native',
    version: '7.3.16',
    licence: 'MIT',
    holder: 'React Navigation contributors',
    what: 'The screen stack, with bottom-tabs 7.18.16 for the tab bar and native-stack 7.18.8 for the push transitions.',
    where: 'mobile/src/navigation',
  },
  {
    name: 'react-native-reanimated',
    version: '4.1.7',
    licence: 'MIT',
    holder: 'Software Mansion',
    what: "The board's long-press drag, run on the UI thread so it does not stutter behind a React render.",
    where: 'mobile/src/screens/ApplicationsScreen.tsx',
  },
  {
    name: 'react-native-gesture-handler',
    version: '2.28.0',
    licence: 'MIT',
    holder: 'Software Mansion',
    what: 'The gestures those drags are built on, and the sheet dismissal.',
  },
  {
    name: 'react-native-svg',
    version: '15.12.1',
    licence: 'MIT',
    holder: 'Horcrux',
    what: 'The donut, the radar and the graph canvas — the three drawings the phone shares with the web app.',
    where: 'mobile/src/components/charts',
  },
  {
    name: '@react-native-vector-icons/feather',
    version: '13.1.2',
    licence: 'MIT',
    holder: 'Joel Arvidsson and contributors',
    what: "Every icon on the phone. The wrapper; the artwork is Cole Bemis's Feather, credited below.",
    where: 'mobile/src/lib/timeline-visuals.ts',
  },
  {
    name: '@react-native-async-storage/async-storage',
    version: '2.2.0',
    licence: 'MIT',
    holder: 'React Native Community',
    what: 'Where the graph lives on the phone — one JSON document, which is what buys the cross-store atomicity IndexedDB gives the browser for free.',
    where: 'mobile/src/kg/storage/rn-driver.ts',
  },
  {
    name: 'react-native-blob-util',
    version: '0.24.10',
    licence: 'MIT',
    holder: 'RonRadtke',
    what: 'Reading and writing document bytes on the handset — a saved posting, a picked CV.',
    where: 'mobile/src/lib/capture.ts',
  },
  {
    name: '@react-native-documents/picker',
    version: '12.0.2',
    licence: 'MIT',
    holder: 'Vojtech Novak',
    what: 'Choosing a document to attach.',
    where: 'mobile/src/lib/documents.ts',
  },
  {
    name: 'react-native-webview',
    version: '14.0.1',
    licence: 'MIT',
    holder: 'React Native Community',
    what: 'The in-app browser that can reach a posting behind a login, and the reader that opens a saved one with scripts off.',
    where: 'mobile/src/screens/PostingBrowserScreen.tsx',
  },
  {
    name: '@react-native-clipboard/clipboard',
    version: '1.16.3',
    licence: 'MIT',
    holder: 'React Native Community',
    what: 'Copy, on the one screen where copying is the point — snippets.',
  },
  {
    name: '@react-native-community/netinfo',
    version: '11.4.1',
    licence: 'MIT',
    holder: 'React Native Community',
    what: 'Whether this phone is on a network, which is what Transfer has to know before it offers to send anything.',
  },
  {
    name: 'react-native-tcp-socket',
    version: '6.4.2',
    licence: 'MIT',
    holder: 'Rapsssito',
    what: 'The socket a transfer runs over, so a copy goes device to device without a server in between.',
  },
  {
    name: 'react-native-safe-area-context',
    version: '5.6.2',
    licence: 'MIT',
    holder: 'Th3rd Wave',
    what: 'Keeping content out from under the notch and the home indicator.',
  },
  {
    name: 'react-native-screens',
    version: '4.16.0',
    licence: 'MIT',
    holder: 'Software Mansion',
    what: 'Native screen containers under React Navigation. Never imported by name — it is linked in and required at runtime, which is why grepping the source for it finds nothing.',
  },
  {
    name: 'react-native-worklets',
    version: '0.5.1',
    licence: 'MIT',
    holder: 'Software Mansion',
    what: 'Reanimated 4 requires it to run worklets on the UI thread. Never imported by name either.',
  },
  {
    name: 'react-native-get-random-values',
    version: '2.0.0',
    licence: 'MIT',
    holder: 'LinusU',
    what: 'A real CSPRNG behind `crypto.getRandomValues`, which Hermes does not ship. Record ids and transfer secrets both depend on it, and a weak fallback would be silent.',
    where: 'mobile/src/lib/secure-random.ts',
  },
  {
    name: 'react-native-url-polyfill',
    version: '4.0.0',
    licence: 'MIT',
    holder: 'Charpeni',
    what: "A `URL` that parses the way the shared layer expects. Hermes's own is partial, and the posting parser reads pathnames.",
  },
]

/** What builds, checks and tests it. None of this ships to a browser. */
export const DEVELOPMENT: readonly Credit[] = [
  {
    name: 'vite',
    version: '8.2.1',
    licence: 'MIT',
    holder: '2019–present VoidZero Inc. and Vite contributors',
    what: 'The development server and the production build.',
  },
  {
    name: '@vitejs/plugin-react',
    version: '6.0.5',
    licence: 'MIT',
    holder: '2019–present Yuxi (Evan) You and Vite contributors',
    what: 'React fast refresh in development, and the JSX transform.',
  },
  {
    name: 'typescript',
    version: '6.0.3',
    licence: 'Apache-2.0',
    holder: 'Microsoft Corporation',
    what: 'Four separate compiler projects, so the portable layers can be compiled without the DOM in scope — which is what makes a browser API in the wrong file a build error rather than a code review. It is also the parser one of the two guard scripts uses.',
  },
  {
    name: 'vitest',
    version: '4.1.10',
    licence: 'MIT',
    holder: '2021–present VoidZero Inc. and Vitest contributors',
    what: 'The test runner. 29 files, 362 tests, about a second.',
  },
  {
    name: 'fake-indexeddb',
    version: '6.2.5',
    licence: 'Apache-2.0',
    holder: '2017 Jeremy Scheff',
    what: 'A real IndexedDB implementation in Node, so the storage layer and the boot sequence are tested against the same API a browser gives them rather than against a hand-written stub.',
  },
  {
    name: 'oxlint',
    version: '1.78.0',
    licence: 'MIT',
    holder: '2024–present VoidZero Inc. & Contributors, 2023 Boshen',
    what: 'The first third of the lint step. The other two thirds are this repository’s own scripts.',
  },
  {
    name: 'prettier',
    version: '3.9.6',
    licence: 'MIT',
    holder: 'James Long and contributors',
    what: 'Formatting, so no diff in this repository is about whitespace.',
  },
  {
    name: 'prettier-plugin-tailwindcss',
    version: '0.8.1',
    licence: 'MIT',
    holder: 'Tailwind Labs Inc.',
    what: 'Sorts class lists into one order, which is what makes two long class strings comparable at a glance.',
  },
  {
    name: '@types/node',
    version: '24.13.3',
    licence: 'MIT',
    holder: 'Microsoft Corporation and DefinitelyTyped contributors',
    what: 'Types for the build scripts and the guards, which are the only Node in the project.',
  },
  {
    name: '@types/react',
    version: '19.2.18',
    licence: 'MIT',
    holder: 'Microsoft Corporation and DefinitelyTyped contributors',
    what: 'Types for React.',
  },
  {
    name: '@types/react-dom',
    version: '19.2.4',
    licence: 'MIT',
    holder: 'Microsoft Corporation and DefinitelyTyped contributors',
    what: 'Types for react-dom.',
  },
  {
    name: '@types/three',
    version: '0.185.4',
    licence: 'MIT',
    holder: 'Microsoft Corporation and DefinitelyTyped contributors',
    what: 'Types for the transfer scene.',
  },
]

/**
 * The full MIT permission notice.
 *
 * Reproduced once rather than twenty-two times. MIT asks that the copyright
 * notice and this permission notice travel with the software; the notices are
 * listed per package above, and this is the text they attach to. It is quoted
 * verbatim — every MIT package here ships the same three paragraphs, differing
 * only in the copyright line that precedes them.
 */
export const MIT_TEXT = `Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`

/** The full ISC permission notice — lucide-react and idb. */
export const ISC_TEXT = `Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`
