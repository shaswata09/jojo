# jojo

**J**arvis f**O**r **J**ob **O**rganization — a local-first tracker for academic and industry job applications.

Everything runs on your own machine. Your applications, documents and profile live in your browser;
an optional companion server mirrors them to a JSON file on disk, and an optional local LLM powers
drafting and job matching. Nothing is sent to a third party.

---

## The three layers

jojo works with zero setup and gains capability as you opt in.

| Layer                      | Requires                           | What you get                                                                                                         |
| -------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **1 — Browser only**       | Nothing                            | Track applications, deadlines, follow-ups, documents. Data lives in browser storage.                                 |
| **2 — + Localhost bridge** | A companion server on your machine | Mirrors data to `jojo-data.json` on disk; keeps timestamped submission snapshots.                                    |
| **3 — + Local LLM**        | vLLM / Ollama / LM Studio          | Assistant drafts cover letters and follow-ups; scout pipelines crawl boards and score postings against your profile. |

Layer 1 is the only one that must work. Everything above it degrades gracefully when disconnected.

---

## Repository layout

```
jojo/
├── web/                 React single-page app
├── mobile/              React Native app for Android and iOS
│   ├── android/         Committed Gradle project
│   └── ios/             Committed Xcode project
├── server/              (empty) localhost bridge
│   ├── linux/
│   ├── mac/
│   └── windows/
└── .claude/skills/      UI/UX design intelligence used while building
```

`web/` and `mobile/` are the same product on two form factors. Every module with
a rule in it — the timeline's date arithmetic, the statistics funnel, the
keyword system, the seed itself — came from `web/`, so the two report the same
numbers rather than merely resembling each other. What differs is the
presentation layer and the four interactions a phone cannot take from a pointer.

`web/` has since moved its store onto a knowledge graph (`web/src/kg/`) and
`mobile/` still carries the pre-graph copies of those modules. Every seeded
value and enumeration was compared after that refactor and they are identical,
so nothing observable differs today — but the two will need re-syncing when the
web's migration finishes. `mobile/README.md` has the detail.

---

## Running the web app

Requires **Node 22.22+**. React Router 8 declares `node >=22.22.0`; older versions still install and
run (the router itself is browser-side) but npm warns `EBADENGINE` on every install, and a CI with
`engine-strict` would fail outright. `web/.nvmrc` pins Node 24 LTS.

```bash
cd web
nvm use              # reads .nvmrc
npm install
npm run dev          # http://localhost:5173
```

