# jojo — mobile

The same job tracker as `web/`, as an Android and iOS app. React Native via Expo.

Everything runs on the device. There is no server, no account and no network call
of any kind — the store lives in memory for as long as the app is open, seeded
with the same twelve applications, timeline, vault and profile the web prototype
ships with. Settings is where you switch between that and an empty store.

---

## Building it

`android/` and `ios/` are real, committed native projects. Open `android/` in
Android Studio or `ios/jojo.xcworkspace` in Xcode and build them the way you
would build any other app. Nothing about the build goes through Expo Go, EAS, or
a dev server.

**What you need**

| For     | Install                                         |
| ------- | ----------------------------------------------- |
| Both    | Node 22+                                        |
| Android | JDK 17, Android SDK platform 36, build-tools 36 |
| iOS     | Xcode 15+ with an iOS 16.4 SDK, and CocoaPods   |

```bash
cd mobile
npm install

# Android — a signed, installable APK with the JS bundled in
cd android && ./gradlew assembleRelease
# → app/build/outputs/apk/release/app-release.apk
adb install -r app/build/outputs/apk/release/app-release.apk

# iOS — resolve pods once, then build from Xcode or the command line
cd ios && pod install
xcodebuild -workspace jojo.xcworkspace -scheme jojo -configuration Release
```

`npx expo run:android` and `npx expo run:ios` do the same build and then install
and launch it, which is usually what you want while developing. They are
wrappers around Gradle and `xcodebuild` — not a different build path.

| Script                            | Does                                                            |
| --------------------------------- | --------------------------------------------------------------- |
| `npm run android` / `npm run ios` | Native debug build, installed and launched, with Metro attached |
| `npm start`                       | Metro on its own, for reloading JS into an installed build      |
| `npm run typecheck`               | `tsc --noEmit` — the check that actually matters                |
| `npm run lint`                    | oxlint, same plugins and rules as `web/` plus no-unused-vars    |
| `npm run format` / `format:check` | Prettier, configured to match `web/`                            |

Before committing: `npm run typecheck && npm run lint && npm run format:check`.

### The release APK is signed with the debug key

`assembleRelease` is configured — by React Native's own template — to sign with
`android/app/debug.keystore`. That is fine for putting a build on your own
phone and **not** fine for distribution: everyone who builds this repo produces
an APK with the same key. Before shipping anywhere real, generate a keystore and
point the `release` signing config at it.

### Why the native projects are committed

They were generated once with `npx expo prebuild` and then checked in, which
makes this a normal React Native project rather than one that has to be
materialised by a tool before it can be opened.

The trade-off is real and worth stating: `expo prebuild` **regenerates** these
directories from `app.json` and overwrites anything edited by hand. Treat it as
a bootstrap that has already happened. Native changes now go in the native files
directly — or into `app.json` followed by a deliberate re-run and a look at the
diff.

### Expo is a library here, not a workflow

Removing the Expo _workflow_ did not mean removing every Expo _package_. Six
remain, each an ordinary native module linked into the build like any other
dependency:

| Package                 | Doing                                                      |
| ----------------------- | ---------------------------------------------------------- |
| `expo`                  | The module registry the others autolink through            |
| `expo-font`             | Loads Inter and JetBrains Mono at startup                  |
| `expo-clipboard`        | Copy, in the vault and on every code block                 |
| `expo-status-bar`       | Status bar colour, following the theme                     |
| `expo-system-ui`        | Paints the native root dark before React mounts            |
| `expo-build-properties` | Writes the SDK floors below into the Gradle and Pod config |

None of them requires Expo Go, an Expo account, or a network call. If you want
them gone too, each has a plain React Native equivalent — that is a separate
piece of work and this README would be lying if it claimed it had been done.

### Platform floor

**Android 12 (API 31)** and **iOS 16.4**, set in `app.json` through
`expo-build-properties` and compiled against Android SDK 36. Anything older is
out of support; do not spend time testing on it.

