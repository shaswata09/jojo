# The service layer

`@jojo/service` is the knowledge graph, its tools, its React binding and the demo
fixtures — imported by `web` and by `mobile`, owned by neither. This file records
the things about that boundary that are true but not obvious from reading it:
the resolution traps, the guards that are load-bearing rather than decorative,
and the reconciliations that were decided in writing rather than discovered as
bugs.

It is written as the migration proceeds. §3 is Step 3; §4 is Step 4.

---

## 1. The exports map is a type-level boundary, not a bundle-level one

```jsonc
"exports": {
  "./core/*":    "./kg/core/*.ts",
  "./storage/*": "./kg/storage/*.ts",
  "./repo/*":    "./kg/repo/*.ts",
  "./tools/*":   "./kg/tools/*.ts",
  "./react/kg":  "./kg/react/kg.tsx",     // exact keys, hand-listed, ahead of the star
  "./react/status": "./kg/react/status.tsx",
  "./react/*":   "./kg/react/*.ts",
  "./data/*":    "./data/*.ts",
  "./log":       "./kg/log.ts"
}
```

**The star's target names the extension, and that one character is why the map
is viable at all.** Metro does not extension-probe *through* an exports star, so
`"./*": "./kg/*"` fails to resolve `@jojo/service/core/model` on the phone; it
does resolve a star whose target already ends in `.ts`. Vite, tsc 6.0 and tsc
5.9 accept both spellings, so nothing on the browser side can tell you which one
is right.

**But the map does not forbid anything at bundle time.** Measured at Step 2's
gate: importing `@jojo/service/kg/core/model` — a subpath the map does not
declare — bundled successfully, exit 0, with the module present in the Hermes
output. Metro emitted a warning and fell back to file-based resolution:

> `WARN Attempted to import the module ".../node_modules/@jojo/service/kg/core/model" which is not listed in the "exports" of ".../service" under the requested subpath "./kg/core/model". Falling back to file-based resolution.`

`unstable_enablePackageExports` was `true` throughout. Enabled, and still
permissive. The gate that caught it was `tsc`, with `TS2307`.

Two consequences worth holding on to:

1. Any path into `service/` resolves on the phone. The map constrains what
   type-checks, not what ships. `check-no-copies.mjs`'s specifier rule (Step 7)
   is therefore the only bundle-time enforcement that will ever exist.
2. Anything that bypasses `tsc` ships a deep import silently — a `.js` file, a
   `// @ts-expect-error`, or a `tsc` failure someone waves through.

## 2. The package is 100% relative internally, and that is now checked

Two independent mechanical reasons, neither stylistic:

- `@/` resolves against the **consuming app's** root. A `@/data/timeline` line
  inside this package binds to `web/src/data` under Vite and to `mobile/src/data`
  under Metro — not a missing module, the *wrong* module, silently.
- Expo's `resolveWithTsConfigPaths` bails out entirely when the importing
  module's path contains `/node_modules/`, which it does for every file in this
  package once it is reached through the workspace symlink. `@/` cannot resolve
  here at all on mobile, and the failure is at bundle time on a device.

The trap that made this a check rather than a convention is the **package-name
spelling**. `tools/keyword.ts` importing `'../../data/labels'` is reported by
`DATA_READERS`. The same file importing `'@jojo/service/data/labels'` was
reported by *nothing* — a bare specifier falls past the relative branch, past
the `@/` branch, and out the far side as an ordinary package import, which
`tools` is allowed to make. `check-layers.mjs` now rejects any specifier
beginning `@jojo/service` from inside the package. See §6 for the transcript.

---

## 3. Step 3 — the `src/data` reconciliation

`web/src/data` and `mobile/src/data` had eight shared module names and all eight
differed. Step 3 split them three ways:

| Was | Now | What it is |
|---|---|---|
| `seed timeline vault scout labels profile` (+ `seed.test.ts`) | `service/data/` | the demo fixtures, the input to `repo/seed.ts` and `tools/memory.ts` |
| `statistics.ts` `calendar.ts` | `service/kg/core/` | pure domain code that was never fixtures |
| — | `web/src/data/` | a thin façade, 8 files of `export *`, marked for deletion |

