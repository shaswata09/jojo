# jojo

[![CI](https://github.com/shaswata09/jojo/actions/workflows/ci.yml/badge.svg)](https://github.com/shaswata09/jojo/actions/workflows/ci.yml)

**J**arvis f**O**r **J**ob **O**rganization — an agentic assistant that tracks, organises and works on your search for academic and industry jobs.

It is a tracker you can talk to and hand work to. Connect a model and jojo will answer questions
about your search, draft the follow-ups and cover letters, keep your records complete by proposing
the notes, tags and reminders you have not got round to, and watch the job boards you follow for
postings worth your attention. Every change it wants to make is shown to you first and goes through
the same undo a button press does.

Everything runs on your own machine. Your applications, documents and profile live in your browser
or on your phone — there is no account, no backend of ours, and nothing is uploaded anywhere by
default. What the app can reach is only what you point it at, and every piece of it is optional: an
LLM for the assistant, the pipelines, the graph box and scout scoring; a document reader for PDFs,
Word files and job postings; the browser extension for keeping a posting, reading a job board, and reaching a
local document reader from a hosted copy;
and your own other device over the local network for Transfer. With none of it configured the app
is still a complete tracker, and a backup file you keep is how records move between machines.

**The one thing that can leave your device is the assistant, and only if you send it there.** jojo
speaks to a local model — Ollama, vLLM, LM Studio — and that is the default, with nothing leaving
the machine. It also speaks to Anthropic, OpenAI, OpenRouter, Groq and **NVIDIA**, which need an API
key you supply in Settings. Choose one of those and your prompts, and the records the assistant reads
while answering, go to that provider. Four of the five bill you for it; NVIDIA's
[build.nvidia.com](https://build.nvidia.com/) does not — it is free within a rate limit, which makes
it the way to run the agentic half without either a GPU or a card. jojo says which providers are
which where you pick one, and keeps "this leaves your device" and "this costs money" as separate
sentences, because they are separate questions. Your API key is stored beside the graph rather than inside it, so a backup file cannot
carry it.

The web app opens with the network down. A service worker keeps the shell and the boot bundle, so
a reload on a plane gets the dashboard rather than the browser's offline page — which it has to,
because the records were never anywhere else. The same manifest makes it installable to a dock or
a home screen. And because jojo has no notifications of its own, the Calendar exports every date it
holds as an `.ics`, with a reminder on each: the calendar you already get alerts from is the only
thing that can warn you about a deadline while the app is closed.

---

## Builds and releases

Every push and pull request runs the same nine checks `./gate.sh` runs
locally — three workspaces, each typechecked, linted and tested — plus the web
bundle. Nothing deploys unless all of it is green.

| What                  | When                 | Where it lands                                                               |
| --------------------- | -------------------- | ---------------------------------------------------------------------------- |
| **Web app**           | every push to `main` | GitHub Pages                                                                 |
| **Android APK**       | every push to `main` | the run's build artifacts, kept 90 days                                      |
| **Browser extension** | every push to `main` | the run's build artifacts, kept 90 days                                      |
| **Release**           | a tag matching `v*`  | a **draft** GitHub Release with the `.apk` and the extension `.zip` attached |

To cut a release: `git tag v0.1.0 && git push --tags`. The pipeline builds the
APK and the extension, opens a draft release with both attached, and waits for
you to write the notes and publish — nothing is announced unattended.

The extension carries its own version in `web/extension/manifest.json`, kept in
step with the app's — both are 0.1.0. It is loaded unpacked from disk and has no
store listing, so nothing forces the two apart; if it is ever published to the
Chrome Web Store, that changes, because Chrome refuses an upload whose version is
not higher than the last.

### Signing the APK

Without any configuration the APK is signed with Android's debug key. It
installs fine, which is what makes a fork or a first clone work with no setup,
but it can never be an _update_ to a store-published app because the signature
differs. To sign with a real upload key, set four repository secrets:

| Secret                    | What                                 |
| ------------------------- | ------------------------------------ |
| `ANDROID_KEYSTORE_BASE64` | the keystore, `base64 -i upload.jks` |
| `ANDROID_STORE_PASSWORD`  | its store password                   |
| `ANDROID_KEY_ALIAS`       | the key alias inside it              |
| `ANDROID_KEY_PASSWORD`    | that key's password                  |

The build picks the upload key when `ANDROID_KEYSTORE_BASE64` is set and the
debug key when it is not, and says in the log which one it used. The keystore is
never written into the workspace, so no artifact upload can pick it up.

Installing: download the `.apk`, open it on the phone, and allow installs from
that source when Android asks. Requires Android 12 or newer (`minSdk 31`).

The published APK is about 59 MB and carries `arm64-v8a` and `armeabi-v7a` only.
A universal build is 95 MB, and the 36 MB difference is `x86` and `x86_64` —
architectures that exist on emulators and on no phone anyone owns. Local
development still builds all four, so `npm -w jojo-mobile run android` works on
an Intel emulator; only the published artifact is trimmed.

### Why `.npmrc` sets `legacy-peer-deps`

Because otherwise npm reinstalls Expo. Nothing here uses it — the phone app is
bare React Native — but `@react-three/fiber`, which the web app uses for the
transfer scene, lists `expo` and three of its packages as **optional** peer
dependencies for a React Native renderer this app never imports. npm 7+ installs
optional peers anyway, which dragged in `@expo/cli`, `@expo/metro-config`,
`babel-preset-expo` and about forty more.

Turning peer auto-install off removes all of it: **1333 packages become 1147**,
and `npm audit` goes from 24 vulnerabilities to 4 — the remaining four are inside
Metro, React Native's own bundler. `npm ci` reads the file, so CI installs the
same tree.

---

## What it does, and what each piece adds

jojo works with zero setup and gains capability as you opt in. Nothing below the
line you stop at is required, and nothing above it is missing — a screen that
needs something you have not set up says so by name. The agentic half starts at
layer 3; the two below it are a tracker that never asks you for anything.

| Layer                       | Requires                    | What you get                                                                                                                                                                                                                                                                        |
| --------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — Browser only**        | Nothing                     | Track applications, deadlines and follow-ups, and keep the documents you attach. Everything lives in browser storage.                                                                                                                                                               |
| **2 — + A backup you keep** | Somewhere to put a file     | One file holding every record, every link and every document. Restoring it puts all three back.                                                                                                                                                                                     |
| **3 — + A model**           | Ollama, vLLM or LM Studio locally — or a free NVIDIA key | The agentic half: a threaded assistant that reads and writes your records under your approval, Job Scout pipelines that complete your profile and watch for postings, "Ask the graph" in a sentence, and scoring against what you are looking for.                                  |
| **4 — + Document reader**   | MarkItDown, running locally | The assistant reads your PDFs, Word files and decks — and a job posting, so **+ New → Application from a link** fills the form in for you.                                                                                                                                          |
| **5 — + The extension**     | Chrome, Edge, Brave or Arc  | Keep a posting exactly as it read, from the tab you are on. It is also what lets a scout pipeline sweep a job board, and what lets a **hosted** copy reach the document reader on your own machine — nothing else here can open a web page, or call `127.0.0.1` from an https page. |

Layer 1 is the only one that must work. Everything above it degrades gracefully when disconnected.

---

## Repository layout

```
jojo/
├── service/             @jojo/service — the knowledge graph, its tools, the
│                        agent that drives them and the React binding. No build
│                        step; both apps compile the TypeScript. Owned by
│                        neither of them.
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
class is kept in sync for shadcn's `dark:` variants.

**Dark, not the OS setting.** `ThemeProvider` opens dark on a store with no preference in it, which
is how the phone has always behaved — `mobile/src/theme/theme.tsx` carries the original argument.
Following the OS reads as the polite default and is not: it hands the app's own identity to a setting
that has nothing to do with it, and since most machines sit on light it shipped a light app to nearly
everyone, when these palettes were tuned dark first. Light and System are both one press away in
Settings, and the choice is remembered.

`system` is now WRITTEN to storage rather than encoded as the absence of a key. That absence used to
mean "follow the OS"; it means "dark" now, so leaving System unstored would have let it look right
for the session and come back Dark on the next load.

A small inline script in `index.html` resolves the theme before first paint to avoid a flash of the
wrong theme. **It duplicates `readPref` and the attribute logic from `lib/theme.tsx` (the key itself
is `THEME_STORAGE_KEY` in `lib/theme-context.ts`) — change both together, the dark fallback
included.** `<html>` ships painted dark, so the default resolves with no reflow and only an explicit
Light or System repaints.

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

This section was rewritten on 2026-08-23, because the version before it listed
Applications, Job scout, Assistant and Settings as "not built" and the LLM
client as "not started" — all four had shipped, and one of them is now half of
what the app is. It carried its own footnote saying so, addressed to "whoever
owns that section", which is a README asking to be believed and disbelieved in
the same breath.

**The tracker:** built. Applications as a table and a board, Calendar, Vault,
Job scout, Statistics, Profile, the graph, Transfer, Settings and the guide are
all real on web; every one of them is real on mobile too. Both apps import the
same `@jojo/service`, so they report the same numbers by construction rather
than by agreement — "verbatim" used to mean a `cp -R` copy that had drifted 813
lines, and that copy is deleted. See `mobile/README.md`.

**The agent:** built, and optional. A threaded assistant whose runs keep going
when you leave the page, `service/kg/agent`'s loop over 77 named write tools and 9 reads, "Ask the
graph" in a sentence, and two Job Scout pipelines — one that proposes what your
records are missing, one that reads the boards you follow through the extension.
Every step that writes is shown to you and waits for a yes; turning a thread to
auto-approve drops that to the destructive steps only, which is a floor and not
a setting. It needs a model you point it at, and without one every screen that
uses it says so by name rather than pretending.

**Deliberately not built:** a localhost bridge. One was designed and written —
loopback HTTP, a session token, path confinement, five cross-compiled binaries —
and then deleted, because documents only ever needed to survive a reload and be
previewable and downloadable, and IndexedDB does all three in every browser jojo
runs in. `docs/NO-SERVER.md` records what was measured, including why a deployed
HTTPS page cannot reach `http://127.0.0.1` at all in current Chromium.

**The search, not just the applications:** people, employers and offers are
records now rather than prose. A `person` node — referee, chair, recruiter —
files under every job they are named on through the same many-to-many relation a
CV uses; an employer has a page of its own, showing the applications, dates and
people at it, from `AT` edges that had existed since the graph did and had never
been shown; and two live offers put a comparison on the dashboard, with the
yearly figure read out of whatever you typed in the package field rather than
asked for a second time. Role tags are your list, seeded with five and edited in
Profile — they were fixed, which quietly meant anyone outside academic CS filed
their search under a label that was not true and then read it back off the
charts. Adding a job already tracked says so, matching on the posting URL or on
employer-and-role, and never on employer alone: three roles at one university is
the case this product is for.

**Two devices:** still one-directional, and now honest about the cost. Transfer
records when it last happened at both ends, so each side can say how far it has
drifted since — "last transfer 6 days ago, and 11 changes have been made here
since". That is not sync and does not pretend to be; it is the number you want
before the button that overwrites the other device.

**Reaching you when the app is shut:** partly. Every date exports as an `.ics` from the Calendar on
both platforms — timeline items and the offer respond-by, which is a field on the application and so
has never appeared on the calendar page itself. Built by `service/kg/core/ics.ts`, which is pure and
shared, and handed to whatever opens a calendar file. Local notifications are the half not built:
the export means a deadline can reach a phone today, and it needs the user to re-export when the
dates change.

Persistence shipped: a knowledge graph in IndexedDB on web and AsyncStorage on mobile, behind one
`Driver` port. Dexie was rejected — see D1 in `docs/KG-ARCHITECTURE.md`.

## Known decisions still open

- **Component tests.** There are more than 1,900 Vitest tests across the three workspaces, but D20 rules out
  jsdom and Testing Library, so nothing mounts a component. UI logic is verified by driving the
  real apps. That trade is deliberate; what it cost at the time is written up in `docs/AUDIT.md`, which is a record of a past audit rather than a live defect list.
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
