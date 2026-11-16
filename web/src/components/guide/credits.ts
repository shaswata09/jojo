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
 *    `fake-indexeddb` are Apache-2.0. A package that states nothing at all is
 *    recorded as nothing rather than filled in — `licence: null` renders as
 *    "not stated", which is the honest answer and the only one that cannot be
 *    wrong. None does today; the third-party mascot runtime that did is gone.
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
  /**
   * A scope this credit speaks for, such as `@radix-ui/` under `radix-ui`: an
   * umbrella package whose parts are published separately, by the same
   * holder, under the same licence. The build's check accepts a bundled part
   * on the umbrella's credit, and still checks the part's licence against it.
   */
  covers?: string
}

/** What jojo itself imports, and what runs in the app because of it. */
const DIRECT: readonly Credit[] = [
  {
    name: 'react',
    version: '19.2.8',
    licence: 'MIT',
    holder: 'Meta Platforms, Inc. and affiliates',
    what: 'Every screen. Components, state and effects — the whole interface is React.',
    where: 'src/main.tsx',
  },
  {
    name: 'react-dom',
    version: '19.2.8',
    licence: 'MIT',
    holder: 'Meta Platforms, Inc. and affiliates',
    what: 'Puts those components on the page and keeps the page in step with them.',
    where: 'src/main.tsx',
  },
  {
    name: 'scheduler',
    version: '0.27.0',
    licence: 'MIT',
    holder: 'Meta Platforms, Inc. and affiliates',
    what: 'Not imported by jojo: react-dom depends on it to decide which update runs first. It is in the bundle all the same, so it is credited.',
  },
  {
    name: 'radix-ui',
    version: '1.6.7',
    licence: 'MIT',
    holder: '2022 WorkOS',
    what: 'The accessible parts under the buttons you press — dialogs, sheets, popovers, menus, switches, tooltips: focus handling, keyboard behaviour and the ARIA wiring. jojo styles them; Radix makes them behave. Its positioning comes from Floating UI (MIT), which it brings with it.',
    where: 'src/components/ui',
    covers: '@radix-ui/',
  },
  {
    name: 'lucide-react',
    version: '1.31.0',
    licence: 'ISC',
    holder: '2026 Lucide Icons and Contributors',
    what: 'Every icon in the web app. Only the icons actually imported are bundled.',
    where: 'src/App.tsx',
  },
  {
    name: 'class-variance-authority',
    version: '0.7.1',
    licence: 'Apache-2.0',
    holder: 'Joe Bell',
    what: 'The variants of the shared components — a button that is primary, ghost or destructive, small or large — declared once as a table rather than as conditionals in every caller.',
    where: 'src/components/ui/button.tsx',
  },
  {
    name: 'firebase',
    version: '12.18.0',
    licence: 'Apache-2.0',
    holder: 'Google LLC',
    what: 'Usage analytics, and only that — `firebase/app` and `firebase/analytics`, loaded on demand the first time something is reported, so a build without analytics, or a person who turned it off, downloads none of it. The package ships no licence file; the licence is from its manifest and the holder from the notice at the top of each of its files.',
    where: 'src/lib/analytics.ts',
    covers: '@firebase/',
  },
  {
    name: 'tailwindcss',
    version: '4.3.3',
    licence: 'MIT',
    holder: 'Tailwind Labs, Inc.',
    what: 'The styling system. Its base layer is compiled into the stylesheet that ships, which is why it is listed here rather than with the build tools.',
    where: 'src/index.css',
  },
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
    what: 'The two 3D scenes: the robot mascot in the sidebar — a CC BY model, credited on this page, loaded with three’s glTF loader and posed through its skeleton — and the scene on the Transfer page — its WebGPU renderer, its shading language and the bloom pass. Each is a chunk of its own, loaded lazily.',
    where: 'src/components/brand/RobotScene.tsx, src/components/transfer/DataTransferScene.tsx',
  },
  {
    name: '@react-three/fiber',
    version: '9.7.0',
    licence: 'MIT',
    holder: 'Paul Henschel and contributors',
    what: 'Lets both scenes be written as React components rather than as an imperative render loop.',
    where: 'src/components/brand/RobotScene.tsx, src/components/transfer/DataTransferScene.tsx',
  },
  {
    name: '@react-three/drei',
    version: '10.7.8',
    licence: 'MIT',
    holder: '2020 react-spring',
    what: 'Helpers in the scene on the Transfer page: fitting the plane to the viewport and loading its two textures. The mascot does not use it — its studio lighting is baked with three.js alone, which keeps drei’s environment helper, and the CDN address of its lighting presets, out of the mascot’s chunk.',
    where: 'src/components/transfer/DataTransferScene.tsx',
  },
  {
    name: 'pdf-lib',
    version: '1.17.1',
    licence: 'MIT',
    holder: '2019 Andrew Dillon',
    what: 'Writes every PDF the editor produces: merging documents, keeping and turning pages, and the highlight and comment annotation dictionaries. It has no DOM and no Node dependency, which is why that whole path is covered by ordinary tests rather than by driving a browser.',
    where: 'src/lib/pdf/document.ts',
  },
  {
    name: 'pdfjs-dist',
    version: '6.3.289',
    licence: 'Apache-2.0',
    holder: 'Mozilla Foundation',
    what: 'Draws a page in the PDF editor and lays selectable text over it, which is what lets a highlight follow the words. The legacy build, not the default one: the modern build is compiled to syntax no Safari before 18.2 can parse. It only ever reads — nothing it does reaches the file that is saved.',
    where: 'src/lib/pdf/render.ts',
  },
  {
    name: 'fflate',
    version: '0.8.3',
    licence: 'MIT',
    holder: '2026 Arjun Barrett',
    what: 'Packs every stored document into one ZIP for "Download every document", so getting your CVs out is one download rather than a burst the browser blocks. Already compressed kinds — PDF, Office files, images — are stored rather than deflated a second time. The phone uses the same library to open DOCX and other archive formats.',
    where: 'src/lib/document-archive.ts',
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
  {
    name: 'react-router',
    version: '8.3.0',
    licence: 'MIT',
    holder: 'Remix Software Inc.',
    what: 'Every address in the app. It is what makes a record shareable as a URL and what `BASENAME` is threaded into so the same build runs at the site root or under a repository subpath.',
    where: 'src/App.tsx',
  },
  {
    name: 'cmdk',
    version: '1.1.1',
    licence: 'MIT',
    holder: 'Paco Coursey',
    what: 'The command palette behind ⌘K — the filtering, the keyboard model and the list semantics.',
    where: 'src/components/ui/command.tsx',
  },
  {
    name: '@dnd-kit/core',
    version: '6.3.1',
    licence: 'MIT',
    holder: 'Claudéric Demers',
    what: 'Dragging a card between board columns and an event between calendar days. Chosen over the alternatives for its keyboard sensor: the board has to be operable without a mouse, and drag-and-drop usually is not.',
    where: 'src/components/applications/board',
  },
  {
    name: '@xyflow/react',
    version: '12.11.5',
    licence: 'MIT',
    holder: 'webkid GmbH',
    what: 'The arrows on the benchmark\u2019s workflow graphs and on both graphs of the Control flow graph page \u2014 nodes, edges, panning and the fit-to-view. Only the drawing: every coordinate is computed in `bench-flow.ts` and `flow-layout.ts`, because a layout that lives in a component is a layout nothing can test. Loaded on demand, so the page that never opens it never downloads it.',
    where: 'src/components/guide/WorkflowFlow.tsx',
  },
  {
    name: 'clsx',
    version: '2.1.1',
    licence: 'MIT',
    holder: 'Luke Edwards',
    what: 'Conditional class names, half of the `cn()` helper every component uses.',
    where: 'src/lib/utils.ts',
  },
  {
    name: 'tailwind-merge',
    version: '3.6.0',
    licence: 'MIT',
    holder: 'Dany Castillo',
    what: 'The other half of `cn()`: it resolves conflicting Tailwind classes so a caller can override a component default without fighting specificity.',
    where: 'src/lib/utils.ts',
  },
  {
    name: 'tw-animate-css',
    version: '1.4.0',
    licence: 'MIT',
    holder: 'Wombosvideo',
    what: 'The enter and exit animations on dialogs, sheets and popovers.',
    where: 'src/index.css',
  },
  {
    name: '@tailwindcss/vite',
    version: '4.3.3',
    licence: 'MIT',
    holder: 'Tailwind Labs, Inc.',
    what: 'Compiles the stylesheet at build time. In the toolchain rather than the bundle, and listed because it is what turns the token file into the CSS that ships.',
    where: 'vite.config.ts',
  },
]

