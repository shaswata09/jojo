# jojo — mock finalisation plan

## Ranking principle
Ordered by *what a job-seeker feels in the first 60 seconds*: land on `/`, read it, add one thing, move one thing. Craft findings that survive only under a pixel-ruler are pushed to Wave 3 or cut.

**The five things that break the first minute, in order**
1. The landing screen has no title, no promise, no day's work above the fold, and its biggest chart is fiction.
2. Numbers on adjacent panels disagree about the user's own records (13 vs 12 vs 37).
3. Selected/hover/drop states paint nothing — `--accent-soft` is byte-identical to `--well` in both themes, so eight interaction states across the app are invisible.
4. The canonical journey ("remind me to chase them") files the reminder as `admin` and it never reaches the panel built for it.
5. Wayfinding: four destinations exist only as unlabelled 32px glyphs, the sidebar ends in three words that read as an outage, and ⌘K returns all 12 applications for the query "rice".

---

## Cross-cutting laws
State once; every package obeys. Most of the 90 findings collapse into these.

| Law | Rule |
|---|---|
| **Colour** | red = past due, only. amber = due inside 48h, only. Never green for a countdown. Stage is the only chip carrying a status dot. User keywords are the only coloured pills; role/source/countdown/fit-score/category are plain neutral squares. |
| **Date** | `shortDate` ("Nov 15") is the default. Relative only when the gap *is* the point, and then exactly one vocabulary: `Today / Tomorrow / in N days / N days ago / N days overdue`. Ban `2d ago`, `24d left`, `3 weeks ago`, `days to decide`, `savedAgo` frozen strings. |
| **Toast** | title = `<record name> <past-tense verb>`; description = the consequence you can't see. Every write carries `action: Undo`. One verb per outcome — "deleted", never "removed". |
| **Delete** | Undo everywhere; a confirm dialog *only* where undo is impossible (Settings → clear everything). Delete always lives in the ⋯ menu, never as a naked one-click trash. |
| **Empty** | Never render invented data beside a real zero. At zero rows: one EmptyState *with an action*, and hide the filters/legends/segments that filter nothing. |
| **Title** | One `<h1>` per route, at one x-origin, plus `useTitle('<specific> · jojo')`. |

---

# WAVE 1 — foundation (land first; other packages rebase on it)

### P1 · Colour & token law
**Owns** `src/index.css`, `src/components/common/Chip.tsx`, `src/components/applications/StageMenu.tsx` (`STAGE_TONE`)
- Give the accent pair real values instead of aliases. Light `--accent-soft: #ebebeb`, `--accent-border: #a3a3a3`; dark `--accent-soft: #303030`, `--accent-border: #5a5a5a`. This one edit repairs the board drop target, the "today" tile in This week, the `?focus=` deep-link highlight, the reminder checkbox checked state, the role-filter selection, the StageMenu open state and the PageHeader options button — all currently no-ops. Delete the apologetic comments at `Calendar.tsx:324` and `Segment.tsx:88`.
- Darken `--text-3` to ~`#6b6b6b` (currently 4.35:1 on the `#f5f5f5` well — its own comment admits it). Bump the dashed "Add here" stroke to ~`#a3a3a3`.
- Dark mode depth: card must sit *above* its track in both themes. Set dark `--panel: #1f1f1f` / `--well: #171717` / `--page: #0a0a0a`. Verify by sampling two pixels: panel on the same side of well in both themes.
- Delete `STAGE_TONE`. Add a `stage` variant to `Chip` reading the existing six `--stage-*` tokens, so the table chip, the detail header control and RecentApplications use the same hues as the board dots. Stage chip gains the leading dot; nothing else gets one.
- Size-bound tracking: `-0.02em` at 2xl, `-0.01em` at xl, `0` at base/sm, `+0.01em` at xs — replace the blanket rule. Move `PanelTitle` to the `--text-lg` (16px/600) token it already documents.
- Extend the existing `@media (prefers-reduced-transparency: reduce)` block to `backdrop-filter: none` + a solid scrim.

**Outcome** Selected, hovered and drop states become visible for the first time; stage colour stops changing when you toggle Board/Table; dark mode cards stop looking like holes.