Counts held: `service` 417 + `web` 190 = **607**, unchanged; `mobile` **333**,
untouched — it still has its own copy until Step 4. The four tests that moved
are `seed.test.ts`.

The façade is why 168 `@/data/…` import lines across 102 web files did not need
touching. It re-exports every name unchanged and adapts nothing; a shim that
starts renaming things is a second copy of the model wearing a different hat.

### 3.1 The signature diff

Run before anything was resolved, over all eight shared modules, comparing
**names and arities** rather than names — because the failure this step exists to
catch is arity-compatible and silent. Raw, the diff produced 60 entries, but 29
of them were the same artefact: web's modules are façades over `kg/core`, so
every comparison read "re-export vs. function" and no arity was ever compared.
**Dereferencing the re-exports into their `service/` targets is what made the
instrument work**, and it collapsed the diff to 31 real entries — while
uncovering a second arity drift the raw form had hidden.

The instrument is `scratchpad/sigdiff.mjs`; it parses with the TypeScript
compiler rather than a regex, and follows `export { x } from '…'` to the
declaration.

### 3.2 The two arity drifts

**`buildMonth` — silent, and the reason this step was scheduled at all.**

```
web    buildMonth(year: number, month: number, today?: CalendarDay): CalendarMonth
mobile buildMonth(year: number, month: number): CalendarMonth      // closes over TODAY
```

The third parameter is *optional*, so mobile's three call sites —
`screens/CalendarScreen.tsx` ×2 and `components/common/DateField.tsx` — will
compile clean, pass every test, and **silently lose the today marker** on the
calendar grid and the date picker after Step 4 adopts web's version. Resolution:
web's signature is correct and is what moved into `kg/core/calendar.ts`; the
parameter exists because this module may not read a clock. Step 4 must pass
`TODAY_PARTS` at those three sites, and the behavioural checklist item "calendar
grid shows the today marker · date picker shows the today marker" is there
specifically because no compiler will say so.

**`offerDaysLeft` — loud, and only visible after dereferencing.**

```
core/dates.ts       offerDaysLeft(offer: Offer, today: string): number    // required
mobile/src/data/seed offerDaysLeft(offer: Offer, today: string = TODAY)   // defaulted
```

Mobile's two call sites — `lib/priority.ts` and `ApplicationDetailScreen.tsx` —
pass one argument. Web's signature makes `today` required, so those become
`TS2554 Expected 2 arguments` at Step 4 rather than a wrong countdown. This one
does not need a checklist entry; it needs the clock threaded from the app shell,
which is D26 working as intended. It is recorded here because the raw diff
reported it as "re-export vs. function" and said nothing about arity — had the
default silently won, an offer countdown would have been pinned to the fixtures'
October on the phone.

### 3.3 The divergent names

| Name | Where it lives | Resolution |
|---|---|---|
| `TODAY` | mobile `data/{seed,timeline,calendar}`, re-exported to 19 app sites | **Deleted.** D26: the clock is the app shell's decision and enters the model through `ctx.now`. `mobile/src/lib/today.ts` already exists; Step 4 repoints the app-side readers there. No fixture may read a clock — `check-platform.mjs` bans it in `data/` and the ban is falsified in §6. Note the plan calls the two `today.ts` files byte-identical: they no longer are, and only because Step 2 rewrote web's two import specifiers to `@jojo/service/…` while mobile's still say `@/kg/…`. The bodies are the same. That is an argument for the "duplicate it knowingly, allowlisted" decision rather than against it, but `check-no-copies.mjs`'s content-hash rule must normalise specifiers or the allowlist entry will be the thing keeping the build green. |
| `NEW_LABEL_TONES` | mobile `data/labels.ts`, read by `SettingsScreen.tsx` | **Keep as the rotation, and see §3.4 — the ordering change reported by two prior documents is not real.** The rotation array moves nowhere; `tools/keyword.ts` owns it as `NEW_KEYWORD_TONES`. Step 4 points `SettingsScreen` at that. **Superseded by §4.5:** it points at `LABEL_TONE_VALUES` instead, because the swatch picker was never rendering the rotation's *role* — it was rendering the vocabulary, and only the rotation's completeness made that look right. |
| `frequencyByPeriod` | mobile `data/seed.ts`, read by `StatisticsScreen.tsx` | **Deleted, deliberately, and web deleted it first** — see the comment surviving at `service/data/seed.ts:310`. It was a frozen three-range table of invented counts. `kg/core/statistics.ts` counts from the store instead. Step 4 rewrites `StatisticsScreen` against `statsFor`. Behavioural checklist: the frequency chart still renders. |
| `stageColor` | mobile `data/seed.ts`, read by `components/ui/Chip.tsx` | **Moves into mobile's own code, unchanged — it is not `STAGE_DOT` and must not be resolved into it.** See §3.4b: they look interchangeable and are not. `stageColor(stage, palette)` is a two-line lookup into a theme object the app passes in, which makes it app code that happened to be filed under `data/`. **Superseded by §4.4:** measured at Step 4 it has zero importers anywhere — `Chip.tsx` declares a local `const stageColor` and imports only the `Stage` type — so it was deleted rather than moved, and `STAGE_DOT` keeps its `dot` field unread by the phone. |
| `RoleBucket` | mobile `data/seed.ts`, no consumer outside `src/data` | **Deleted.** Free — it existed only to type `frequencyByPeriod`. |
| `remindersOf` | mobile `data/timeline.ts`, no consumer outside `src/data` | **Deleted.** Free. `followUpsOf` in `core/dates.ts` is the surviving selector. |