/**
 * In the bundle because something above needs it, not because jojo imports it.
 *
 * Credited all the same: what ships is what the licences attach to, and an
 * ISC or BSD notice owed by a package three levels down is owed just as much.
 * The list came from walking the production build's source maps, and the build
 * keeps it complete: `jojo:credited-bundle` in `vite.config.ts` reads the
 * package of every module it emits and fails if one is credited nowhere here,
 * or is credited under a licence other than the one it states. Parts of
 * Radix (`@radix-ui/…`) and Firebase (`@firebase/…`) ride on their umbrella's
 * credit above — see `covers`.
 *
 * Where two copies of one package are bundled, the version is the one the app
 * resolves, and the other is named in the text; both state the same licence.
 */
export const BUNDLED: readonly Credit[] = [
  {
    name: '@dnd-kit/accessibility',
    version: '3.1.1',
    licence: 'MIT',
    holder: '2021, Claudéric Demers',
    what: 'Brought in by @dnd-kit/core: the screen-reader announcements while a card is dragged.',
  },
  {
    name: '@dnd-kit/utilities',
    version: '3.2.2',
    licence: 'MIT',
    holder: '2021, Claudéric Demers',
    what: 'Brought in by @dnd-kit/core: the small helpers its sensors are written with.',
  },
  {
    name: '@floating-ui/core',
    version: '1.8.0',
    licence: 'MIT',
    holder: '2021-present Floating UI contributors',
    what: 'Brought in by Radix: the arithmetic that places a popover beside what opened it and keeps it on screen.',
  },
  {
    name: '@floating-ui/dom',
    version: '1.8.0',
    licence: 'MIT',
    holder: '2021-present Floating UI contributors',
    what: 'Brought in by Radix: the same placement, measured against the page.',
  },
  {
    name: '@floating-ui/react-dom',
    version: '2.1.9',
    licence: 'MIT',
    holder: '2021-present Floating UI contributors',
    what: 'Brought in by Radix: the React binding of that placement.',
  },
  {
    name: '@floating-ui/utils',
    version: '0.2.12',
    licence: 'MIT',
    holder: '2021-present Floating UI contributors',
    what: 'Brought in by Radix, under the three above.',
  },
  {
    name: '@pdf-lib/standard-fonts',
    version: '1.0.0',
    licence: 'MIT',
    holder: '2018 Andrew Dillon',
    what: 'Brought in by pdf-lib: the metrics of the fourteen standard PDF fonts, used when a comment is written onto a page.',
  },
  {
    name: '@pdf-lib/upng',
    version: '1.0.1',
    licence: 'MIT',
    holder: '2017 Photopea',
    what: 'Brought in by pdf-lib: its PNG decoder.',
  },
  {
    name: 'pako',
    version: '1.0.11',
    licence: '(MIT AND Zlib)',
    holder:
      '2014-2017 Vitaly Puzrin and Andrei Tuputcyn; the zlib port 1995-2013 Jean-loup Gailly and Mark Adler',
    what: 'Brought in by pdf-lib: the deflate that compresses a saved PDF. Its own code is MIT; the parts ported from zlib keep the zlib licence, quoted in THIRD-PARTY-NOTICES.md.',
  },
  {
    name: 'tslib',
    version: '2.8.1',
    licence: '0BSD',
    holder: 'Microsoft Corporation',
    what: 'The helpers TypeScript compiles into a library — here into dnd-kit, Firebase and the packages under Radix’s dialogs. pdf-lib brings a second copy, 1.14.1. 0BSD asks for no notice; it is credited because it ships.',
  },
  {
    name: '@xyflow/system',
    version: '0.0.81',
    licence: 'MIT',
    holder: '2019-2025 webkid GmbH',
    what: 'Brought in by @xyflow/react: the framework-free half of it — panning, zooming and edge paths.',
  },
  {
    name: 'classcat',
    version: '5.0.5',
    licence: 'MIT',
    holder: 'Jorge Bucaran',
    what: 'Brought in by @xyflow/react: its class names.',
  },
  {
    name: 'd3-color',
    version: '3.1.0',
    licence: 'ISC',
    holder: '2010-2022 Mike Bostock',
    what: 'Brought in by @xyflow/react, through d3-zoom: colour parsing for its transitions.',
  },
  {
    name: 'd3-dispatch',
    version: '3.0.1',
    licence: 'ISC',
    holder: '2010-2021 Mike Bostock',
    what: 'Brought in by @xyflow/react, through d3-zoom: its event dispatch.',
  },
  {
    name: 'd3-drag',
    version: '3.0.0',
    licence: 'ISC',
    holder: '2010-2021 Mike Bostock',
    what: 'Brought in by @xyflow/react: dragging the canvas to pan it.',
  },
  {
    name: 'd3-ease',
    version: '3.0.1',
    licence: 'BSD-3-Clause',
    holder: '2010-2021 Mike Bostock; 2001 Robert Penner',
    what: 'Brought in by @xyflow/react, through d3-transition: the easing of a zoom. The one BSD licence in the bundle; its text is quoted in THIRD-PARTY-NOTICES.md, as a binary redistribution requires.',
  },
  {
    name: 'd3-interpolate',
    version: '3.0.1',
    licence: 'ISC',
    holder: '2010-2021 Mike Bostock',
    what: 'Brought in by @xyflow/react, through d3-zoom: the in-between steps of a zoom.',
  },
  {
    name: 'd3-selection',
    version: '3.0.0',
    licence: 'ISC',
    holder: '2010-2021 Mike Bostock',
    what: 'Brought in by @xyflow/react: how d3-zoom attaches to the canvas.',
  },
  {
    name: 'd3-timer',
    version: '3.0.1',
    licence: 'ISC',
    holder: '2010-2021 Mike Bostock',
    what: 'Brought in by @xyflow/react, through d3-transition: the frame timer behind an animated zoom.',
  },
  {
    name: 'd3-transition',
    version: '3.0.1',
    licence: 'ISC',
    holder: '2010-2021 Mike Bostock',
    what: 'Brought in by @xyflow/react: animated fit-to-view and zoom.',
  },
  {
    name: 'd3-zoom',
    version: '3.0.0',
    licence: 'ISC',
    holder: '2010-2021 Mike Bostock',
    what: 'Brought in by @xyflow/react: pan and zoom on the graphs.',
  },
  {
    name: 'zustand',
    version: '5.0.15',
    licence: 'MIT',
    holder: '2019 Paul Henschel',
    what: 'Brought in by @react-three/fiber, which keeps the transfer scene’s state in it. @xyflow/react brings a second copy, 4.5.7, for the graphs’ state.',
  },
  {
    name: 'use-sync-external-store',
    version: '1.6.0',
    licence: 'MIT',
    holder: 'Meta Platforms, Inc. and affiliates',
    what: 'Brought in by zustand and @react-three/fiber: the React shim their stores subscribe through.',
  },
  {
    name: 'its-fine',
    version: '2.0.0',
    licence: 'MIT',
    holder: '2022-2025 Poimandres',
    what: 'Brought in by @react-three/fiber: carries React context into the 3D scene.',
  },
  {
    name: 'suspend-react',
    version: '0.1.3',
    licence: 'MIT',
    holder: '2021 Paul Henschel',
    what: 'Brought in by @react-three/fiber and drei: waits for the scene’s textures without blocking the page.',
  },
  {
    name: 'react-use-measure',
    version: '2.1.7',
    licence: 'MIT',
    holder: '2019-2025 Poimandres',
    what: 'Brought in by @react-three/fiber: sizes the canvas to its box.',
  },
  {
    name: 'aria-hidden',
    version: '1.2.6',
    licence: 'MIT',
    holder: '2017 Anton Korzunov',
    what: 'Brought in by Radix: hides the rest of the page from a screen reader while a dialog is open.',
  },
  {
    name: 'react-remove-scroll',
    version: '2.7.2',
    licence: 'MIT',
    holder: '2017 Anton Korzunov',
    what: 'Brought in by Radix: stops the page behind an open dialog from scrolling.',
  },
  {
    name: 'react-remove-scroll-bar',
    version: '2.3.8',
    licence: 'MIT',
    holder: 'Anton Korzunov (the package ships no licence file; the licence is from its manifest)',
    what: 'Brought in by Radix: keeps the layout from jumping when that scroll bar goes away.',
  },
  {
    name: 'react-style-singleton',
    version: '2.2.3',
    licence: 'MIT',
    holder: '2017 Anton Korzunov',
    what: 'Brought in by Radix, under the scroll lock: one style tag however many dialogs are open.',
  },
  {
    name: 'use-callback-ref',
    version: '1.3.3',
    licence: 'MIT',
    holder: '2017 Anton Korzunov',
    what: 'Brought in by Radix, under the scroll lock.',
  },
  {
    name: 'use-sidecar',
    version: '1.1.3',
    licence: 'MIT',
    holder: '2017 Anton Korzunov',
    what: 'Brought in by Radix, under the scroll lock: loads its event handling apart from its markup.',
  },
  {
    name: 'get-nonce',
    version: '1.0.1',
    licence: 'MIT',
    holder: '2020 Anton Korzunov',
    what: 'Brought in by Radix, under the scroll lock: the nonce for the style tag it writes, when a page sets one.',
  },
]