| Script                 | Does                                                  |
| ---------------------- | ----------------------------------------------------- |
| `npm run dev`          | Vite dev server with hot module replacement           |
| `npm run build`        | Type-checks with `tsc -b`, then builds to `web/dist/` |
| `npm run preview`      | Serves the production build locally                   |
| `npm run lint`         | Runs [oxlint](https://oxc.rs)                         |
| `npm run format`       | Formats everything with Prettier                      |
| `npm run format:check` | Verifies formatting without writing — use in CI       |

Before committing: `npm run build && npm run lint && npm run format:check`. The build fails on any
type error, so it is the one that matters most.

---

## Running the mobile app

`mobile/android/` and `mobile/ios/` are committed native projects. This is an
ordinary Android and Xcode app — no Expo Go, no EAS, no dev server needed to
produce an installable build.

Requires **Node 22+**, plus **JDK 17 and Android SDK 36** for Android, or
**Xcode 15+ and CocoaPods** for iOS.

```bash
cd mobile
npm install

cd android && ./gradlew assembleRelease     # → app/build/outputs/apk/release/
cd ios && pod install && open jojo.xcworkspace
```

| Script                            | Does                                              |
| --------------------------------- | ------------------------------------------------- |
| `npm run android` / `npm run ios` | Native debug build, installed and launched        |
| `npm start`                       | Metro alone, to reload JS into an installed build |
| `npm run typecheck`               | `tsc --noEmit` — the check that actually matters  |
| `npm run lint`                    | oxlint, the same plugins and rules `web/` uses    |
| `npm run format` / `format:check` | Prettier, configured to match `web/`              |

**Supported platforms: Android 12 (API 31) and up, iOS 16.4 and up** — set in
`mobile/app.json` through `expo-build-properties`. Anything older is out of
support and not worth testing on.

Phones and tablets, both orientations. The layout switches to two columns at
900dp; `mobile/README.md` has the reasoning and which screens opt in.

Two things `mobile/README.md` covers that matter before you ship: the release
APK is signed with the **debug** keystore out of the box, and `expo prebuild`
regenerates `android/` and `ios/` and will overwrite hand edits to them.

Before committing: `npm run typecheck && npm run lint && npm run format:check`.

### Formatting

Prettier owns formatting; oxlint owns correctness. They don't overlap, so both run independently.

`prettier-plugin-tailwindcss` sorts Tailwind classes into canonical order. This is purely cosmetic —
utility order in a `class` attribute has no effect on the generated CSS — so it is safe to let it
rewrite class strings wholesale.

Config lives in `web/.prettierrc.json` and deliberately matches the existing style (no semicolons,
single quotes, 100 columns) so adopting it didn't churn the diff.

---

## Web app structure

```
web/src/
├── main.tsx                    Entry point; mounts providers
├── App.tsx                     Route table
├── index.css                   ★ Design tokens + Tailwind theme mapping
│
├── routes/                     One file per view
│   ├── Dashboard.tsx           Built
│   └── Placeholder.tsx         Stand-in for the six unbuilt views
│
├── components/
│   ├── layout/                 App shell — Sidebar, Topbar, Orbs, AppShell
│   ├── common/                 jojo's own components (hand-written)
│   └── ui/                     ⚠ shadcn/ui — generated, do not hand-edit
│
├── lib/
│   ├── theme.tsx               ThemeProvider
│   ├── theme-context.ts        Theme context + useTheme
│   ├── mode.tsx                ModeProvider (academia / industry track)
│   ├── mode-context.ts         Mode context + useMode
│   ├── storage.ts              Guarded localStorage access
│   └── utils.ts                cn() — shadcn's class merger
│
└── data/
    └── seed.ts                 Demo content; stands in for real persistence
```

### Two conventions that matter

**`components/ui/` belongs to the shadcn CLI.** Running `npx shadcn@latest add <thing>` writes into
that folder and will overwrite files there without asking. Anything hand-written goes in
`components/common/`. This is what makes it safe to pull components from third-party registries
(21st.dev and similar) later.

**`index.css` is the single source of design truth.** jojo's palette drives shadcn's variables rather
than the other way around — `--primary` resolves to jojo's `--accent`, `--card` to `--glass`, and so
on. A component installed from any shadcn-compatible registry inherits jojo's theme with no patching.
Retheming the whole app means editing the two token blocks in that file and nothing else.

### Responsive behaviour

One breakpoint carries the layout: Tailwind's `lg` (1024px).

| Width        | Layout                                                                  |
| ------------ | ----------------------------------------------------------------------- |
| `< 640px`    | Stats two-up; search drops to its own row in the topbar                 |
| `640–1023px` | Stats two-up, roomier spacing; sidebar still a drawer                   |
| `≥ 1024px`   | Sidebar becomes a permanent sticky column; dashboard splits 1.2fr / 1fr |

Below `lg` the sidebar is an off-canvas drawer opened from the topbar hamburger. It is a genuine modal
dialog there — `role="dialog"`, focus moves to its close button, Escape and backdrop dismiss it,
background scroll locks, and focus returns to the hamburger. Above `lg` it must _not_ claim those
semantics, since it is then just a navigation landmark; `useMediaQuery` decides which.

Styles are mobile-first (`grid-cols-2 lg:grid-cols-4`), not desktop-with-overrides
(`grid-cols-4 max-lg:grid-cols-2`). Use `dvh` rather than `vh` for full-height elements so mobile
browser chrome doesn't clip them.

### Theming

Two themes, dark by default. `data-theme="light|dark"` on `<html>` selects the token set; the `dark`
class is kept in sync for shadcn's `dark:` variants. `ThemeProvider` follows the OS until the user
overrides it, then remembers the choice.

A small inline script in `index.html` resolves the theme before first paint to avoid a flash of the
wrong theme. **It duplicates the storage key and attribute logic from `lib/theme-context.ts` — change
both together.**

---

## Stack

|                                  |                                               |
| -------------------------------- | --------------------------------------------- |
| React 19 · TypeScript 6 · Vite 8 |                                               |
| Tailwind CSS v4                  | via `@tailwindcss/vite`, no PostCSS config    |
| shadcn/ui                        | Radix primitives, Nova preset                 |
| React Router 8                   |                                               |
| dnd-kit                          | installed for the kanban board, not yet wired |
| lucide-react                     | icons                                         |
| oxlint                           | linting                                       |
| Prettier                         | formatting, with Tailwind class sorting       |

Fonts (Inter, Space Grotesk, JetBrains Mono) are self-hosted via `@fontsource` — a local-first app
should not call out to a font CDN on every page load.

### Mobile

|                                                 |                                                                  |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| React 19.1 · TypeScript 5.9 · React Native 0.81 | Expo SDK 54 as a module layer; the build is plain Gradle / Xcode |
| Reanimated 4 + Gesture Handler 2                | the board's long-press drag                                      |
| React Navigation 7                              | bottom tabs + native stack                                       |
| react-native-svg                                | the donut, the radar and the graph                               |
| @expo/vector-icons                              | Feather, the set closest in weight to the web's lucide           |
| Prettier                                        | same config as `web/`, minus the Tailwind plugin                 |

Inter and JetBrains Mono are bundled through `@expo-google-fonts` for the same
reason they are self-hosted on the web: an app that promises your data never
leaves the device should not fetch a font on launch.

---

## Status

**Built:** design system, theming, app shell, routing, Dashboard.

**Not built:** Applications (table + kanban), Job scout, My profile, Assistant, Settings, How to use.
They render as honest placeholders rather than fake content.

**Mobile:** built — every journey the web app has, as an Expo app for Android and iOS. It shares
the web app's data, store, statistics and keyword modules verbatim, so the two report the same
numbers by construction rather than by agreement. See `mobile/README.md`.

**Not started:** persistence (decided: IndexedDB via Dexie), the localhost bridge, the LLM client,
and any test suite.

> The Built / Not built lines above predate several passes on `web/` and understate it — Applications,
> Calendar, Vault, Job scout, Statistics, Profile, Assistant, Settings, the guide, the graph and the
> transfer screen are all real now. Left for whoever owns that section to rewrite.

## Known decisions still open

- **No test suite.** Vitest + Testing Library is the natural fit; not set up yet.
- **`BrowserRouter` vs `HashRouter`.** Deep links like `/settings` need SPA rewrites on a static host
  and break entirely over `file://`. For an app people may open from disk, `HashRouter` is safer.
- **The academia/industry track is not persisted** across reloads, though the theme is.
- **Sidebar badges and the runtime status strip are hardcoded** — they need wiring to real state.