---

## What is shared with the web app, and what is not

**Taken from `web/`** — plain TypeScript with no DOM in it, and the reason the
two apps cannot disagree about a date, a rate or a stage:

```
src/data/     timeline · seed · calendar · vault · scout · profile · labels · statistics
src/lib/      ids · files · draft-from · deadline · store-context · store
              labels · labels-context · roles · roles-context · priority
```

`src/data/statistics.ts` in particular is why the funnel here and the funnel on
the web report the same numbers: both count the same records with the same
`reachedOf` test rather than each deriving its own.

### Drift, stated plainly

`web/` has since been refactored onto a knowledge-graph store (`web/src/kg/`).
Its `data/*` modules are now thin re-export shims over `@/kg/core/model`, and
`web/src/lib/store-context.ts` is a façade its own comment says Wave 4 will
delete. **Mobile still carries the pre-graph copies.**

What that costs today: _nothing observable._ Every seeded fixture and every
enumeration was compared value by value after the refactor — applications,
timeline, links, files, snippets, pipelines, matches, postings, keywords,
`ROLES`, `SOURCES`, `STAGE_VALUES`, `LINK_CATEGORIES`, `FILE_BUCKETS`,
`SNIPPET_TAGS` — and all of them are identical. The divergence is where the
types live, not what they say.

What it will cost later: the graph layer is the direction of travel, and mobile
should follow it once `web/src/kg` settles. Until then, treat the list above as
**"copied, and needing a re-copy when web's Wave 4 lands"** rather than as a
shared source of truth.

Three edits were deliberate and should survive any re-copy:

- `data/seed.ts` carried a Tailwind class per stage (`dot: 'bg-stage-draft'`).
  There are no class names on this platform, so stage colour is a palette lookup
  and `STAGE_LABEL` moved here from the three files that each had a copy.
- `lib/priority.ts` spelled its destinations as route strings. There are no URLs
  here, so an action carries the record's id and the caller navigates.
- `lib/graph.ts` is a smaller model than the web's, laid out by type rather than
  by a force simulation — see below.

**Written for this platform:**

```
src/theme/        the design tokens from web/src/index.css, as objects
src/components/   the UI kit — Panel, Chip, Button, Field, Segment, Sheet, Menu…
src/screens/      one file per screen; the Vault is a folder, one per tool
src/sheets/       the three create/edit forms, plus the stage transition
src/navigation/   bottom tabs + a native stack
```

---

## The shape of the app

```
Tabs        Today · Applications · Calendar · Vault · More
Stack       Application detail · Search · Job scout · Statistics · Graph
            Transfer · My profile · Assistant · Settings · How to use
Sheets      New/edit application · New/edit reminder or event · Draft a message
            Stage transition · Confirm · every overflow menu and picker
```

Five tabs is the ceiling on a phone and the four besides More are what a job
search touches daily. Job scout and Statistics move under More with the account
pages — the class of destination you visit occasionally rather than as part of
the work, which is where the web sidebar puts them too (its top bar, not its
nav rail).

Every tab badge counts something visible on the screen it points at: flagged
applications, the next seven days, reminders past their date, matches nobody has
promoted yet.

---

## What changed for touch, and why

The web prototype is pointer-first in four places. None of them survives a
phone unaltered, and in each case the mobile answer is a control the web app
already offers rather than a new idea:

| Web                                   | Mobile                                      | Why                                                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Drag a card between board columns     | Long-press, then drag — plus the stage menu | See below. The drag is real; the menu stays because a drag is unavailable to a screen reader.                                                                                        |
| Drag a chip onto another calendar day | Reschedule from the day list                | Landing a 4px drop target on a 44pt cell is not a gesture a thumb can aim.                                                                                                           |
| `⌘K` command palette                  | A Search screen behind the header           | Same haystack — applications, dates, the vault, the scout — reached by a button rather than a chord.                                                                                 |
| Centred modal dialogs                 | Bottom sheets                               | The thumb is at the bottom, and a form holding a keyboard needs the room above it rather than around it.                                                                             |
| Tooltips on disabled controls         | A line under the button                     | There is no hover, so the reason a control is dead has to be rendered. `Button` takes a `blocker` and renders it; a disabled button with no reason is not reachable through the API. |