### P2 · Dialog & feedback contract
**Owns** `src/components/ui/dialog.tsx`, `src/components/ui/command.tsx`, `src/components/ui/toast.tsx`, `src/components/common/ConfirmDialog.tsx`, `src/components/common/Field.tsx`
- **Bug, ship first:** `ConfirmDialog` never unmounts — after Cancel/Escape/Delete the app shell keeps `aria-hidden="true"` and focusable elements drop 107 → 2 permanently. Drop the `onOpenAutoFocus` preventDefault + manual `cancelRef.focus()` pair and restore `showCloseButton` to the shared default. Acceptance test: after every close path, `document.querySelectorAll('[role=dialog]').length === 0` and no `aria-hidden` on the shell.
- Move `CommandDialog`'s sr-only `DialogHeader` *inside* `DialogContent` — a phantom `<h2>Search</h2>` currently opens the heading outline of every route.
- `DialogContent`: add `grid-cols-[minmax(0,1fr)]`; fixes the New-application dialog computing a 446px child inside a 358px frame at 390px (both footer buttons off-screen). Add `overflow-x-hidden` to scroll regions.
- Overlay origin + duration: 100ms centre-origin zoom → 260ms `cubic-bezier(0.32,0.72,0,1)` from `scale(0.92)`, with `transformOrigin` set from the trigger rect passed through `dialogs-context`. Backdrop fade stays ~150ms.
- `Field` gains an `announce` prop (`role="alert"`) so post-submit errors are spoken.
- Toast: when a toast carries an action, move focus to it on arrival (the item already pauses its timer on focus), so Undo is not the last tab stop in the document.

**Outcome** Dialogs open from the control that summoned them, close cleanly, and never strand a keyboard or screen-reader user.

---

# WAVE 2 — the journeys (file-disjoint, parallelisable)

### P3 · Dashboard: make it today's screen
**Owns** `src/routes/Dashboard.tsx`, `components/dashboard/{PriorityActions,ThisWeek,FollowUpTimeline,GlancePanel,RecentApplications,QuickAdd}.tsx`, `src/lib/priority.ts`, **deletes** `components/common/Carousel.tsx`
- Add the missing `PageHeader`: h1 **Today**, subtitle `Monday 12 October · 12 applications, all on this machine.` (from the store, so at zero it reads `Nothing tracked yet — everything you add stays on this machine.`). This is the only guaranteed home for the product promise, which today appears on three pages a new user never reaches.
- **Delete the chart row** (`ApplicationFrequency` + `ApplicationSources`) from the dashboard. Both already render identically on `/statistics`. This alone lifts *This week* and *Follow-ups due* from y≈880 to y≈520 — above the fold — which resolves "nothing on the first screen can complete anything" as a side effect.
- **Kill the carousel.** `Carousel` has exactly one consumer. Replace with a titled panel: `PanelTitle "Needs a decision"` hint `4 today`, card 1 at full size, cards 2–4 as single-line rows carrying the same Done/Snooze. Deletes three findings at once (no visible heading, off-screen slides tabbable, live region announcing 400 words on every tick).
- Remove the follow-ups summary card from `priority.ts` — the same three items are already claimed four times on one screen (sidebar badge, glance counter, deck card, panel). The deck keeps only things with no panel of their own: the offer, the red deadline, the next interview.
- Invert the hero card: headline **"Reply to Baylor"** at 20/600; one line of context; `Respond by Nov 15 · 34 days` once, neutral 11px (currently stated twice in two units, with the least urgent number rendered 28px green); "Draft a reply" promoted to the primary button. Delete the duplicate role pill.
- Merge *This week* and *Follow-ups due* into one panel: **"Owed this week"**, hint `3 overdue · 6 due`, with sticky **Overdue / Today / Tomorrow / Rest of week** groups. Render the Today group even when empty, carrying a completion state (`Today is clear — 4 done`). Fix `1 items` → `1 item`; a day that had items and now has none reads `all done`, not `nothing scheduled`.
- Colour the rail dot and the row icon from the *date*, not the stored `urgency` field — today a row says "3 days overdue" in red beside an amber dot.
- `+7 more` and `+8 more later this month` are `<li><span>` — make them real links.
- Glance: four counters become links (`Active → applicationsPath({stage:'active'})` etc.); swap the least useful for **Done today**; rename `Follow-ups due` → `Overdue`; `Interviews` counts `screen + interview` — rename to `Screens & interviews`.
- Remove `QuickAdd` from the dashboard (a third path to a create flow already on the topbar and ⌘K, occupying the most valuable band and opening with a disabled button). If kept, it must never disable its primary — an empty field opens the blank dialog.
- Empty store: the top panel becomes the Guide's Getting-started checklist, and the priority EmptyState gets an action (`Add your first application`).