### 3.4 A correction: the label-tone rotation order does not change

Both prior documents record mobile's new-keyword tone rotation as
`['teal','amber','red','green','gray']` against web's
`['teal','green','amber','red','gray']`, and both call it a visible change to
new-keyword colours on the phone that should be flagged in a commit message.

**Measured, it is not.** Two different arrays were conflated:

| Array | web / service | mobile | Role |
|---|---|---|---|
| rotation | `NEW_KEYWORD_TONES` = `teal green amber red gray` | `NEW_LABEL_TONES` = `teal green amber red gray` | which colour the *next* new keyword gets |
| vocabulary | `LABEL_TONE_VALUES` = `teal amber red green gray` | `TONES` = `teal amber red green gray` | the schema enum a tone is validated against |

The rotations are identical and the vocabularies are identical. The reported
divergence is the rotation on one side compared against the enum on the other.
**Drop the "note the new rotation order" clause from Step 4's behavioural
checklist** — there is nothing to observe, and looking for a change that cannot
happen is how a real one gets explained away.

### 3.4b `STAGE_DOT` is Tailwind, and it is now in the shared package

Flagged here because it is the one thing Step 3 moved that mobile cannot use, and
the resemblance to `stageColor` makes it a trap for whoever does Step 4.

`STAGE_DOT` in `service/data/seed.ts` maps a stage to `'bg-stage-draft'` and five
siblings — **Tailwind class names**, as the comment above it says. `STAGES[].dot`
carries the same strings. `kg/react/use-applications.ts` reads it. Mobile's
`stageColor(stage, palette)` returns `palette.stage[stage]`: a colour value out of
a theme object, resolved by the caller, with no CSS framework anywhere in it.

They answer the same question and share no mechanism. Collapsing one into the
other gives the phone six Tailwind class names it will render as nothing.

Nothing about this was introduced by Step 3 — the fixtures had to move as a unit
and `STAGE_DOT` was inside them — but from Step 4 on, `mobile` importing `STAGES`
from `@jojo/service/data/seed` gets a `dot` field that is web-only. The options
are to invert it (the app supplies its own map, keyed by `Stage`, and the fixture
carries none) or to leave `dot` alone and have mobile ignore it. The first is
right and it is a Step 4 decision, not this one.

### 3.5 Everything else the diff reported

The remaining entries are all one artefact and need no decision: mobile's
`data/*` still **declare a second, parallel domain model** — `Application`,
`Stage`, `Outcome`, `Urgency`, `Profile`, `Label`, `VaultFile`, `FileBucket`,
`SnippetTag`, `LinkCategory` and the rest — where web's re-export them from
`kg/core/model`. Mobile's are structurally equal to web's with two exceptions,
both already decided elsewhere:

