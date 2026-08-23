# jojo

[![CI](https://github.com/shaswata09/jojo/actions/workflows/ci.yml/badge.svg)](https://github.com/shaswata09/jojo/actions/workflows/ci.yml)

**J**arvis f**O**r **J**ob **O**rganization — a local-first tracker for academic and industry job applications.

Everything runs on your own machine. Your applications, documents and profile live in your browser;
an optional companion server mirrors them to a JSON file on disk, and an optional local LLM powers
drafting and job matching. Nothing is sent to a third party.

---

## The three layers

jojo works with zero setup and gains capability as you opt in.

| Layer                      | Requires                           | What you get                                                                                                         |
| -------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **1 — Browser only**       | Nothing                            | Track applications, deadlines and follow-ups, and keep the documents you attach. Everything lives in browser storage. |
| **2 — + A backup you keep** | Somewhere to put a file           | One file holding every record, every link and every document. Restoring it puts all three back.                      |
| **3 — + Local LLM**        | vLLM / Ollama / LM Studio          | Assistant drafts cover letters and follow-ups; scout pipelines crawl boards and score postings against your profile. |

Layer 1 is the only one that must work. Everything above it degrades gracefully when disconnected.

---

## Repository layout

```
jojo/
├── service/             @jojo/service — the knowledge graph, its tools and the
│                        React binding. No build step; both apps compile the
│                        TypeScript. Owned by neither of them.
├── web/                 React single-page app
├── mobile/              React Native app for Android and iOS
│   ├── android/         Committed Gradle project
│   └── ios/             Committed Xcode project
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

The knowledge graph that store runs on now lives in `service/`, imported by both
apps as `@jojo/service`. `mobile/` still carries its own copy of an earlier
generation of it, which is what the current migration is deleting; until that
lands, `mobile/README.md` has the detail on what has drifted.

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
`mobile/android/build.gradle`'s `ext { minSdkVersion }` and the Podfile's
`platform :ios`. Both were `expo-build-properties` reading `app.json`; that
file is gone, and the Android floor now exists ONLY as that explicit `ext`
block, with no build error if it is removed.

Phones and tablets, both orientations. The layout switches to two columns at
900dp; `mobile/README.md` has the reasoning and which screens opt in.

Two things `mobile/README.md` covers that matter before you ship: the release
APK is signed with the **debug** keystore out of the box, and `android/` and
`ios/` are now **hand-maintained** — Expo was removed, so there is no
`expo prebuild` to regenerate them and nothing will restore an edit you lose.
Earlier this file said to run prebuild; doing so today would destroy both
native projects.

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

|                                                 |                                                                |
| ----------------------------------------------- | -------------------------------------------------------------- |
| React 19.1 · TypeScript 5.9 · React Native 0.81 | Bare React Native — no Expo; the build is plain Gradle / Xcode |
| Reanimated 4 + Gesture Handler 2                | the board's long-press drag                                    |
| React Navigation 7                              | bottom tabs + native stack                                     |
| react-native-svg                                | the donut, the radar and the graph                             |
| @expo/vector-icons                              | Feather, the set closest in weight to the web's lucide         |
| Prettier                                        | same config as `web/`, minus the Tailwind plugin               |

Inter and JetBrains Mono are bundled through `@expo-google-fonts` for the same
reason they are self-hosted on the web: an app that promises your data never
leaves the device should not fetch a font on launch.

---

## Status

**Built:** design system, theming, app shell, routing, Dashboard.

**Not built:** Applications (table + kanban), Job scout, My profile, Assistant, Settings, How to use.
They render as honest placeholders rather than fake content.

**Mobile:** built — every journey the web app has, as a bare React Native app for Android and iOS.
Both apps import the same `@jojo/service` package, so they report the same numbers by construction
rather than by agreement. "Verbatim" used to mean a `cp -R` copy that had drifted 813 lines; the
copy is deleted and there is one source now. See `mobile/README.md`.

**Not started:** the LLM client.

**Deliberately not built:** a localhost bridge. One was designed and written —
loopback HTTP, a session token, path confinement, five cross-compiled binaries —
and then deleted, because documents only ever needed to survive a reload and be
previewable and downloadable, and IndexedDB does all three in every browser jojo
runs in. `docs/NO-SERVER.md` records what was measured, including why a deployed
HTTPS page cannot reach `http://127.0.0.1` at all in current Chromium.

Persistence shipped: a knowledge graph in IndexedDB on web and AsyncStorage on mobile, behind one
`Driver` port. Dexie was rejected — see D1 in `docs/KG-ARCHITECTURE.md`.

> The Built / Not built lines above predate several passes on `web/` and understate it — Applications,
> Calendar, Vault, Job scout, Statistics, Profile, Assistant, Settings, the guide, the graph and the
> transfer screen are all real now. Left for whoever owns that section to rewrite.

## Known decisions still open

- **Component tests.** There are 697 Vitest tests across the three workspaces, but D20 rules out
  jsdom and Testing Library, so nothing mounts a component. UI logic is verified by driving the
  real apps. That trade is deliberate; what it costs is written up in `docs/AUDIT.md`.
- **`BrowserRouter` vs `HashRouter`.** Deep links like `/settings` need SPA rewrites on a static host
  and break entirely over `file://`. For an app people may open from disk, `HashRouter` is safer.
- **The academia/industry track is not persisted** across reloads, though the theme is.
- **Sidebar badges and the runtime status strip are hardcoded** — they need wiring to real state.

## Software jojo talks to but does not ship

Two things run outside the app, on the user's own machine, at addresses they
enter in Settings: an OpenAI-compatible model server, and
[MarkItDown](https://github.com/microsoft/markitdown) — Microsoft's, MIT-licensed
— which turns PDFs, Word files, decks and spreadsheets into text the assistant
can read. Neither is vendored here or bundled into either app, and no document or
message reaches anything the user did not point at.

`THIRD-PARTY-NOTICES.md` reproduces the licence and the attribution.

MarkItDown is reached through its own MCP server:

```
pip install markitdown-mcp
markitdown-mcp --http --host 127.0.0.1 --port 3001
```

The phone app talks to it directly. A browser cannot: `markitdown-mcp` sends no
CORS headers and answers the preflight with 405, so the web app reaches it
through a same-origin path — the dev server proxies `/reader` to it, and a hosted
copy needs the same forwarding.