/** What runs in the app itself: what jojo imports, then what those bring with them. */
export const RUNTIME: readonly Credit[] = [...DIRECT, ...BUNDLED]

/** One package copy the build put in the bundle, as the build reads it off disk. */
export type BundledCopy = {
  readonly name: string
  readonly version: string
  readonly licence: string | null
}

/**
 * The package a bundled module came from, and the folder its manifest is in.
 *
 * The LAST `node_modules` in the path, so a copy nested under another package
 * (`@xyflow/react/node_modules/zustand`) is that copy and not its parent.
 * `null` for jojo's own files and the bundler's virtual modules.
 */
export function packageOfModule(id: string): { name: string; dir: string } | null {
  const path = (id.split('?')[0] ?? '').replace(/\\/g, '/').replace(/^\0/, '')
  const marker = '/node_modules/'
  const at = path.lastIndexOf(marker)
  if (at === -1) return null
  const [first = '', second = ''] = path.slice(at + marker.length).split('/')
  const name = first.startsWith('@') ? (second === '' ? '' : `${first}/${second}`) : first
  if (name === '' || name.startsWith('.')) return null
  return { name, dir: `${path.slice(0, at + marker.length)}${name}` }
}

/**
 * What the build bundled that this file does not credit, or credits wrongly —
 * one sentence each, sorted, so the build can fail with all of them at once.
 */