**Outcome** The first screen names the day, states the promise, and puts everything you owe — overdue included — above the fold with a way to tick it off.

### P4 · Statistics & charts: stop inventing data
**Owns** `src/routes/Statistics.tsx`, `src/data/statistics.ts`, `components/dashboard/{ApplicationFrequency,ApplicationSources,SearchHealth}.tsx`, `components/charts/Radar.tsx`
- **Scale the sample to the store.** Keep the sample *rates*, derive `applied` from `useApplications().all.length`, so a 12-record store reads "5 of 12 replied" instead of contradicting every other surface with 37. At zero records, replace the page body with one EmptyState.
- Retire the full-width amber banner; put a small `Sample` chip on the four illustrative panels (KPIs, funnel, outcomes, track table) and leave the real one unchipped. The caveat sits on the thing it qualifies instead of shouting from the top in the app's "act soon" colour.
- `ApplicationFrequency` never calls `useApplications` — derive the series from the store bucketed by applied-week, and drop the legend + period/shape segments at zero.
- `ApplicationSources` silently discards records with `source: 'none'` — after adding one application the dashboard reads 13 while this reads 12. Add a `Not recorded` slice so the total always reconciles.
- Un-grade the user: `Search health / you vs a healthy search` → **What to work on next / compared with a typical search**; drop the red `-46` gap chips; `Where to put your effort` → `Suggestions, most useful first`; `Conversion funnel` → `How far applications got`; `1 of 37 converted` → `1 of 12 reached an offer`; `Track comparison / academia vs industry` → `Academic vs industry roles`.
- KPI arrow reports judgement, not sign (point it down when `good` is false); say `+3d slower` in words; use `text-danger` not `text-warning` so amber keeps its one job.
- Radar: labels ring at 128% of R overflows a 240 viewBox — "Interview prep" renders as "erview prep". Widen the viewBox to `0 0 340 240` with `CX=170`.

**Outcome** Every number on the page is about the user's own search, and the page stops apologising for itself in the loudest position.