- `VaultFile.uri` — mobile-only, shipped, read by `FileViewer.tsx`. **Kept**, and
  it is Step 6's business: one `FileProps` carrying `path bytes mtime hash uri`,
  all optional, all declared in `validate.ts`.
- `Application.slug` — web-only, and load-bearing (`addressOf`, `ctx.mintSlug`).
  Adopted with web's tree.

`statistics.ts` also renamed its band type `Outcome` → `OutcomeBand`. Web's
rename is the fix: mobile's `Outcome` collided with the domain's five-value
union in the same program. Adopted.

`STAGES` lost its `dot` field to the separate `STAGE_DOT` map; see `stageColor`
above.

`FILE_BUCKETS`, `LINK_CATEGORIES` and `SNIPPET_TAGS` report as `array[1]` on web
against `array[4]` on mobile — that is `[...FILE_BUCKET_VALUES]` spreading the
single source in `core/model` versus four hand-written literals. Same four
values, one place to add a fifth.

### 3.6 The eight strictness errors

`statistics.ts` and `calendar.ts` were compiled by no `kg` project — reached by
no `kg` module, so web's `tsconfig.app.json` was the only program that ever saw
them, with DOM in the lib and `vite/client` in the types. Moving them into
`kg/core` put them under `noUncheckedIndexedAccess` for the first time and
produced exactly the eight errors both probes predicted. All eight are fixed at
the source rather than with `!`, matching house style:

- **7 in `statistics.ts`.** Four were `funnel[0].count` / `funnel[step].count`,
  correct by construction (`funnelFor` maps the five `FUNNEL_STEPS`) but not
  provably so — now one `countAt(funnel, step)` helper with a `?? 0` fallback
  that is also the right answer, since every one is a numerator or a
  denominator. Three were the median calculation indexing `gaps` three times
  inside its own ternary branches; the two middle elements are read once into
  locals ahead of the guard.
- **1 in `calendar.ts`,** and it was hiding a real inconsistency.
  `MONTH_LABELS[month - 1]` went undefined for a month outside 1–12 — while
  `days` and `startsOn`, both computed from `new Date(year, month - 1, …)`, had
  already been *normalised* into the neighbouring year. Reading the label off the
  same rolled-over date makes the three agree.

### 3.7 What the fixtures being shared means for the demo graph

`service/data/` is web's fixture set. The two apps ship the same demo graph from
Step 4 on, and the one deliberate content difference is web's: `meta` / Meta /
Menlo Park became `rice-research` / Rice / Houston, to give the fixture its only
repeated employer — the single row that exercises `org.ensure` + `ctx.mintSlug`
on a node staged earlier in the same transaction. `seed.test.ts` asserts exactly
that, and it moved into `service/data/` with the fixtures it tests.

---

## 4. Step 4 — deleting the mobile fork

79 of mobile's 81 `src/kg` files deleted, all 8 of `src/data` deleted,
`tools/coverage.test.ts` moved into `service/test/`, `storage/rn-driver.ts` kept.
131 app-side specifiers repointed. The precondition ran first and is below.

### 4.1 The precondition, which was the plan's biggest gamble

`service/kg` copied to a scratch tree, the 20 shared kg test files overwritten
with mobile's, run:

```
Test Files  20 passed (20)
     Tests  297 passed (297)
```

**297/297, the number the plan predicted.** No mobile test encodes behaviour the
shared tree lacks, so the reconciliation is a deletion and not a merge — which is
the single sentence the whole big-bang shape rests on. Had it come back red the
fork would have been a real disagreement and Steps 4–8 would have been wrong.

### 4.2 Four of the five "mobile is ahead" deltas are dead code

The plan lists five deltas to re-apply, two of them with the consequence *"`rn-driver`
will not compile"*. Measured against `mobile/src` before the deletion:

| Delta | Consumers outside its own file | Applied? |
|---|---|---|
| `tools/vault.ts` — the `uri` prop | `FileEditor.tsx`, `FileViewer.tsx`, `lib/documents.ts` | **Yes** — §4.3 |
| `react/use-scout.ts` — `addMatch` | **0 in `mobile/src`, 0 in `web/src`** | No |
| `storage/schema.ts` — `STORE_SPEC_BY_NAME` | **0**, and `rn-driver.ts` does not import it | No |
| `storage/memory-driver.ts` — `emptyMemoryDriver()` | **0**; `rn-driver.ts` imports `createMemoryDriver` and `emptyRows` | No |
| `tools/support.ts` — `titleOf` | **0** | No |