export function creditProblems(
  bundled: readonly BundledCopy[],
  credits: readonly Credit[] = RUNTIME,
): string[] {
  const problems = new Set<string>()
  for (const copy of bundled) {
    const credit =
      credits.find((c) => c.name === copy.name) ??
      credits.find((c) => c.covers !== undefined && copy.name.startsWith(c.covers))
    if (credit === undefined) {
      problems.add(
        `${copy.name} ${copy.version} (${copy.licence ?? 'no licence stated'}) is in the bundle and credited nowhere — add it to BUNDLED in credits.ts.`,
      )
    } else if (copy.licence !== null && credit.licence !== copy.licence) {
      // A manifest that states nothing is not a disagreement: the credit may
      // read the licence from the LICENSE file beside it, as it once did for
      // the old mascot's loader. The test holds those credits to node_modules
      // either way.
      problems.add(
        `${copy.name} ${copy.version} states ${copy.licence ?? 'no licence'}, and is credited under ${credit.licence ?? 'none'} (${credit.name}).`,
      )
    }
  }
  return [...problems].sort()
}

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
    what: 'Four separate compiler projects, so the portable layers can be compiled without the DOM in scope — which is what makes a browser API in the wrong file a build error rather than a code review. It is also the parser one of the two guard scripts uses, and the one the code flow graph reads imports with.',
  },
  {
    name: 'vitest',
    version: '4.1.11',
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

/** The full ISC permission notice — lucide-react, idb and the d3 modules under the graphs. */
export const ISC_TEXT = `Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`

/**
 * The four clauses of Apache-2.0 that decide what a reader may actually do.
 *
 * ## Why a summary here and the full text in `LICENSE`
 *
 * MIT is three paragraphs, so `MIT_TEXT` above quotes all of it. Apache-2.0 is
 * 201 lines and 11KB, and inlining it would put that in the bundle of every
 * person who opens the app and never visits this page — to say, at length,
 * things the page can state accurately in a quarter of the space. What is
 * quoted below is verbatim; what is omitted is definitions, the boilerplate
 * appendix, and the trademark and warranty-acceptance clauses that do not change
 * a reader's rights.
 *
 * THE FULL TEXT SHIPS WITH THE SOFTWARE, in `LICENSE` at the repository root,
 * which is what the licence itself requires — this page points at it rather than
 * standing in for it.
 */
export const APACHE_CLAUSES: readonly { heading: string; text: string }[] = [
  {
    heading: '2. Grant of Copyright License',
    text: 'each Contributor hereby grants to You a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable copyright license to reproduce, prepare Derivative Works of, publicly display, publicly perform, sublicense, and distribute the Work and such Derivative Works in Source or Object form.',
  },
  {
    heading: '3. Grant of Patent License',
    text: 'each Contributor hereby grants to You a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable … patent license to make, have made, use, offer to sell, sell, import, and otherwise transfer the Work … If You institute patent litigation against any entity … alleging that the Work or a Contribution incorporated within the Work constitutes direct or contributory patent infringement, then any patent licenses granted to You under this License for that Work shall terminate as of the date such litigation is filed.',
  },
  {
    heading: '4. Redistribution',
    text: 'You may reproduce and distribute copies of the Work … provided that You meet the following conditions: (a) You must give any other recipients of the Work or Derivative Works a copy of this License; and (b) You must cause any modified files to carry prominent notices stating that You changed the files; and (c) You must retain … all copyright, patent, trademark, and attribution notices; and (d) If the Work includes a "NOTICE" text file … You must include a readable copy of the attribution notices contained within such NOTICE file.',
  },
  {
    heading: '7. Disclaimer of Warranty · 8. Limitation of Liability',
    text: 'Unless required by applicable law or agreed to in writing, Licensor provides the Work … on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied … In no event and under no legal theory … shall any Contributor be liable to You for damages, including any direct, indirect, special, incidental, or consequential damages of any character arising as a result of this License or out of the use or inability to use the Work.',
  },
]

/** The BSD 3-Clause licence, as d3-ease states it beneath its two copyright lines. */
export const BSD_3_TEXT = `Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

* Neither the name of the author nor the names of contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`

/** The zlib licence, as pako's zlib port carries it at the top of each file. */
export const ZLIB_TEXT = `This software is provided 'as-is', without any express or implied warranty. In no event will the authors be held liable for any damages arising from the use of this software.

Permission is granted to anyone to use this software for any purpose, including commercial applications, and to alter it and redistribute it freely, subject to the following restrictions:

1. The origin of this software must not be misrepresented; you must not claim that you wrote the original software. If you use this software in a product, an acknowledgment in the product documentation would be appreciated but is not required.
2. Altered source versions must be plainly marked as such, and must not be misrepresented as being the original software.
3. This notice may not be removed or altered from any source distribution.`

/** The BSD Zero Clause licence — tslib. It asks for no notice at all. */
export const ZERO_BSD_TEXT = `Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`