Two things the phone gets that the web version does not need: every tap target
is drawn at 44pt rather than reaching it with invisible catch areas, and the
type scale is one step up throughout — the ratios are unchanged, so the
hierarchy reads identically, but 13px table rows are not a thing you hold in
your hand.

### Dragging a board card

A drag inside a horizontal scroller is two gestures competing for one finger.
The long press is what separates them: hold a card still for 220ms and the board
takes the touch; move before that and the scroller keeps it. So a flick still
scrolls the board and never picks a card up by accident.

Three consequences, all load-bearing:

- The **page** scroller is frozen while a card is in the air. Otherwise the
  board slides out from under the drag and the floating card, positioned against
  the board's measured origin, parts company with the finger.
- Near either edge the board **scrolls itself**, on the UI thread. A column four
  to the right is otherwise unreachable without letting go.
- The drop calls the same `onMoveStage` the stage menu calls — so a dragged move
  gets the same confirmation sheet where the target stage needs details, and the
  same undo toast. A drag is a new way to ask for a move, not a second
  implementation of one.

The stage menu stays on every card. Drag is an addition, not a replacement: it
is unavailable to anyone driving the app with a switch or a screen reader, and
removing the menu would have taken the feature away from them to save a tap for
everyone else.

### Rotation

The app is unlocked in both orientations and the activity handles the config
change rather than restarting. `src/lib/use-layout.ts` is the only place that
reads the current size, and it reads it with `useWindowDimensions` —
`Dimensions.get` answers with whatever was true at module-evaluation time and is
the classic way a rotated app draws a portrait layout on a landscape screen.
Nothing in this codebase may call it.

Turning the phone changes two things. The notch moves to the side, so the safe
area insets fold into the horizontal gutter. And lines get too long to read past
~720dp, so the extra width is absorbed into the gutters rather than into longer
lines — content stays centred and every percentage- and flex-based layout inside
it keeps working untouched. Sheets stop pretending to be sheets in landscape,
where there is too little height for one, and become centred cards.

### Tablets

There are two layouts, and the switch is at **900dp**:

| Width                                             | Layout                                  |
| ------------------------------------------------- | --------------------------------------- |
| < 900dp — phones either way, tablets held upright | One column, capped at 720dp and centred |
| ≥ 900dp — a tablet on its side                    | **Two columns**, capped at 1200dp       |

900dp is chosen so a phone in landscape (~850dp) and a 10" tablet upright
(~800dp) both stay on the phone layout, which is right: neither has the width to
run two useful columns.

The second column is **opt-in per screen**, via `<Columns>` in
`components/ui/Screen.tsx`. That is not laziness — "the children of this screen"
and "the panels of this screen" are different sets. Applications leads with a
toolbar, a search field and a row of filters before its list, and cutting that
lot down the middle would put the search box beside the results. Six screens are
genuinely a stack of independent panels and opt in: Today, More, Settings,
Statistics, Profile, How to use.

The split alternates — index 0, 2, 4 left; 1, 3, 5 right — rather than measuring
and balancing. Real balancing needs heights, heights need a layout pass, and a
layout pass means the columns visibly reshuffle after first paint. On a stack of
panels of roughly similar size, alternating lands close enough.

Everything else gets the width for free by way of the raised cap: the calendar
grid draws 1200dp-wide cells, and the board shows nearly five stage columns
instead of under three.

---

## What is honest about being unfinished

The same three claims the web app is careful about, kept careful here:

- **The assistant has no model.** Every reply is one of five worked examples and
  carries a badge saying so. The fallback says it is a canned answer rather than
  improvising a plausible paragraph.
- **The scout scores nothing.** Pipelines are writable and postings are savable;
  the banner says matching is paused, and the seeded fit scores are labelled
  "example scores".
- **Nothing is fetched or written to disk.** Saving a posting keeps the URL and
  the employer guessed from it. Recording a document keeps a name, a size and a
  type. Export copies the store to the clipboard, because a phone has no
  downloads folder this build has asked permission for. Transfer walks through
  the handoff and says, under the pairing code, that no connection is open.

The graph is a smaller model than the web's: the same node types and
relationships, laid out by type rather than by a force simulation, with six
canned cross-collection queries instead of a visual query builder. A force
solver on a 390pt canvas with 120 nodes settles into a hairball.

---

## Where the rules live

The point of the layout is that a rule exists once. If you find yourself about
to write one of these a second time, it is already here:

| Module                            | The rule it owns                                                                |
| --------------------------------- | ------------------------------------------------------------------------------- |
| `theme/tokens.ts`                 | Every colour, size and radius. The single source of design truth.               |
| `lib/marks.ts`                    | The colour law — red is past due, amber is inside 48 hours, done outranks both. |
| `lib/use-item-actions.ts`         | Every write a dated row can make, and the undo toast each one owes.             |
| `lib/urls.ts`                     | The three readings of a URL: openable, host only, path included.                |
| `lib/search.ts`                   | Accent-folded matching, so "Andre" finds "André".                               |
| `lib/text.ts`                     | `plural`, `listJoin`, `sentence` — the prose helpers.                           |
| `lib/create-actions.ts`           | What can be created, read by both the + menu and Search.                        |
| `lib/stage-transition.ts`         | Whether a stage move has anything to ask about.                                 |
| `components/common/recordMenu.ts` | The row-menu order: Edit · Duplicate · Move to · Delete.                        |
| `components/common/ItemMenus.tsx` | The snooze and overflow sheets every dated row uses.                            |
| `theme/styles.ts`                 | The style fragments that are genuinely cross-cutting.                           |
| `lib/use-layout.ts`               | How wide the app is right now, and the only module allowed to ask.              |
| `components/ui/Screen.tsx`        | The page frame, its gutters, and `<Columns>` for tablets.                       |
| `screens/applications/Board.tsx`  | The stage board and its long-press drag.                                        |

Providers follow the web's split: `*-context.ts` holds the context and its
hooks, `*.tsx` holds the provider. A module that exports both a component and a
hook loses Fast Refresh for everything importing it, which `npm run lint`
enforces.

`theme/styles.ts` is the one worth policing. Its whole reason to exist is that
`{ flex: 1, minWidth: 0 }` was being retyped in every file, and it had drifted
back: twenty-five local styles were byte-identical to `s.fill`, `s.row`,
`s.chipRow` or `s.struck` and have been folded back into them. Before adding a
style, check whether it is already one of the six fragments there.

## Conventions

**`src/theme/tokens.ts` is the single source of design truth**, the way
`web/src/index.css` is over there. The two palettes are the same hex values,
measured for WCAG contrast on the surfaces they land on and validated for
colour-blind separation across the six pipeline stages. Retheming means editing
those two blocks and nothing else.

**Colour law**, unchanged from the web app: red means past due and nothing else,
amber means inside 48 hours and nothing else. Everything further out is neutral
however important it is. Chart series live in their own namespace so a red
segment is never ambiguous between "overdue" and "series 4", and the loud
coloured pills belong to the user's own keywords.

**Undo over confirmation.** Anything the store can restore raises an undo toast;
only the three writes the reducer cannot walk back — clear, reseed, and deleting
an application — get a confirmation sheet, and deleting gets both because the
two guards catch different mistakes.

**Never invent a number.** A count that cannot be derived is not rendered. Panels
with nothing to show say what would fill them and leave something to press.
