# jojo — code audit

> **SUPERSEDED — kept as a record, not as guidance.**
>
> Every defect this document reports has been fixed, and in most cases the fix is
> commented at the line it cites, naming this audit. Every `src/kg/…` path in it
> is dead: that tree moved to `service/kg/` when the service layer was split out.
> Every count is stale — tests, files, lines, tool count, circular imports.
>
> Read it to understand what the codebase learned. Do not read it to find out
> what is wrong with the codebase now; for that, the gate and the guards are the
> current answer.

Run 2026-08-11 against `c696c90`. Six dimensions swept independently, each then attacked by a
skeptic instructed to refute it, then synthesised. 61,265 lines / 363 files.

Read-only: every probe was deleted and the suite is back at 362 passed / 29 files.

---


**Scope.** Six dimensions (core, storage, react, seams, ui, portability), each swept and then attacked by a skeptic whose job was to refute the sweep. I re-verified every finding placed in the top half of this report with my own probes, not the sweeps' — a throwaway `src/kg/repo/__final_audit_probe.test.ts` against `createRepository` + `createMemoryDriver` (now deleted; suite back at **362 passed / 29 files**, `git status` clean).

**Verdict up front: this codebase is in good shape.** Twelve of roughly thirty candidate findings were refuted outright, four more survived only in corrected form, and the structural checks that matter most all came back clean. Six live defects remain. None of them loses a node. Two of them can lose everything the user does after a particular moment, and those are the ones to fix.

---

## (a) Live defects with a user-visible consequence

Ranked by what it costs the user. Silent divergence between screen and disk first; visible inconveniences last.

---

### A1 — Settings → Empty (and Import) silently undoes itself when a write is in flight and failing

**`src/kg/repo/repository.ts:321`**

`replaceAll` awaits `queue.flush()` before wiping the store, and its own comment says why: *"draining them after the replace would write a deleted record back into a store that had just been emptied."* But `flush()` **settles on a failed attempt** by design (`queue.ts:237-245`, so `pagehide` can never hang). When the queue is degraded, `await queue.flush()` resolves with the stale ops still in `pending`, the replace proceeds, and the next successful retry replays them on top of the emptied store.

**Failure scenario.** A write fails (a momentary lock, an `UnknownError`, quota pressure that clears). The banner comes up saying changes could not be saved. The user does the natural thing and goes to Settings → Records → **Empty**. It reports success and the screen goes blank. Storage recovers. The backoff fires and puts a record the user just deleted back on disk, along with its journal row. Screen and disk now disagree permanently; the user finds out on the next reload. Import is the same function with the imported graph as the thing that gets partly overwritten.

**Evidence (mine).** Memory driver faulting `commit` with `storage/unavailable`, cleared *after* the Empty:

```
health after the blip : {"state":"degraded","pending":3,"unsaved":1,"attempts":1,"lastError":"blip"}
replaceAll ok         : true
rows right after Empty: {"nodes":0,"edges":0,"meta":1,"ops":0}
  ... storage recovers, backoff fires ...
rows after the retry  : {"nodes":1,"edges":0,"meta":1,"ops":1}
node ids on disk      : ["app:doomed"]        ← resurrected
snapshot on screen    : 0                     ← still empty
health at the end     : {"state":"idle"}      ← reports success
meta dataSet on disk  : "user" / seededAt set ← was "empty" / null
```

**Two corrections to the sweep, both mine, both material.**

1. **The precondition is narrower than reported.** I first ran this with storage recovering *before* the Empty and it did **not** reproduce — `flush()` drained successfully and the ops landed ahead of the replace (`afterRetry.nodes: 0`). The write must still be failing at the instant the user presses Empty. That is not a mitigation: it is precisely the state the banner puts the user in when it tells them writes are failing.
2. **The `dataSet` reversion has its own precondition, and the sweep did not state it.** With meta already at `dataSet: 'user'`, only the record comes back — meta stays `"empty"`. The meta row reverts only when the pending batch contains the demo→user flip that `repository.ts:225` appends on the first write. So the D24 flag corruption hits users still on seeded demo data. I reproduced both halves separately.

*Fix sketch:* have `flush()` report whether it drained, and make `replaceAll` fail closed (or drop `pending`) when it did not.

---

### A2 — One unreadable row on disk stops every subsequent write, forever, with no cap and no escalation

**`src/kg/repo/queue.ts:72` (`TERMINAL`) · `src/kg/storage/idb-errors.ts:61`**