`rn-driver.ts` imports exactly `driverFail`, `emptyRows`, `classify`,
`createMemoryDriver`, `MemoryDriver`, `kgWarn` and its types. Neither name the
plan said it needed appears in it. The claim was never measured against the file.

`addMatch` is the one worth stating carefully, because the plan's reason for
keeping it — *"web has a registered tool with no hook; a naive take-web deletes a
working function"* — is half right and leads the wrong way. `scout.match.save` is
registered in both registries and IS exercised, by `coverage.test.ts`, which this
step moves into the package. What has no caller is the HOOK wrapper, on both
sides. Re-adding it would have restored dead code over a deletion `use-scout.ts`
and `tools/scout.ts` already argue for in writing, on the strength of a delta
that says only "the phone still had it".

**`tsc --noEmit` over `mobile` is the falsification** and it passes: had any of
the four been load-bearing, deleting them with the fork would have failed there.

### 4.3 `uri`, and the bug that nearly made it look unused

`uri` is real and is now declared, validated and salvageable — `FileProps.uri` in
`core/model.ts`, `s.optional(s.string())` in `core/validate.ts`, a fifth entry in
`SALVAGEABLE_FILE_PROPS`, and `uri` on `vault.file.add`'s draft schema.

The instructive part is what the trail looked like on the phone: `FileEditor.tsx`
put the picked location into its draft, `vault.file.add` declared the field and
wrote it — **and `useVault().addFile`, the only caller, listed the draft's props
by hand and left `uri` out.** Every record written through the picker landed with
no `uri`, so `documentExists(file.uri)` in `FileViewer.tsx` answered false for all
of them and the Open button never appeared. A field written by nobody reads
exactly like a field nobody needs, which is how the one genuine delta in the list
came closest to being dropped. The forward is in `use-vault.ts` now.

Two new cases in `core/salvage.test.ts` pin it, and both were falsified by
deleting the declaration and watching them fail:

```
✗ reject a uri that is not a string     — expected [] to have length 0 but got 1
✗ drops a bad uri and keeps the file    — expected props not to have property "uri"
```

`uri: 99` reaching `openDocument(file.uri)` was a live bug on the phone,
independent of this migration. It is closed.

### 4.4 `STAGE_DOT`: the fixture keeps its Tailwind, and mobile ignores it

§3.4b left this as Step 4's decision, between inverting the map (the app supplies
its own, keyed by `Stage`) and leaving `dot` alone.

**Left alone, and `stageColor` was deleted rather than moved.** The measurement
that decided it: `stageColor` has **zero importers anywhere in `mobile/src`**.
`components/ui/Chip.tsx`, named in both prior documents as its consumer, declares
a *local* `const stageColor = stage ? c.stage[stage] : undefined` and imports only
the `Stage` type. So there is no mobile reader of `STAGES[].dot` to protect and no
mobile map to invert into — inverting would have been a change to the fixtures,
the web app and `use-applications.ts` in service of a caller that does not exist.
`dot` stays a web-only field on a shared fixture, unread by the phone. Revisit it
the day mobile wants stage colours from data rather than from its theme.

### 4.5 The `SettingsScreen` tone list was the vocabulary, not the rotation

§3.4 established that the two tone arrays are byte-identical in content and that
the "new rotation order" divergence was one array compared against the other.
That is still true, and Step 4 found the reason the two got conflated.

`SettingsScreen.tsx` imported `NEW_LABEL_TONES` — the **rotation**, which decides
what colour the next auto-created keyword gets — and rendered it as the swatch
picker in the edit-label sheet. A picker is a **vocabulary**. It was right only by
accident: the rotation happens to contain all five tones, and would have stopped
being right the day anyone shortened it to three.

It reads `LABEL_TONE_VALUES` from `core/model.ts` now, which is the array
`s.enum` validates a saved tone against — so the picker offers exactly what will
save. **The one visible change in this step:** the swatches reorder from
teal-green-amber-red-grey to teal-amber-red-green-grey.

