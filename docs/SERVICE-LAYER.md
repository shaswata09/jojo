# The service layer

`@jojo/service` is the knowledge graph, its tools, its React binding and the demo
fixtures — imported by `web` and by `mobile`, owned by neither. This file records
the things about that boundary that are true but not obvious from reading it:
the resolution traps, the guards that are load-bearing rather than decorative,
and the reconciliations that were decided in writing rather than discovered as
bugs.

It is written as the migration proceeds. Everything below §3 is Step 3.

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
beginning `@jojo/service` from inside the package. See §5 for the transcript.

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
| `TODAY` | mobile `data/{seed,timeline,calendar}`, re-exported to 19 app sites | **Deleted.** D26: the clock is the app shell's decision and enters the model through `ctx.now`. `mobile/src/lib/today.ts` already exists; Step 4 repoints the app-side readers there. No fixture may read a clock — `check-platform.mjs` bans it in `data/` and the ban is falsified in §5. Note the plan calls the two `today.ts` files byte-identical: they no longer are, and only because Step 2 rewrote web's two import specifiers to `@jojo/service/…` while mobile's still say `@/kg/…`. The bodies are the same. That is an argument for the "duplicate it knowingly, allowlisted" decision rather than against it, but `check-no-copies.mjs`'s content-hash rule must normalise specifiers or the allowlist entry will be the thing keeping the build green. |
| `NEW_LABEL_TONES` | mobile `data/labels.ts`, read by `SettingsScreen.tsx` | **Keep as the rotation, and see §3.4 — the ordering change reported by two prior documents is not real.** The rotation array moves nowhere; `tools/keyword.ts` owns it as `NEW_KEYWORD_TONES`. Step 4 points `SettingsScreen` at that. |
| `frequencyByPeriod` | mobile `data/seed.ts`, read by `StatisticsScreen.tsx` | **Deleted, deliberately, and web deleted it first** — see the comment surviving at `service/data/seed.ts:310`. It was a frozen three-range table of invented counts. `kg/core/statistics.ts` counts from the store instead. Step 4 rewrites `StatisticsScreen` against `statsFor`. Behavioural checklist: the frequency chart still renders. |
| `stageColor` | mobile `data/seed.ts`, read by `components/ui/Chip.tsx` | **Moves into mobile's own code, unchanged — it is not `STAGE_DOT` and must not be resolved into it.** See §3.4b: they look interchangeable and are not. `stageColor(stage, palette)` is a two-line lookup into a theme object the app passes in, which makes it app code that happened to be filed under `data/`. |
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

## 4. The guards

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

## 5. Negative-test transcript

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

## 6. What this package's `tsc` covers, and what only looks like it does

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
