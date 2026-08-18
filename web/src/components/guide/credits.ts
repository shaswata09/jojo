/**
 * Everything jojo is built on, and the terms it comes under.
 *
 * Read out of `node_modules`, not out of `package.json`. Two different reasons,
 * and both have bitten acknowledgements pages before:
 *
 *  - VERSIONS. `package.json` holds ranges — `^1.75.0` resolved to 1.77.0 here.
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
  /**
   * Installed and paid for in `package.json`, imported nowhere under `src`.
   *
   * Kept on the page rather than quietly dropped. A credits list that shows
   * only what is used is the more flattering page and the less true one — these
   * three ship in the lockfile, a reader can see them in `package.json`, and
   * the useful thing to tell them is that they are candidates for removal.
   */
  unused?: true
}

/** What runs in the app itself. */
export const RUNTIME: readonly Credit[] = [
  {
    name: 'react',
    version: '19.2.8',
    licence: 'MIT',
    holder: 'Meta Platforms, Inc. and affiliates',
    what: 'Every screen. React 19, so a ref is an ordinary prop and the app carries no forwardRef.',
    where: 'src/main.tsx',
  },
  {
    name: 'react-dom',
    version: '19.2.8',
    licence: 'MIT',
    holder: 'Meta Platforms, Inc. and affiliates',
    what: 'Puts React on the page, and portals every dialog and toast out of the layout that summoned it.',
    where: 'src/main.tsx',
  },
  {
    name: 'react-router',
    version: '8.3.0',
    licence: 'MIT',
    holder: 'React Training LLC, Remix Software Inc., Shopify Inc.',
    what: 'The routes, and the app’s URL-state store: every shareable link — board or table, stage, sort, which vault tool, which day — is built on its search params rather than on a store of its own.',
    where: 'src/App.tsx, src/lib/links.ts',
  },
  {
    name: 'tailwindcss',
    version: '4.3.3',
    licence: 'MIT',
    holder: 'Tailwind Labs, Inc.',
    what: 'Every class in the app, and the token system underneath it — the whole palette, both themes and the six stage colours are declared in one @theme block.',
    where: 'src/index.css',
  },
  {
    name: '@tailwindcss/vite',
    version: '4.3.3',
    licence: 'MIT',
    holder: 'Tailwind Labs, Inc.',
    what: 'Compiles that stylesheet during the build and scans the source for the classes actually used.',
    where: 'vite.config.ts',
  },
  {
    name: 'radix-ui',
    version: '1.6.7',
    licence: 'MIT',
    holder: 'WorkOS',
    what: 'The behaviour under the dialogs, popovers, switches and separators — focus trapping, Escape, modality, and returning focus to whatever opened the thing. The parts of an overlay that are invisible until they are missing.',
    where: 'src/components/ui/dialog.tsx, popover.tsx, switch.tsx',
  },
  {
    name: 'cmdk',
    version: '1.1.1',
    licence: 'MIT',
    holder: 'Paco Coursey',
    what: 'The list and keyboard handling inside the ⌘K palette. The scoring that decides what ranks first is the app’s own.',
    where: 'src/components/ui/command.tsx',
  },
  {
    name: 'lucide-react',
    version: '1.29.0',
    licence: 'ISC',
    holder: '2026 Lucide Icons and Contributors',
    what: 'Every icon in the interface. ISC rather than MIT — it is the credit most often got wrong, and some of the icons carry a second notice as well (see below).',
    where: 'src/components/layout/Topbar.tsx and most other components',
  },
  {
    name: 'react-icons',
    version: '5.7.0',
    licence: 'MIT',
    holder: '2018 kamijin_fanta',
    what: 'Nothing. It is installed and imported nowhere in the source — a leftover, and a candidate for removal rather than a credit for work done.',
    unused: true,
  },
  {
    name: 'class-variance-authority',
    version: '0.7.1',
    licence: 'Apache-2.0',
    holder: '2022 Joe Bell',
    what: 'The variant tables behind the button, the chip and the input group — one place per component where every size and tone is spelled out.',
    where: 'src/components/ui/button.tsx, src/components/common/Chip.tsx',
  },
  {
    name: 'clsx',
    version: '2.1.1',
    licence: 'MIT',
    holder: 'Luke Edwards',
    what: 'Half of cn(), the helper nearly every component in the app uses to build a class list.',
    where: 'src/lib/utils.ts',
  },
  {
    name: 'tailwind-merge',
    version: '3.6.0',
    licence: 'MIT',
    holder: '2021 Dany Castillo',
    what: 'The other half. It settles two Tailwind utilities that contradict each other, so a caller can override a component’s padding without the component knowing.',
    where: 'src/lib/utils.ts',
  },
  {
    name: 'tw-animate-css',
    version: '1.4.0',
    licence: 'MIT',
    holder: '2025 Wombosvideo',
    what: 'The enter and exit animations the dialogs and popovers use — the fade and the slight zoom, and the flattening of both under reduced motion.',
    where: 'src/index.css',
  },
  {
    name: 'shadcn',
    version: '4.16.2',
    licence: 'MIT',
    holder: '2023 shadcn',
    what: 'Its stylesheet is imported by the app’s own, and its generator produced the components in src/components/ui. Those files are copies that live in this repository and have been edited since — the package is a source, not a runtime the interface calls into.',
    where: 'src/index.css, components.json',
  },
  {
    name: '@dnd-kit/core',
    version: '6.3.1',
    licence: 'MIT',
    holder: '2021 Claudéric Demers',
    what: 'Dragging an application between stage columns on the board, and dragging a dated record onto another day in the calendar. Both go through the same write path a menu would, so both toast and both undo.',
    where: 'src/routes/Applications.tsx, src/routes/Calendar.tsx',
  },
  {
    name: '@dnd-kit/sortable',
    version: '10.0.0',
    licence: 'MIT',
    holder: '2021 Claudéric Demers',
    what: 'Nothing. Installed alongside @dnd-kit/core and imported nowhere — the board reorders nothing within a column, so the sortable strategies were never needed.',
    unused: true,
  },
  {
    name: '@dnd-kit/utilities',
    version: '3.2.2',
    licence: 'MIT',
    holder: '2021 Claudéric Demers',
    what: 'Nothing. Its transform helper is what a drag preview usually needs; this board draws its preview with a drag overlay instead, so nothing imports it.',
    unused: true,
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
    version: '1.77.0',
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