### 4.6 `frequencyByPeriod` and the module its deletion pulled down

`StatisticsScreen.tsx` read the frozen `frequencyByPeriod` table, which web
deleted deliberately at Step 3 (`data/seed.ts` still carries the note). §3.3 says
to rewrite the screen "against `statsFor`" — but `statsFor` returns role TOTALS
and the panel plots applications over TIME, so there was nothing there to rewrite
against.

Web had already solved it: `ApplicationFrequency.tsx` counts real records through
`components/charts/frequency-buckets.ts`, whose own header read *"WHERE THIS
SHOULD END UP: beside the date library, wherever that lands — today
`src/data/timeline.ts`, which the probes want split into `kg/core`."* That landing
happened at Step 3. So the module moved to **`service/kg/core/frequency.ts`** and
both apps count through it. `Period` moved with it from `data/seed.ts` down to
`core/model.ts` as `PERIOD_VALUES`, for the same reason every other union did:
`core` buckets by it and may not read a fixture. `PERIODS`, the labelled list a
segmented control renders, stayed with the fixtures.

Two things fell out of the move, and both are the point of making it rather than
copying the file:

- One `noUncheckedIndexedAccess` error, the ninth of the class §3.6 describes,
  from `.split(' ')[0]`. Fixed by destructuring with a default, not `!`.
- **12 tests it could not previously have.** The header also said its year
  rollover — month 13 of 2026 leaning on `isoOf`, and `y * 4 + ceil(m / 3) - 1`
  for quarters — had no test and could not have one while it was a closure inside
  a 200-line SVG component this codebase does not mount (D20). `frequency.test.ts`
  is that test.

### 4.7 The two arity drifts, resolved as §3.2 predicted

**`offerDaysLeft` failed loudly** — `TS2554 Expected 2 arguments, but got 1` at
`lib/priority.ts` and `ApplicationDetailScreen.tsx`, and at nothing else. `TODAY`
threaded from `lib/today.ts` at both.

**`buildMonth` failed at nothing**, which is the whole reason it was scheduled.
All three call sites — `CalendarScreen.tsx` ×2 and `DateField.tsx` — compiled
clean against the three-parameter signature and would have silently lost the
today marker. `TODAY_PARTS` is passed at all three, and each carries a comment
saying the compiler will not notice if it goes.

`mobile/src/lib/today.ts` already exported `TODAY_PARTS` under that exact name, so
the `TODAY as TODAY_PARTS` that `@/data/calendar` re-exported had a same-named
successor waiting. The plan's "19 app-side import sites" of `TODAY` had already
been repointed in a previous wave; the only remaining fixture-clock readers were
`data/seed.ts` and `data/calendar.ts` themselves, both deleted.

### 4.8 One driver contract, three drivers

Folded into this commit rather than left for Step 5, because the plan says so in
those words and because it is the only deletion among the 79 that removed
coverage instead of duplicating it: `mobile/src/kg/storage/driver-conformance.test.ts`
was `rn-driver.ts`'s only test, and `rn-driver.ts` is the one genuinely
platform-specific file in the repo.

The contract is `service/kg/storage/driver-conformance.ts`, exporting
`describeDriverConformance(subject)`. **Not** a `*.test.ts`, so vitest does not
collect a file that declares no subject. Three call sites, one per platform:
`service` over `memory`, `web/src/kg/storage/idb-conformance.test.ts` over `idb`,
`mobile/src/kg/storage/rn-conformance.test.ts` over `rn`.

It is a function and not a `SUBJECTS` array because an array only reaches drivers
importable from where the array is, and these three are not: IDB needs
`fake-indexeddb`, RN needs an AsyncStorage mock, and neither may be a dependency
of this package. That is exactly why there were two arrays, and why the phone's
one ran a one-generation-old contract.

`rn-driver` passes the whole contract on its first run, including web's *"stores
a row by value, keeping an absent key absent and a null null"* — a case whose
comment names the Expo app as the reason it was written, and which the phone's
copy predated. Free win, no latent bug, exactly as the probe predicted.