`ConstraintError`, `DataError` and `DataCloneError` all map to `storage/corrupt`, and `storage/corrupt` is not in `TERMINAL` — so it is retried on a flat 4-second backoff with no attempt ceiling. A `ConstraintError` from a deterministic cause never stops being deterministic.

**Failure scenario.** One `organisation` row on disk fails `validateRows` at boot (a truncated write, a schema drift, a corrupted `props.name`). Boot reports `ready` and drops it, so it is invisible in memory. The user types that employer's name again; `application.create` calls `org.ensure` first (`application.ts:112`), `mintSlug` re-mints the same slug, and the `put` collides with the row still on disk. From that moment **nothing the user does is ever written**, and the banner says "still retrying" — which is true, and never ends. Everything is lost on reload.

**Evidence (mine).** Eleven real commits against a driver faulting `commit` with `storage/corrupt`, then 60 s of idle time:

```
health : {"state":"degraded","pending":22,"unsaved":11,"attempts":31,"lastError":"ConstraintError"}
disk   : {"nodes":0,"edges":0,"meta":0,"ops":0}
screen : 11 applications
```

31 attempts, zero rows, no escalation path. The storage sweep additionally reproduced the full chain end-to-end through the real `boot()` with a poisoned `organisation` row on disk.

**Correction carried forward:** the sweep's original trigger (an unreadable *application* row) does not collide — `buf.minted` is shared across types, so the application slug is always bumped past the org's and comes back `stripe-2`. The collision is on the **organisation** node. Same defect, different node type.

**Not caught by the toolchain.** `queue.test.ts:130` and `:209` both use `storage/corrupt` as their fault code and both flip it off mid-test, asserting recovery. Nothing anywhere asserts what a *deterministic* corrupt does.

*Fix sketch:* either classify `storage/corrupt` as terminal, or cap attempts and escalate to `off` so the banner stops promising a recovery that cannot arrive.

---

### A3 — Undoing a create from a toast leaves an orphan edge row on disk and a permanent, unclearable "a record could not be read" banner

**`src/kg/repo/journal.ts:87` · cascade at `src/kg/core/snapshot.ts:240` · `opsFor` at `src/kg/repo/repository.ts:148`**

Journal replay deletes nodes via `s.removeNode(delta.id)`, and `MutableSnapshot.removeNode` cascades `for (const edge of this.incident(id)) this.removeEdge(edge.id)`. `opsFor` derives durable ops **only** from `entry.nodes` / `entry.edges`, so edges the cascade reaches are never emitted as deletes and never re-journalled. The write path is careful about exactly this (`runtime-tx.ts:93-97` journals a displaced edge); the replay path is not.

**Failure scenario.** The user adds an application (toast: *"Rice — Statistics added"*, with Undo, live 8 s). Within that window they tag it. They press Undo. The application goes; the tag goes off screen with no undo that restores it; and the `TAGS` edge row stays on disk pointing at a node that no longer exists. On every subsequent launch — forever — `StorageBanner.tsx` says *"1 record on this device could not be read and is not being shown."* Nothing prunes the row: boot validates, reports `skipped`, and no code path deletes it. If the user presses redo, the tag silently reappears after the next reload.

**Evidence (mine).** Two commits, then a revert of the *first* (not the top of the stack):

```
before revert    : nodes 2, edges 1 on disk
snapshot has app : false     snapshot has keyword : true     edges in memory : 0
node rows on disk: ["kw:k1"]
edge rows on disk: ["kw:k1|TAGS|app:a1"]   ← dangling, never deleted
```

The core sweep additionally drove this end-to-end in a real browser and read the dangling row straight out of IndexedDB, then reloaded and captured the banner text.

**Reachability, corrected.** The sweep's stated entry point (creating a keyword from `LabelPicker`) does not exist — `useKeywords` goes through `useRun`, not `useTool`, so it raises no toast. The real doors are exactly three, all "a record was created" toasts carrying Undo: `use-application-writes.ts:147-153`, `JobScout.tsx:104-114`, `JobScout.tsx:140-150`. Eight-second window each. That is narrow, but it is a designed, documented path, and the browser drive hit it on the first attempt.

**Not a recorded decision.** D15 ("unlink, never cascade") governs deleting a record, and `tx.del` honours it by staging `dropIncident(id)` so the edges *are* journalled. D12 — a delta captured by the write cannot be forgotten — is what this violates.