### P5 · Applications list & board
**Owns** `src/routes/Applications.tsx`, `src/data/seed.ts` (chips field)
- Board affordances: grip `opacity-0` → `opacity-40 group-hover:opacity-100`; drop target `isOver ? 'border-accent bg-panel'` (mirror `Calendar.tsx:329`) + a dashed insertion slot animating 0→122px; `DragOverlay` gets a real lift (`.surface` currently overrides `shadow-[var(--shadow-raised)]`) and `scale(1.03)`; `dropAnimation={null}` so the ghost stops hovering misaligned over the real card for 180ms.
- **Route the drop through the same code as the stage menu**: `onDragEnd` currently writes bare — no toast, no undo, and it skips the transition form the same move demands on the detail page. Add Undo carrying the previous stage; a mis-drop is the likeliest slip on this screen and is currently unrecoverable.
- Put `StageMenu` on the board card as a visible stage pill. That gives touch *and* keyboard a stage path (today: 20 arrow presses to move two columns), and lets the two-line mouse-and-keyboard instruction paragraph be deleted.
- Card typography: title 14/600 pulled to the card's own padding edge (float the grip absolutely); chips to weight 400; one coloured chip per card.
- **Delete the `a.chips` field from `seed.ts`.** Its only real signal ("something is due") is already in the subline and the flag. It is what makes the Baylor detail header say "Offer" twice and the Rice card say "Deadline Nov 1" and "24d left" in the same 122px.
- Move search + label filter above the view toggle (they belong to the page, not the table); Board currently silently drops every filter the Table has.
- Move `RoleFilter` out of the topbar into this page header — it is pinned globally but changes 2 of ~12 surfaces, so every dashboard number is ambiguous. `Clear filters` must clear it too, rename to `Show all 12`, and name it in `emptyReason` (today: "Nothing carries the Offer stage" while 10 records are hidden by a filter the button can't reach).
- BucketFilter counts ignore the other active filters — `All 8` sits above 4 rows. Count the post-keyword/search pool.
- Table: compact rows by default; Role 130 / Stage 110, recovered width to Position; adds a `Next date` column; all 12 rows fit. `aria-sort` moves from the button to the `<th>`.
- Swap the four `useState`s for the already-written-and-unused `useApplicationsParams()` so view/search/stage/sort are shareable and Back-able like Vault and Calendar.
- Mark the open record in the list (`aria-current` + inset accent rail) and scroll it into view.

**Outcome** The board's core gesture is visible, reversible and reachable by finger and keyboard, and the table finally shows the whole search.

### P6 · Application detail & stage transitions
**Owns** `src/routes/ApplicationDetail.tsx`, `components/applications/{StageTransitionDialog,OfferBlock,ApplicationDialog}.tsx`
- **"Skip for now" commits the stage change.** Three buttons: `Cancel` (real `DialogClose`, no write) · `Move without details` · `Move to {Stage}`. Today the only honest exit is an unlabelled X.
- Wrap `TransitionForm` in a `<form>` — it is the one dialog in the app where Enter does nothing, on one-field forms where Enter is the gesture.
- The stage move rewrites five fields and can wipe a typed offer with no undo, while *deleting* an application gets both a confirm and an Undo. Snapshot before `update`, add Undo, and make the description name what changed ("Offer details cleared" / "Respond by Oct 26 added to your calendar").
- **Keep `StageTransitionDialog`'s shape and copy exactly as they are** — walked end-to-end it is the best-designed mutation in the app.
- Pane order → Details, **Upcoming**, Note. The record's dates and its only Add button currently sit 79px below the fold, under an empty rich-text editor and its eight-button toolbar. Note auto-sizes with a ~120px min and reveals its toolbar on focus.
- Add an `X` close in the header cluster and wire Escape; `← Applications` stays only below `lg`. Below `lg`, replace the list's page header (h1 "Applications", 12 shown, Table/Board segment, URL paster, New) with a 48px back row + the record as the page h1.
- `Compensation —` shows blank beside an offer stating `$112k + $15k startup` — fall through to `a.offer?.comp` or drop the row on offer-stage records. Delete the duplicate `offer` text chip. `Upcoming` renders overdue and completed items → rename `Dates and reminders`.
- Add **Draft a message** to the record (primary action on interview/follow-up rows + header ⋯). Today the only route to a filled thank-you is: create a reminder → go to Vault → find the row → press its "Draft" text button.
- `ApplicationDialog`: placeholders currently reproduce the Rice record verbatim, so the create form reads as a pre-filled duplicate — swap to `Employer or institution`, `e.g. Senior data analyst`, `City, or Remote`, `https://…`. Stage/Source segment tracks get `w-full` + equal-width options (they stop 55px and 58px short of every other field's right edge, 3px apart from each other). Escape on a dirty form closes as now, then fires a `Draft discarded — Undo` toast (no second modal).
- `Decline` → `Decline offer`, `variant="outline"` — declining a job is a decision, not a deletion.

**Outcome** No stage move can quietly destroy data or commit behind a button labelled "skip", and the record's dates are the first thing you see.

### P7 · Vault & the reminder dialog
**Owns** `components/timeline/TimelineItemDialog.tsx`, `components/vault/{RemindersTool,LinksTool,FilesTool,SnippetsTool}.tsx`, `src/routes/Vault.tsx`, `src/data/timeline.ts`
- **The headline fix:** `kind` defaults to `'admin'` for every mode, and `followUpsOf` keeps only `kind === 'follow-up'` — so "Chase Cornell about my statements" never appears in *Follow-ups due*. Default from context: `initial?.kind ?? (mode === 'reminder' ? 'follow-up' : 'interview')`, and from the related application's stage when one is picked. Change the hint to state the consequence: "Follow-ups also show in Follow-ups due on the dashboard."
- Render Kind as a 4×2 icon+label grid (today seven pills wrap, stranding "Follow-up" alone in a grey box) and drop its bogus `required` marker.
- Fold scope, corrected by measurement: at 1440×900 only **Note, "Show in reminders" and Keywords** are below the fold — not everything from Urgency down. Hoist the "Show in reminders" switch up beside Title (it decides what the record *is*, and the dialog's own description points at it), collapse Note + Keywords behind one "More details" summary, leave the rest in the open form.
- Quick date chips signal selection by *removing* the border on identical grey — give the pressed chip `bg-accent-soft text-accent ring-1 ring-accent-border` (real values now exist after P1).
- Keywords write straight to the store on click, so Cancel keeps the tags and discards the title. Extract `ApplicationDialog`'s staged `KeywordPicker` to `components/common/` and use it in both.
- `followUpsOf` has no date test — a follow-up dated next month counts as "due" in red.
- One toolbar shape across all four tabs: `[BucketFilter] … [search] [Add]`. Give Reminders a BucketFilter (it already computes the counts) and drop the prose count sentence + Segment; collapse LinksTool's always-open inline form into an Add button. Add search to all four.
- Reminder row: move the conditional `Draft` button *before* the date block so ⋯ stops jumping 56px sideways between rows; rename it `Draft a reply`; two-line row at ~56px so all 8 fit; one panel with sticky group headers instead of three panels costing ~193px in boundaries.
- One ⋯ contract everywhere: `size-7 rounded-md border-transparent`, order `Edit · Duplicate · [move section] · Delete (last, red)`. Links, Snippets, Calendar rows and Scout pipelines get one instead of naked icons (Snippets currently has no delete at all). Drop the ConfirmDialog from files and snippets — both restore perfectly.
- Titles: `FilesTool:549`, `SnippetsTool:417` are inert `<div>`s that look identical to the clickable reminder title. Make them buttons opening the same editor. On a link, the title opens the editor and the *host line* leaves the app.
- Hide the label-filter row and bucket segment when the active tab has zero items.
- Vault subtitle mixes one open count with three totals within 100px of a segment saying "8 open · 2 completed".
- Ticked/snoozed rows unmount in the same commit as the click — hold 400ms with the checkbox painted and the title struck, then collapse over 220ms with the rows below FLIPped.

**Outcome** The reminder you actually write lands where the app promises, and the four Vault tabs stop rebuilding their toolbar under you.

### P8 · Calendar
**Owns** `src/routes/Calendar.tsx`
- Rebalance to `1fr / 320px` (currently 694/434 with the rail two-thirds empty) — day cells go ~94px → ~135px, roughly doubling readable title length. Drop the time prefix from the chip; truncate at word boundaries; prefer `+2 more` over three unreadable stubs. **Owner check: this is a density change to the compact day cells.**
- The legend keys seven kind-icons that are never drawn; the grid's actual marks (red / amber fill / dot / strikethrough) are unexplained. Replace with two swatches: *overdue*, *due soon* — and give red the filled background too, so the more urgent item is never the lighter one.
- Render leading/trailing blanks as real cells; today's grid is missing its top-left and bottom-right corners and MON/TUE/WED head empty space.
- Day-number button needs `shrink-0` — at 390px it collapses to an 11px oval with the digits of "12" spilling out both sides.
- Replace the unlabelled 6px "go to current month" dot with a text **Today** button, recessed when already there; add `Back to October 2026` inside the empty-month panel.
- Take the 31 `opacity-0` add buttons out of the tab order; make the day "+" permanently visible under `@media (hover: hover)` inversion (on touch it is unreachable entirely).
- Below `lg`, the helper copy names a pointer, a keyboard and a side-by-side layout the reader has none of → "Tap a day to see what is on it."
- `dropAnimation` gated on `prefers-reduced-motion` (the CSS `*` reset cannot touch WAAPI).

**Outcome** You can read what is on the calendar, and the key under it explains the marks that are actually there.

### P9 · Shell, wayfinding & search
**Owns** `components/layout/{Sidebar,Topbar,AppShell,SpotlightSearch,NewMenu}.tsx`, `src/lib/links.ts` (`useTitle`)
- **⌘K returns everything.** cmdk's default fuzzy scorer matches `r…i…c…e` inside "Databri**c**ks — ML engin**e**er", so typing "rice" lists all nine applications. Pass a substring filter; add a "3 matches" count line; set `aria-activedescendant` on the pre-selected row; give the input a real label. *Then* add Links/Files/Snippets/Postings sections and rewrite the empty state to name the corpus — widening a search that doesn't narrow makes it worse, so order matters.
- `?focus=` deep links land on rows the Vault's default `Open` filter hides. Derive the initial filter from the focus target and say so once.
- Sidebar: cap the mascot card at ~120–140px and spend it plus the 221px dead column on a second nav group behind a hairline — **How to use · My profile · Assistant · Settings**, currently four unlabelled topbar glyphs. Badge grammar unified to number + state word: `2 flagged · 6 this week · 3 overdue · 3 new`.
- Runtime strip: three permanent tiles reading `in memory / not connected / offline` are the only thing on `/` gesturing at local-first, and they read as three broken services. Replace with one line — shield glyph, `Private · nothing leaves this device`, success tone — plus `2 optional add-ons →` into Settings. `grid-cols-3` + `place-content-center` if the tiles survive at all.
- Replace the Assistant's full-colour 16px mascot glyph with a Lucide outline at the same weight — in dark it is the brightest object in the topbar.
- Skip link as first child of `AppShell`; `<main id="main" tabIndex={-1}>` focused on pathname change (18 chrome stops before content today, and dialog close drops focus to `<body>`). Remember the opening element in `dialogs-context` and fall back to the persistent New button.
- `useTitle` per route: `Rice — Statistics · jojo`, `Calendar — October 2026 · jojo`.
- PageHeader always reserves the 36px options gutter so the h1 stops sliding 46px sideways between routes.
- Below `lg`, topbar keeps only menu · search · New on one 56px row; the four account/support icons move into the drawer as labelled rows. Below `sm`, the New menu drops its CommandInput (it raises the keyboard over the six options it filters).
- Delete `not-aria-[haspopup]` from `button.tsx:8` and add a shared `.pressable` (`scale(0.98)` / `translateY(1px)` at 120ms) applied to nav links, Segment options, board cards, table rows, chips and the reminder checkbox. Four `:active` rules ship in the whole app today.

**Outcome** Every destination has a name, search narrows, and pressing things feels like pressing things.

### P10 · Copy & settings pass
**Owns** `src/routes/{Settings,JobScout,Assistant,Guide,Profile}.tsx`, `components/draft/DraftDialog.tsx`
- Settings order: **Your data** (export, Demo/Empty switch, reset, storage notice as a plain statement) → Appearance → Keywords → `Connections — optional` last, with the lede "jojo works fully without either of these." Today the page opens on two disconnected developer services and the data controls are 1200px down.
- `autoSync` and `snapshots` initialise `true` in a panel whose own copy says nothing connects — in a local-first app that is the most consequential thing a user could be wrong about. Default all three `false`. Rename for outcomes: *Save to a file on this computer* / *Save as I work* / *Keep a copy of what I sent*; Endpoint → Address; Pairing token → Pairing code.
- Scout: subtitle asserts crawling above a banner saying nothing runs; the switch produces "paused" or "off" and never "on". → subtitle "Saved searches that will watch job boards for you — and a place to park postings today"; chip `on · waiting for a model` / `off`; `Save page` → `Save posting`; delete the five permanently-dead `Open snapshot` buttons; fix the fit-score column jumping 94px and make `Add to applications` an actual button.
- Assistant: `Runs on your machine` sits above a banner withdrawing it → "Worked examples now. Connect a local model and it drafts from your own records." `What it will do` → `Try one of these` (the buttons work now).
- Internal vocabulary out of user copy: "the offer block there takes both answers", "this deck", "seeded data", "this build", "Show KPI deltas", Vault tab `Tools` (rename `Calculator`; every tab is a tool).
- Generic verbs → outcomes: `Save`→`Save profile`, `Discard`→`Discard changes`, `Delete`→`Delete reminder`, `Add`→`Add a date`, `From link`→`Add from link`.
- Guide: fix `1 of 6` over seven steps; surface it from the sidebar (P9) and as the empty dashboard's top panel (P3).
- DraftDialog: add a **Related application** picker at the top so the dialog can fix the deficiency it announces ("Not linked to an application, so [ROLE] and [DATE] stay blank"). Make **Copy** the primary; drop `Mark sent` and `Open in assistant` when they can never enable — today all four footer buttons open disabled.
- Move disabled-button explanations out of `title=` into visible text (on touch there is no hover, so five buttons just look broken).

**Outcome** The app stops contradicting itself in prose and stops shipping switches that are on for nothing.

---

# WAVE 3 — after the above ships
- **Touch tier** (`index.css` + shared icon-button class + `input.tsx` + Segment): under `@media (pointer: coarse)`, icon buttons to 44px, inputs `h-11`, menu rows 44px, `gap-1` clusters → `gap-2`, carousel-style pips get a 44px tap box. There is currently no coarse-pointer or hover-capability rule anywhere in `src/`.
- **Motion polish**: detail-pane slide-in with the board width transitioning in the same beat; `?focus=` arrival highlight that decays and clears the param; FLIP on board columns; a `useReducedMotion()` hook gating both `DragOverlay`s.
- **Date system migration**: add `agoLabel()` beside `whenLabel`, route the five call sites, replace frozen `savedAgo` / `saved` strings in `data/vault.ts` and `data/scout.ts` with ISO fields.

---

# Do NOT do
| Finding | Why not |
|---|---|
| Thread the role filter through six dashboard panels | Relocating it to `/applications` (P5) removes the false promise for a fraction of the work. Making it truly global multiplies every count's ambiguity instead of removing it. |
| Redirect `/` → `/guide` on an empty store | Hijacking the home route is a bigger commitment than the problem. The empty-dashboard checklist (P3) + a labelled sidebar row (P9) get the same result reversibly. |
| ARIA `role="grid"` + roving tabindex for the calendar month | Large, and the calendar is not where a job-seeker starts. Do the two cheap halves now (hidden add buttons out of the tab order, `shrink-0` on the day button); defer the grid pattern. |
| Bottom-sheet dialog system + one-stage-at-a-time mobile board | Out of scope for a desktop-first mock. Ship the one-line `grid-cols-[minmax(0,1fr)]` overflow fix (P2) and the coarse-pointer tier (Wave 3); leave the rest. |
| Global ⌘Z undo stack | Undo-in-toast plus focus-on-arrival (P2) covers the real slips. An undo stack is app architecture, not mock design. |
| `@media (prefers-contrast: more)` block | Darkening `--text-3` and the dashed stroke in P1 fixes the actual contrast failures for *everyone*, not just the small cohort that sets the preference. |
| Rebuild / replace the RichTextEditor | Reordering the pane and collapsing the toolbar to focus (P6) is the whole win. |
| Rewrite dates buried in seed prose notes ("Onsite Oct 30") | Diminishing returns; the visible date fields are what matter. |
| Landing-screen h1 as `Monday, 12 October` | The seed's `TODAY` is a constant, not the wall clock — a bare date as the page title reads as a bug when it disagrees with the OS. Put the date in the subtitle. |

---

# Owner decisions needed — these touch deliberate choices

1. **Board stays the default** — respected everywhere in this plan. But at `lg+` with a record open the board is squeezed to ~653px and shows 2.5 of 6 stages. **Recommend:** temporarily swap the left column to the table while a detail pane is open and restore the board on close. *Alternative:* render the detail as an overlaying right-hand sheet so the board keeps its width (this also gives Escape and backdrop-click their conventional meaning). Which?
2. **Spline mascot stays** — no package removes it. But it is 202×202 with 221px of dead column beneath, while four destinations have no room to be labelled. **Recommend:** keep the Spline scene, cap the card at ~120–140px, spend the reclaimed ~300px on the second nav group. Confirm the cap. Related: the fallback `RobotMascot` prints its own orange chest chevron directly under the "jojo" wordmark — fix by passing a `bare` prop to the fallback only (P9), leaving the Spline scene untouched. Also confirm whether the theme toggle may leave the brand card (recommended: leave it where it is).
3. **Calendar's compact day cells** — P8's width rebalance (1fr/320px) does not change cell height, but "prefer `+2 more` over three truncated stubs" does reduce events shown per day. Confirm.
4. **Keyword chips on records stay** — explicitly preserved. P5 deletes only the hand-authored `a.chips` field in `seed.ts` (`offer`, `prep due`, `24d left`, …), which is a *different* system that currently wears the same clothes and is the reason Baylor's header says "Offer" twice. Confirm the seed-data deletion.
5. **Glassmorphic scrollbars stay** — the `prefers-reduced-transparency` extension in P1 adds `backdrop-filter: none` to overlays and the mobile scrim, and leaves the scrollbar tokens exactly as they are. Confirm that reading.
6. **`Carousel.tsx` is deleted** (P3) — one consumer, and a carousel is the wrong shape for a priority queue. If the component is wanted for a future surface, say so and it stays in the tree unused.
7. **Stage rename `Screen` → `Screening call`** (P10 copy law) touches `STAGES` in `seed.ts` and therefore every stage label in the app. High clarity value, wide blast radius. Confirm.