One case is genuinely not portable, and `DriverSubject.crossTab` says so rather
than a skip: `rn-driver` reports `crossTab: false` because there is no second
instance of a phone app reading one AsyncStorage, so its `onRemoteCommit` takes a
listener and never calls it. Asserting delivery would fail it for being correct.
It runs the other half of the same contract instead — that the unsubscribe is
real and idempotent — which is the half `boot-live.ts` depends on either way, and
which nothing else in the suite calls.

### 4.9 What the counts did, and the invariant that actually held

| | before | after |
|---|---|---|
| `service` | 417 | **453** |
| `web` | 190 | **181** |
| `mobile` | 333 | **17** |
| total | 940 | **651** |

**The brief's "at least 940" invariant is arithmetically impossible and must not
be adopted.** Mobile's 333 was 21 copied kg test files running assertions the
shared suite already makes about the same source; the plan's own §6 says the
suite is *supposed* to shrink by ~313 here, and 940 − 313 = 627. A count that
must not fall cannot survive a step whose entire purpose is deleting duplicated
coverage — and worse, it would be satisfied by re-adding the copies, which is the
thing being deleted. (Web's 190 → 181 is the memory subject of the conformance
suite moving to `service`, where it now runs once instead of twice.)

The invariant that does hold is the plan's real one: **title sets, compared, with
every removal accounted for.** Of 325 leaf test titles under `mobile/src` at
HEAD, 320 exist verbatim somewhere in the tree afterwards. The five that do not
are renames, each with a strictly stronger successor:

| removed | successor | why |
|---|---|---|
| `delivers remote commits and blocking to their subscribers` | `…, and stops on unsubscribe` | superset |
| `drops a removed row and forgets its cache entry` | `drops a removed row` + `serves the snapshot it was handed, even one older than the last` | split; the cache half became the epoch-cache guard |
| `publishes a new array when the order changes and nothing else does` | `publishes a new array when a row is inserted ahead of the others` | same property, named trigger |
| `rejects an edge the schema does not allow` | `rejects a badly-typed id before it becomes an edge` | same body, plus a `field` assertion |
| `returns an unsubscribe from each listener registration` | the contract's two unsubscribe cases | the old one registered both listeners, called both unsubscribes twice and asserted nothing at all |

### 4.10 Production Metro, after the copy is gone

```
› android bundles (1):
  _expo/static/js/android/index-…hbc (5.03 MB)
```

`expo export --platform android --clear`, cold. The bundle was then read rather
than trusted — Hermes keeps string literals, so:

```
FOUND   "The record was created and could not be read back."   ← service/kg/react/read-back.ts
FOUND   "Came back without its document link."                 ← service/kg/core/validate.ts
absent  "frequencyByPeriod"                                    ← the deleted fixture table
absent  "NEW_LABEL_TONES"                                      ← the deleted rotation
```

Two strings that exist only in `service/` are compiled into the phone bundle and
two that existed only in the fork are not, so the app is running the shared
package rather than a copy Metro found first.

### 4.11 The behavioural checklist, and why it is the gate here

After this step `mobile` has 17 tests: 8 over `lib/fit.ts` and 9 running the
shared driver contract over `rn-driver`. **Nothing automated covers a mobile
screen.** `buildMonth` is the proof that this matters — it compiled, it passed,
and it would have shipped a calendar with no today marker.

By hand, on a device, before this is called done:

- calendar grid shows the today marker
- the date picker shows the today marker
- Statistics renders its frequency chart, and it is now EMPTY on an empty store
  (it could not previously be, which was the bug)
- Settings shows five label-tone swatches, reordered per §4.5
- Vault: attach a file, reopen it, confirm it opens — this is `uri` end to end,
  and the forward in `use-vault.ts` means it should work for the first time
- Job Scout: save a match, confirm it survives a restart
- Today screen priority ordering

Not on the list any more: "note the new rotation order". §3.4 established there is
nothing to observe there, and §4.5 is where the real ordering change is recorded.

---

## 5. The guards

One copy, in `service/scripts/`, run from `service`'s own `lint`, which both apps
invoke. They used to live in `web/scripts/` and resolve to `web/`, which is why
mobile's copy of `src/kg` was never checked by them — 18 layer and 5 platform
violations sat there unreported for as long as the copy existed.

`check-layers.mjs` walks `kg/` and `data/`. Three edits landed in Step 3:

- **A `../../data/…` specifier is recognised as the fixtures**, and routed into
  the `DATA_READERS` allowlist rather than reported as an escape. Without this
  the guard reported all 22 legitimate imports as "reaches outside kg/ with a
  relative path" and knew nothing about who was permitted to write them. The
  allowlist was written in `@/` vocabulary and the `@/data` branch was what
  enforced it; once the fixtures came into the package that branch stopped
  running.
- **`@jojo/service/…` from inside the package is a violation.** §2.
- **The `data/` walk resolves and classifies relative paths** instead of waving
  them through. That was safe only while the fixtures were in a different package
  from `kg` and could not reach it relatively at all; now `../kg/repo/boot` is one
  plausible typo away from inverting the direction.

The `@/data` alias grants in `RULES` are all `[]` now. The grant survives — the
fixtures are still readable by exactly `repo/seed.ts` and `tools/memory.ts` — but
it is spelled relatively, because `@/` was never a specifier this package could
keep once mobile started importing it.

`tsconfig.core.json` names the whole `data` directory. It previously reached only
the six fixture modules `kg` happened to import, which is how `statistics.ts` and
`calendar.ts` went uncompiled at kg strictness for as long as they did.

## 6. Negative-test transcript

A guard that passes proves nothing. Each of these was introduced deliberately,
observed to fail, and reverted.

```
1. tools/keyword.ts importing '../../data/labels'          (a non-reader, relative)
   kg/tools/keyword.ts:1  imports the demo fixtures ('../../data/labels'). Only
   repo/seed.ts and tools/memory.ts may — see DATA_READERS in this file. …

2. tools/keyword.ts importing '@jojo/service/data/labels'  (the package name)
   BEFORE the §2 rule:  "check-layers: kg and data import direction is clean"   ← WRONG
   AFTER:  kg/tools/keyword.ts:1  imports this package by name
   ('@jojo/service/data/labels'). Write it relative. A bare '@jojo/service/…'
   specifier is invisible to every allowlist in this file, …

3. repo/seed.ts importing '@/data/labels'                  (an ALLOWED reader, old spelling)
   kg/repo/seed.ts:1  L2 repo imports '@/data/labels'. Allowed aliases: none.

4. data/labels.ts importing '../kg/repo/seed'              (fixture reaching up)
   data/labels.ts:1  data/ imports repo ('../kg/repo/seed'). Only kg/core — the
   fixtures are the input to repo/seed.ts and tools/memory.ts, so an edge back
   up into those layers is a cycle.

5. data/labels.ts importing '@jojo/service/data/seed'      (fixture, package name)
   data/labels.ts:1  imports this package by name ('@jojo/service/data/seed'). …

6. data/labels.ts importing '../../web/src/lib/today'      (fixture escaping)
   data/labels.ts:1  data/ reaches outside the package with a relative path.

7. data/labels.ts importing 'react'
   data/labels.ts:1  data/ imports 'react'. Only kg/react may import React.

8. data/labels.ts referencing `document.title`             (check-platform)
   data/labels.ts:1  references the global `document`.

9. kg/core/calendar.ts calling `Date.now()`                (check-platform)
   kg/core/calendar.ts:1  reads the wall clock with `Date.now()`.
```

Item 9 is worth reading beside `calendar.ts` itself, which calls
`new Date(year, month, 0)` on the line above and is not flagged. The distinction
the guard draws is between constructing a date from given parts and *reading the
clock*, which is the distinction D26 is about.

## 7. What this package's `tsc` covers, and what only looks like it does

Service source is type-checked by three programs with three flag sets, and only
one of them is authoritative. `web/tsconfig.app.json` has `"include": ["src"]`
and pulls service `.ts` in through imports under `lib: ["ES2023","DOM"]`;
mobile's Expo base does the same under `lib: ["DOM","ESNext"]`. `skipLibCheck`
does not apply to `.ts` source. Neither app's program includes
`types/portable-globals.d.ts`, so `console`, `crypto` and `structuredClone` in
service source resolve from each app's `lib.dom` instead — which currently works
by luck.

**`npm -w @jojo/service exec tsc -b` is the authority.** The apps' pass over this
source is incidental and must not be treated as the check.