*Fix sketch:* have replay collect what the cascade removed and emit deletes for it, or make replay unlink explicitly before removing the node.

---

### A4 — "Profile saved · Undo" reverts writes the user made *after* the save

**`src/lib/undo.ts:88` · `src/routes/Profile.tsx:93`**

`undoableWith`'s `restore` guards only on "is this entry still on the undo stack." It never compares the record's current image against the entry's `after`. `revert` applies `before` as a **whole record** (D12). Profile is a single node, and `useProfile().update` funnels the save-bar text, the match terms and both switches through the same `profile.set` tool — while the chips and switches commit on click, deliberately outside the save bar (`Profile.tsx:52-58`).

**Failure scenario.** User edits their profile text, presses Save. Toast: *"Profile saved · Undo"*. Within 8 s they flip the "open to academia" switch off. They press Undo. The switch is back on, and nothing tells them.

**Evidence (react sweep, real clicks + IndexedDB ground truth — the page's own `draft` state survives an undo and would have hidden this):**

```
0 START      ui academia=true    idb {fullName:"Shaswata MitraXX",   academia:true}
1 AFTER SAVE ui academia=true    idb {fullName:"Shaswata MitraXXQQ", academia:true}   toast[Undo]
2 AFTER FLIP ui academia=false   idb {fullName:"Shaswata MitraXXQQ", academia:false}
3 AFTER UNDO ui academia=true    idb {fullName:"Shaswata MitraXX",   academia:true}   ← flip gone
```

Deterministic across 4 of 5 runs; the one negative was a missed click, re-run identically and reproduced. I verified the mechanism independently by reading `undo.ts:88` and `journal.ts:80-92`.

**Scope, honestly.** This is a property of the whole `useUndoable` family, but the other three callers all have `before: null` — the revert deletes the record outright and any later edit to it is moot. Profile is the only place where one live record takes writes from two mechanisms. `undo.test.ts` has five cases and none writes to the same record twice.

*Fix sketch:* skip an entry whose `after` no longer matches the record's current image, and say so.

---

### A5 — The persistence banner undercounts what the user is about to lose

**`src/kg/repo/queue.ts:249-255`** — *merged: this surfaced independently in the storage sweep (the `off` case) and the portability sweep (the `writing`/`degraded` case). Same root cause, one finding.*

`enqueue` refreshes health **only** on the `idle → writing` transition. Once the queue is `off` it returns at line 252 before `setHealth`; once it is `writing` or `degraded` it falls through to `schedule(0)`, which returns early while a drain is in flight. Either way the counts stop moving.

**Failure scenario.** Disk is full. The queue goes `off`. The user keeps working — ten more actions. The banner still says *"1 change is on screen but not saved… reloading or closing this tab will lose it."* Ten are stranded. Nothing ever clears `off`, and `src/kg/react/status.tsx:40-44` deliberately copies health into `useState` on the notification tick rather than using `useSyncExternalStore`, so the banner cannot self-correct on an unrelated re-render either.

**Evidence (mine).** Ten commits against a driver faulting `commit` with `storage/quota`:

```
health after 10 stranded actions : {"state":"off","reason":"quota","pending":2,"unsaved":1}
notifications observed           : ["writing pending=2", "off reason=quota pending=2 unsaved=1"]
```

This contradicts the intent stated four lines above it (`queue.ts:213-220`: *"the banner's job… becomes 'here is what you will lose if you reload' — which it cannot say without knowing how much there is"*). In the `writing`/`degraded` case the staleness is bounded by one backoff (≤4 s) and self-heals; under `off`, and under A2's wedge, it is permanent.

*Fix sketch:* refresh the counts on every enqueue, not only on the transition into `writing`.

---

### A6 — "Undo" on a discarded draft does nothing if the dialog was reopened first

**`src/lib/dialogs.tsx:121-122` · `src/components/applications/ApplicationDialog.tsx:86-94`**

`DialogHost` renders `<ApplicationDialog key={`application:${props.id ?? 'new'}`} open … initial={initial} />` with `open` as a hardcoded literal `true`, and nulls `current` on close so the dialog unmounts. `ApplicationDialog`'s only re-seed path is the render-phase `open !== wasOpen` adjust — which therefore can never fire; I confirmed one mount site only. `form` and `keywords` are lazy `useState` initializers, so a changed `initial` on an already-mounted instance is dropped.

**Failure scenario.** User fills in the new-application form, presses Escape. Toast: *"Draft discarded · Undo brings the form back as you left it."* They open a blank new-application dialog, then remember the toast and press Undo (the toast stack is deliberately painted above dialogs and is clickable there). The key is identical, so React reuses the mounted instance, the new `initial` is ignored, the form stays blank, and the toast is consumed.

**Evidence (react sweep, CDP, input element ids printed to distinguish remount from prop-update):**

```
4 OPEN#2     inputs ["_r_1b_=''", …]      ← fresh mount, blank
5 AFTER UNDO inputs ["_r_1b_=''", …]      ← same ids, no remount, still blank, toast gone
CONTROL (no reopen before Undo)
             inputs ["_r_1b_='ZetaCo'", …] ← restores correctly
```

Only a draft is lost, not stored data — but a button labelled Undo consumes its toast and does nothing, and it is the app's own stated safety net for a dismissed form. Edit mode is the same code path with `key=application:<id>`; it was **not** reproduced and is asserted by construction only.

*Fix sketch:* make the key vary with the open event, or drive the dialog from an `open` prop that actually toggles.

---

### A7 — UI defects (grouped; low individually, all confirmed)

| | Defect | Evidence |
|---|---|---|
| **a** | **`src/components/ui/button.tsx:16`** — the `secondary` hover fill computes to transparent. `var(--secondary)` and `var(--foreground)` are never defined as bare custom properties (only `--color-secondary` / `--color-foreground` exist, inside `@theme inline`), so the `color-mix()` is invalid at computed-value time. | Live token dump both themes: `--secondary=""`, `--foreground=""`. Real mouse hover on the tour handoff button: `hover bg=rgba(0,0,0,0)`, nothing else in the subtree changes. Control with defined tokens resolves fine, so it is the vars, not `color-mix`. Two call sites, both `GuidedTour.tsx`. **Note:** `ring-foreground/10` elsewhere is fine — that resolves through `--color-foreground`. |
| **b** | **`src/index.css:293` vs `:289`** — `--accent` and `--text-1` are both `#fafafa` in dark, so `hover:text-accent` is a no-op. | Confirmed by grep and by whole-subtree computed-style diffs under real hover. **Narrowed to 5 components**, all in the vault and dashboard entry lists — the four vault row/card titles and the GlancePanel/OwedThisWeek entries. `cursor: pointer` is the only surviving affordance. Not the default theme (`theme.tsx:10` defaults to `system`), so it bites only users whose OS is dark. |
| **c** | **`src/components/common/ToneSwatches.tsx:42`** — five colour-pick buttons at `size-4` (16×16) with 6px gaps. Fails WCAG 2.5.8 on size and on the spacing exception (22px between centres). Smallest interactive control in the app; appears in every keyword-recolour popover on `/settings`, `/applications`, `/vault`. | Measured at 390×844 with `pointer: coarse` matched: `16x16 catch=NONE "Blue" / "Green" …`; 38 controls without a catch area on `/settings`. |
| **d** | **`src/components/common/KeywordChip.tsx:163`** — the keyword chevron measures 20×23 on a phone, and **`src/index.css:1029` names it as a `.touch-target` opt-in**. It is not one. Also `src/components/common/PageHeader.tsx:52` is a bare `PopoverTrigger` with `data-slot="popover-trigger"`, which no branch of the coarse-pointer rule reaches — 36×36 beside a 44×44. | `grep touch-target src` → exactly three call sites (`OwedThisWeek.tsx:298`, `BoardCard.tsx:76`, `ReminderRow.tsx:98`); the chevron is the missing fourth. Verified by me. |
| **e** | **`src/components/ui/popover.tsx:23`** — Radix stamps `role="dialog"`; nothing supplies an accessible name. | AX tree: `role = dialog | name = ""`. **0 of 19** `<PopoverContent>` call sites pass `aria-label`. Stock shadcn behaviour; the panel's first text node reads immediately after "dialog", so impact is narrow. |

---

## (b) Latent defects — real, but needing a trigger that does not exist today

**B1 — `src/kg/repo/queue.ts:187`: the write queue wedges silently if a `Driver` ever rejects instead of returning.** `await driver.commit(batch)` sits between `pending = []` and `draining = false` with no `try`. A rejection discards the batch, leaves `draining` stuck `true` so every later `enqueue` is dropped, freezes health at `writing` (so neither banner fires), and `flush()` never settles. Reproduced with a throwing fake driver; the control (a driver that *returns* a failure, per contract) behaves correctly.

Neither shipped driver has a reachable rejection path — I re-read both. The one demonstrated trigger (deleting `structuredClone`) is a **recorded decision** (`scripts/check-platform.mjs:129-132`), so the sweep's "live today" claim is refuted. What keeps this on the list is that **the authors already wrote a backstop for exactly this contract violation at the other seam** — `src/lib/store.tsx:230-238`: *"the driver is supposed to return a `DriverResult` rather than throw; this is the backstop for the day one of them does."* The write queue, where the failure is silent and permanent rather than a visible boot fallback, is bare. It bites the day a second driver (AsyncStorage, SQLite, OPFS) reports errors the normal way.

**B2 — `src/kg/repo/boot-live.ts:179`: on a browser without `BroadcastChannel`, every tab switch empties the undo stack, silently.** `if (rehydrated) repo.clearHistory()` runs unconditionally; `changedElsewhere`, computed one line earlier, gates only the toast. On Safari ≤15.3 or an opaque-origin frame, `visibilitychange → visible` fires constantly, so ⌘Z is effectively dead and the user is never told.

**I am downgrading this from the seams sweep's framing, on my own reading.** The comment at `boot-live.ts:152-165` states the unconditional clear outright — *"Runs the same flush → rehydrate → clear sequence a remote commit does, and unconditionally… The one thing held back is the TOAST"* — so it is a stance, not oversight from the split. And **the proposed one-word fix is unsound**: `repo.flush()` runs *before* `ours` is read, so a tab that had queued writes ends up newest and `changedElsewhere` reads `false` even when another tab did write — the exact hole the comment itself names. Gating `clearHistory` on that signal would leave an undo stack whose before-images were captured against a graph that has since moved. The defect is real; the cost/benefit is a judgement call the owner should make, not a one-liner.

**B3 — `src/kg/react/use-tool.ts:66`: `useTool` has zero call sites, and its `result.undo` is `() => void repo.revert(entry.id)` with no guard at all** — not even the "still on the undo stack" check that `undoableWith` has. The first card that adopts it inherits A4's hazard *plus* the "undoing the undo" hazard `undo.ts:60-67` was written to prevent. Dead code today.

---

## (c) Refactor damage from the parallel split

**The structural news is good, and it is the most reassuring result in this audit.** Independent checks across the split families found:

- **0 circular value imports** across all 334 non-test modules (own resolver, `@/` and relative, type-only edges excluded). This is the split failure mode that produces TDZ and `undefined`-at-module-scope, and that `tsc` cannot see.
- `GuidedTour.tsx → tour/{steps,progress,TourFooter}` verified faithful by line-multiset diff; all three self-disabling-control focus rescues survived byte-for-byte.
- The four-way vault `empty-state.tsx` split — the highest-risk copy-paste shape there is — has no string bleed: every variant names its own noun and its own searched fields.
- `MoreDetailsFields.tsx` was inlined into `ItemForm.tsx`, not lost. `FilesTool` drag-depth extraction faithful.
- No duplicated global listener registration; five orphaned optional props, all `className`.
- The two nested component declarations (`SpotlightSearch.tsx:285`, `ApplicationsTable.tsx:109`) are present verbatim at `42ff818` — pre-existing, not split damage.

**What the split did leave behind** is documentation drift, in the same family as the 63 broken comment citations the drift detector found:

1. **`src/index.css:1029`** claims the keyword chevron opts into `.touch-target`. It does not (see A7d). This is a documentation-says-done / code-says-not divergence, and it is more actionable than the coarse-pointer enumeration gap it sits next to.
2. **`src/components/ui/popover.tsx:40,50,54`** exports `PopoverHeader`, `PopoverTitle` and `PopoverDescription` — three components whose entire purpose is the accessible name A7e is missing — and **no file in `src` imports any of them**. Consistent with the wiring having been severed, though not provable from git (the split sits inside one squashed commit).
3. **`src/lib/undo.ts:44-49`** justifies `restore: null` with "the profile page's Save is always enabled." The save bar now renders only under `dirty` (`Profile.tsx:443`), so that case is unreachable from that button.
4. **`src/kg/repo/repository.ts:247`**'s `isEmpty` no-op guard is effectively dead for every patch-based tool, because `tx.patch` unconditionally stamps `updatedAt` (`runtime-tx.ts:58`).

None of 2–4 produces a wrong value today.

---

## (d) Portability claims asserted rather than demonstrated

The portability posture is genuinely strong, and it survived a second, differently-shaped attack: an AST walk finds named globals, but the actual Hermes landmines are syntax and locale hazards, and across `src/kg` + `src/data` there are **zero** regex lookbehinds, zero named capture groups, zero unicode property escapes, zero `localeCompare`/`toLocale*`/`Intl.*`, and zero ES2023 array methods. A lookbehind is a parse-time `SyntaxError` on older Hermes — it takes the whole bundle down, and no identifier walk or `tsc` lib setting would catch it. There are none.

What is asserted rather than demonstrated:

- **No shared `Driver` conformance suite exists.** Nothing anywhere asserts the contract every layer above depends on — that a `Driver` method **returns** a `DriverResult` rather than throwing. That absence is the enabling condition for B1, and it is the single largest portability gap.
- **`memory-driver.test.ts` never mentions `seedIfPristine`** (`grep -c` → 0), despite `memory-driver.ts`'s own header arguing that its presence there is what keeps the double-seed bug (R-11) visible.
- The RN `URL` polyfill and the `structuredClone` version floor are both **written down twice** (`types/portable-globals.d.ts`, `check-platform.mjs:120-132`) with the fix specified as a one-line RN entry-file import. That is a plan, not a defect — but nobody has executed it, and there is no test that would notice if the line were missing.

---

## (e) Test gaps

**E1 — the highest-value gap in the codebase.** The `opsSeq` per-tab collision bug — the one already known to have destroyed 50% of audit entries under concurrent writes — **can be reintroduced today with a fully green suite.** Restoring a per-repository counter in `repository.ts:148`'s `opsFor` so it emits `key: nextOpsKey()` instead of `key: null` passes **362/362**. The portability skeptic then demonstrated the resulting data loss: two repositories on one `fake-indexeddb` database, six commits each →

```
mutated : journal rows on disk 6/12 — ["b0","b1","b2","b3","b4","b5"]   (tab A's history gone)
restored: journal rows on disk 12/12
```

The reason is that `idb-driver.test.ts:379`'s `append()` helper hardcodes `key: null`, so the store's behaviour is proven and what `repository.ts` *passes* is never observed. I confirmed `grep -rn "opsFor" src/kg` returns two hits, both inside `repository.ts` — nothing anywhere inspects the emitted ops.

**E2** — `storage/corrupt` is only ever tested as a *transient* stand-in (`queue.test.ts:130`, `:209` both flip the fault off and assert recovery). The deterministic case — A2 — is untested by construction.

**E3** — `src/lib/data-set.test.ts:161-165` asserts A1's exact invariant, but only on the path where the flush succeeds.

**E4** — `boot.test.ts:462` ("does not announce a resume that found nothing") asserts `told === 0` and never asserts on `repo.undoable`. That is precisely B2's hole.

**E5 — structural, not fixable by adding one test.** D20 forbids jsdom and testing-library, so **no test mounts a component**. A6 is exactly the class of bug that makes invisible, as is anything involving React identity, keying, or lazy state initializers. The dialog and Profile findings both required a real browser to find. That is a deliberate trade the owner has already made; it is worth knowing what it costs.

**E6 — coverage debt without risk.** 28 of 62 tools have no test. The portability skeptic ran all 28 against a real repository and runtime, asserting each does not throw, actually changes the graph, undoes byte-identically, and redoes: **zero failures**. The gap is real; there is no defect behind it, and it should not be treated as one.

---

## Refuted — where the code merely looks wrong

**Twelve candidates were refuted outright**; four more survived only in corrected form (the corrections are folded into A2, A3, A7 and B2 above). The refuted set: `--radius` breaking `input-group`; three separate "no visible hover" sites (BoardCard, DayRail, GuideNav card and pager); "dark is the app's default"; the `aria-sort="ascending"` lie; the nested component declarations; `draftFromUrl`'s `URL` dependency; "`onResume` is silently ignored"; "28 untested tools" as a defect; `structuredClone` as a live web bug; the undefined `no-scrollbar` class; and "the largest icon button has the smallest tap area."

**The two most instructive:**

1. **The dark-theme hover sites.** Three of four reported-dead sites are alive, and the reason is methodological: the sweep measured the hovered element's own `color`, but the affordance lives on a *sibling* — BoardCard's drag grip goes `opacity 0.4 → 1`, DayRail's control goes `0 → 1`, GuideNav's parent `<Link>` moves its border `rgb(51,51,51) → rgb(74,74,74)`. Only a whole-subtree computed-style diff separated the real dead sites from the rest, and it cut the finding from 9 components to 5. Any future CSS audit here needs to diff the subtree, not the node.
2. **`draftFromUrl` and `structuredClone`.** Both read as unowned portability holes, and both are written down — in `types/portable-globals.d.ts` and in `check-platform.mjs`'s "deliberately absent from the ban list, each considered rather than forgotten" block, with the fix specified. This codebase records its reasoning in unusual detail, and reading the guard scripts' comments before filing a portability finding would have saved two false positives. The corollary is worth stating: several *confirmed* findings above (A5, A3) are defects precisely because they contradict a comment sitting a few lines away. The comments are load-bearing evidence in both directions.

---

## What was not reached

This audit's limits, stated plainly.

- **Nobody drove `mobile/`.** It shares no code with `src/kg`, so it was out of scope by the brief — but that also means zero evidence about it, including whether the RN `URL` polyfill or the Hermes floor hold in practice.
- **No sweep drove two real tabs against one real IndexedDB in a browser.** Every multi-tab claim — D23, the `opsSeq` loss, the resume path — rests on `fake-indexeddb` or on stubbing `BroadcastChannel`. The one bug already known to have destroyed data in this codebase was a multi-tab bug, and multi-tab remains the least directly-exercised surface.
- **All storage failures were injected at the driver seam.** No sweep produced a real `ConstraintError`, real quota exhaustion, or a real `VersionError` from real IndexedDB. A2 and A5 are proven against the *contract*; whether real Chrome/Safari produce those codes in those situations is untested.
- **Import was reasoned about, not reproduced.** A1 was driven through Settings → Empty only. Import shares the function; the claim that it fails identically is by construction.
- **The edit-mode variant of A6 was not reproduced** — only the create variant. Same code path, asserted not demonstrated.
- **Three routes were barely driven**: Assistant, Transfer, Guide. The UI sweep visited them; nothing exercised their state transitions.
- **No performance or scale work.** Every probe ran against roughly ten nodes. Nothing was measured at 1,000 applications, and the incremental-index claims (D-R10) were read, not benchmarked.
- **No accessibility pass beyond the popover naming** — no screen-reader run, no keyboard-only traversal of the thirteen routes, no focus-trap audit.
- **No security or privacy sweep at all.** Export/import content, `dangerouslySetInnerHTML`, the rich-text editor's sanitisation: unexamined.
- **The 63 broken comment citations were counted by the drift detector; nobody re-checked the detector.** Its own count is taken on trust here.
- **Nobody read the 362 tests looking for tests that assert the wrong thing.** E1 is one such case found by accident, not by search. There may be more.

---

## Bottom line

**This codebase is in good shape, and I would say so without qualification.** Six adversarial sweeps produced six live defects, none of which loses a record; twelve candidates were refuted; the parallel split of 26 files came back structurally clean, including zero import cycles and no string bleed in the highest-risk four-way split. The architecture's discipline is real and it works: the layer guards hold, the platform guard's exclusions are reasoned in writing, and the code comments are accurate often enough that a comment contradicting its own code is a reliable bug smell. The defects that survived are concentrated in exactly one place — the seam where a synchronous in-memory truth meets an asynchronous disk that can fail — which is the hardest part of the design and the part where the previous audit also found its bugs.

**Three things first:**

1. **Make `storage/corrupt` stop retrying forever (A2).** It is the only failure in the system that can silently discard everything the user does from a given moment onward, with a banner that promises a recovery that will never come. One line in `TERMINAL`, or an attempt cap that escalates to `off`.
2. **Make `replaceAll` refuse to proceed when the flush did not actually drain (A1).** Right now Empty and Import report success while a stale batch is still queued to land on top of them. `flush()` correctly settles on failure for `pagehide`'s sake; `replaceAll` needs to know the difference.
3. **Write the `opsFor` key test (E1).** The one bug in this codebase's history that is *known* to have destroyed user data can be reintroduced today against a green 362-test suite. A single assertion that the ops emitted for a commit carry `key: null` closes it, and it is the cheapest item on this list.

A3 (the orphan edge and its permanent false banner) is the next one after those, and it is the one most likely to generate a support question, because the lie it tells is repeated on every single launch.