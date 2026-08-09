All paths below are relative to `/Users/shaswatamitra/Desktop/Files/Work/Projects/github/jojo/web`.

# jojo — build plan to a complete interactive prototype

## 0. Decisions that close the contradictions

| # | Conflict in the findings | Decision | Why |
|---|---|---|---|
| D1 | Detail surface: nested route vs Sheet vs `?focus=` / `?open=` | **Nested route `/applications/:id`**, rendered by the list route via `<Outlet/>` into a right-hand column at `lg`, full-width page below `lg`. One helper `appPath(id)`. | There is no `sheet.tsx` in `src/components/ui/` (verified), so the Sheet option is unbuildable without a new primitive. A nested route keeps the list mounted so its own `?view=/?stage=/?q=` survive opening a record, gives Back/bookmarks for free, and gives the nine referring surfaces one address. `?focus=`/`?open=` are dropped outright — never ship an interim address you have to un-ship. |
| D2 | Six URL-param vocabularies | **One contract in `src/lib/links.ts`**, written before any link is emitted. Canonical names: `view`, `stage`, `q`, `sort`, `role`, `tool`, `filter`, `focus`, `y`, `m`, `d`, `new`. | Nothing reads params today (`useSearchParams` has zero hits), so all of it is greenfield; the only risk is authors disagreeing. Builders + matching `useXParams()` readers make that impossible. |
| D3 | Global id collisions (`stripe` is 6 records) vs prefixed label keys | **Record ids stay bare slugs inside their own collection.** Cross-entity references are typed and named after their target (`applicationId: AppId`), so they are never ambiguous. Only genuinely type-blind maps get namespaced: the label store keys on `refKey(kind, id)` → `'app:stripe'`. Add `src/data/ids.ts` with `refKey`, `parseRef`, `uniqueId(base, taken)`, and a dev-only duplicate assertion per collection. | Full `kind:slug` id rewrite touches five seed files, every consumer and every route param for no user-visible gain. The only real bug is the flat `byRecord` map in `src/lib/labels.tsx:19`, which `refKey` fixes exactly. `uniqueId` prevents scout-promoting match `unt` from clobbering application `unt`. |
| D4 | Five reshapes of "dated thing" + a sixth `Application.deadline` | **One `TimelineItem` model, one store.** `Deadline`/`deadlines` deleted (zero importers). `Reminder`, `CalendarEvent`, `AgendaEvent` collapse into it. **`Application` gets no date fields** — the create dialog's Deadline field mints a `TimelineItem{kind:'deadline', applicationId}`. | Otherwise the first job a user adds is invisible to the calendar, This week and the priority deck — the spine dies at step two. Migration is safe because `calendarEvents`, `reminders` and `agenda` become *derived selectors* over the one array, so untouched consumers keep compiling while the store lands. |
| D5 | FollowUp entity vs follow-up Reminder — two write paths, two counts | **Delete the `followUps` array.** Follow-ups are `timeline.filter(kind==='follow-up' && !completedOn)`; `org`/`role` resolve through `applicationId`. | Two arrays guarantee the dashboard timeline and the Vault checkbox disagree, which is the exact payoff ("tick it and the deck shrinks") the whole plan is for. |
| D6 | Draft buttons → local dialog vs → Assistant; Assistant rail vs `/chat` threads | **One `DraftDialog` owns every "Draft…" click**; it carries a secondary "Open in assistant". **`/chat` route and topbar icon are deleted.** | The dialog works with zero model connected (snippets + RichTextEditor + clipboard all exist). Two addresses for one conversation feature is worse than one fewer icon. |
| D7 | Delete cascade vs independent records | **Unlink, never cascade.** `removeApplication(id)` clears `applicationId` on every timeline item, vault record and saved posting, and drops `refKey('app',id)` from the label map. Confirm copy states it: "2 reminders and 3 events will be kept but unlinked." Undo restores record **and** re-applies the stashed edge list. | Matches the "records with no application stay unfiled" behaviour the vault work already assumes; a cascade silently destroys work the user did not name. |
| D8 | 37 hand-written applications vs 12 real records | **One population.** Retire `summary`, `applicationSources`, `funnel`, `outcomes`, `trackComparison` as constants and derive them from the store. Grow the seed to ~37 real records (mechanical, Wave 5). Keep median-reply-time / KPI deltas / health radar as constants **labelled illustrative in the panel hint**. | Deriving half the numbers while the other half quote 37 puts "Applications 37" beside a pipeline summing to 12 on one screen, and makes the demo-data toggle incoherent. |
| D9 | `New application` specced with `Position` vs `Organisation + Role title` | **`org` + `role` are two required fields**; `displayName(a) = \`${org} — ${role}\`` keeps every current render byte-identical. One component, one prop signature, N entry points; one `draftFromText()` and one `draftFromUrl()` prefill helper shared by AddByUrl / Scout / Duplicate. | A single Position field re-packs the org into the string the split exists to eliminate, and the same dialog would emit two record shapes depending on which button opened it. |
| D10 | Four separate interception dialogs (submit / interview / offer / close) | **One `StageTransitionDialog`**, switched on target stage; each stage contributes its own field block. Every stage write in the app funnels through `setStage()`, which decides whether to open it. | Four dialogs means four places drag, the stage menu, and the create dialog each have to remember to call. |
| D11 | Profile documents vs Vault files | **One document store** (`vaultFiles`), extended with `version`, `track`, `applicationIds`. Profile Documents becomes a filtered view over `bucket === 'Applications'`. | Otherwise uploading a CV in one place leaves the other stale, and `used: 12` stays decorative forever. |
| D12 | Profile "keywords" vs global label "keywords" | **Keep separate, rename in UI.** Profile's become **"Match terms"** (scout scoring); the global system keeps "Keywords" (record tags). | Merging makes "Waiting on them" a scout scoring term. The collision is a naming bug, not a model bug. |

---

## 1. Wave 0 — shared primitives

Not separately demoable; ships inside the Wave 1 demo. Everything after this depends on it. Budget it as one solid block of work before any journey is attempted.

### P1 · `src/lib/ids.ts` *(create)*
```ts
export type EntityKind = 'app'|'item'|'link'|'file'|'snippet'|'posting'|'match'|'pipeline'|'doc'
export type AppId = string & { readonly __app?: unique symbol }
export function refKey(kind: EntityKind, id: string): string   // 'app:stripe'
export function parseRef(key: string): { kind: EntityKind; id: string }
export function slugify(s: string): string                      // reuse toLabelId rules
export function uniqueId(base: string, taken: Iterable<string>): string  // 'unt' -> 'unt-2'
export function assertUniqueIds(kind: EntityKind, rows: {id:string}[]): void // dev only
```

### P2 · `src/lib/links.ts` *(create)* — the URL contract
```ts
appPath(id: AppId): string                                   // `/applications/${id}`
applicationsPath(p?: {view?:'board'|'table'; stage?:Stage|'all'; q?:string;
                      sort?:'org'|'role'|'stage'|'recent'; role?:RoleTag[]; new?:boolean}): string
vaultPath(p?: {tool?:Tool; focus?:string; filter?:'open'|'overdue'|'all'}): string
calendarPath(p?: {y?:number; m?:number; d?:number; focus?:string}): string
scoutPath(p?: {focus?:string}): string
// readers, each falling back to today's hardcoded defaults:
useApplicationsParams(), useVaultParams(), useCalendarParams()
```
**Edit:** `src/routes/Applications.tsx:177,205-206` (view/query/stageFilter → params), `src/routes/Vault.tsx:33` (tool), `src/routes/Calendar.tsx:164-175` (year/month/selected). Rule for the whole codebase: **no component composes a route string by hand.**

### P3 · `src/lib/store.tsx` + `src/lib/store-context.ts` *(create)* — the session store
One provider, one `useReducer`, thin domain hooks. Single provider (not four) because unlink-on-delete is a cross-domain write.

```ts
type State = {
  applications: Application[]
  timeline: TimelineItem[]
  links: VaultLink[]; files: VaultFile[]; snippets: Snippet[]
  postings: SavedPosting[]; pipelines: Pipeline[]; matches: Match[]
  profile: ProfileState
}

useApplications(): {
  all, byId(id), get(id),
  add(draft: NewApplication): Application      // ids via uniqueId(slugify(org))
  update(id, patch: Partial<Application>): void // stamps lastAction + daysAgo:0
  remove(id): { restore: () => void }           // unlink + stashed edges for undo
  setStage(id, stage): void
  duplicate(id): Application
  // derived, memoised:
  stageCounts, offers, recent, sourceCounts, funnel, outcomes, trackSplit
}

useTimeline(): {
  all, byId, forApplication(appId), forDay(y,m,d), forMonth(y,m),
  add(draft), update(id, patch), remove(id), toggleDone(id), snooze(id, days),
  // derived:
  reminders, overdue, today, upcoming, followUps, thisWeek, later, monthDots
}

useVault(), useScout(), useProfile()   // add/update/remove per collection
useStoreAdmin(): { reset(): void; setEmpty(): void; exportJSON(): string }
```
**Mount:** `src/main.tsx` — inside `LabelsProvider` (it calls `useLabels().removeRecord`), outside `MascotProvider`.

**Model changes** in `src/data/seed.ts`:
```ts
type Application = {
  id; org; role; roleTag; stage; note; lastAction; daysAgo
  flagged?; chips?; source?: 'Job scout'|'Job board'|'Referral'|'Careers page'
  location?; comp?; url?; appliedOn?; submittedOn?; firstReplyOn?
  outcome?: 'rejected'|'withdrawn'|'accepted'|'declined'|'ghosted'
  offer?: { respondBy: string; comp?: string; note: string }   // daysLeft now derived
}
export const displayName = (a: Application) => `${a.org} — ${a.role}`
```
Split the 12 seed rows' packed `role` strings. `daysLeft` deleted as stored data.

**New file `src/data/timeline.ts`** — the merged seed:
```ts
type TimelineKind = 'deadline'|'interview'|'visit'|'call'|'prep'|'admin'|'follow-up'
type TimelineItem = {
  id; title; detail?; note?
  date: string            // 'YYYY-MM-DD'
  allDay: boolean; startMins?: number; durationMins?: number
  kind: TimelineKind; urgency: Urgency
  applicationId?: AppId
  remind: boolean         // appears in the Vault Reminders tool
  completedOn?: string | null
  joinUrl?: string; location?: string
}
export const bucketOf(item, today): 'overdue'|'today'|'upcoming'|'done'
export const whenLabel(item, today): string   // '8 days overdue' | 'Today' | 'in 2 days'
```
Migrate `src/data/reminders.ts` (10 rows → `remind:true`, real dates, `applicationId` filled: `ut-receipt|ut-statements→ut-austin`, `tamu-nudge|tamu-submit→tamu`, `databricks-chase→databricks`, `tt-letters→texas-tech`, `stripe-cv|stripe-referral→stripe`, `uh-travel→uh`, `baylor-decide→baylor`), `src/data/calendar.ts:81-208` (add year + ISO dates), `seed.ts` agenda. **Delete** `Deadline`/`deadlines` (`seed.ts:9-15,73-102`) and `followUps` (`seed.ts:17-25,104-129`). Re-export `calendarEvents`/`reminders`/`agenda` as *derived selectors* so untouched consumers compile through the migration.

### P4 · `src/components/ui/toast.tsx` + `src/lib/toast.tsx` *(create)*
```ts
toast({ title, description?, tone?: 'default'|'danger', action?: {label, onClick} })
```
Bottom-right stack in one persistent `<ol aria-live="polite">`, ~5s (8s with an action), pause on hover/focus, dismiss X, honours `prefers-reduced-motion` via `src/lib/use-media-query.ts`. Styling from existing tokens (`surface rounded-lg shadow-[var(--shadow-raised)]`; danger uses `border-danger-border bg-danger-soft text-danger`). **Undo contract:** remove from state immediately, stash `{record, index, edges}` in a ref, restore from the toast action, drop the stash on expiry. **Mount:** `src/components/layout/AppShell.tsx:82-84`.

### P5 · `src/components/common/ConfirmDialog.tsx` *(create)*
`{ open, onOpenChange, title, description, confirmLabel, tone?: 'danger', onConfirm }` on the existing `Dialog` + first real use of `DialogFooter`. Cancel (outline, autofocus) left, destructive right. **Copy rule:** name the record, state the consequence, state the unlink. **Use it only** for multi-field records the user authored (applications, snippets, documents) and bulk wipes. Cheap records delete immediately + undo toast.

### P6 · Field error state — `src/components/common/Field.tsx` *(edit)*
Add `error?: ReactNode`, `required?: boolean`; wire `aria-invalid`, `aria-describedby` to hint/error ids off the existing `useId` (`Field.tsx:25`). The `aria-invalid:` styles already ship in `input.tsx:11` / `textarea.tsx:10` and are currently dead. Add sibling exports in the same file: `FormField` (label + arbitrary child control + hint/error, for Segments, Switches, pickers) and `TextareaField`. **Validation policy:** validate on submit and on blur-after-first-submit; never per keystroke; submit disabled only until the form has been valid once, then let the click surface errors.

### P7 · Global create — `src/components/common/NewMenu.tsx` *(create)*
`+ New` Button in `src/components/layout/Topbar.tsx` between RoleFilter (`:82-84`) and the account group; Popover + Command listing **New application / New reminder / New event / Save a posting / Save a link**. Icon-only `+` below `sm`. Bound to `n` globally in AppShell. Same items become the **Actions** CommandGroup rendered *first* in `src/components/layout/SpotlightSearch.tsx` — requires extending `Result` (`SpotlightSearch.tsx:33-41`) to `{ to?: string; run?: () => void }` and `Section` (`:125-146`) to branch. Dialog open state lives in a tiny `src/lib/dialogs.tsx` (`useDialogs().open('application', initial)`) so any surface anywhere can open any create dialog.

**Wave 0 chores** (five minutes each, do them here): fix `useSpotlight` (`SpotlightSearch.tsx:195-199`) to bail when `event.target` is input/textarea/contenteditable, as its own docstring claims; split the 404 out of `Placeholder` into a `NotFound` route with a "Back to dashboard" action (`App.tsx:42-45`); delete the `/chat` route and its Topbar icon (`Topbar.tsx:20`, `App.tsx:31-39`); wrap `<Outlet/>` in `AppShell.tsx:82-84` with `<ErrorBoundary key={pathname} fallback={<RouteError/>}>` and add a reload button to `ErrorBoundary.tsx:50-56`.

---

## 2. Wave 1 — "I can add a job, and I can add a reminder"

Demo: paste a URL on the dashboard → correct the prefilled draft → save → the row appears in the table, the board, the pipeline bar, the role-filter counts and ⌘K; its deadline appears on the calendar and in This week. Then add a reminder from the topbar and see the Vault count and the sidebar badge move.

### W1.1 · `ApplicationDialog`
- **Create:** `src/components/applications/ApplicationDialog.tsx`, `src/components/applications/draft-from.ts`
- **Edit:** `src/components/common/AddByUrl.tsx`, `src/components/dashboard/QuickAdd.tsx`, `src/routes/Applications.tsx`, `src/components/layout/SpotlightSearch.tsx`, `src/components/layout/Topbar.tsx`
- **Shape:** Dialog (`ui/dialog.tsx`), `sm:max-w-lg`, two-column field grid at `sm`.
- **Props:** `{ mode: 'create'|'edit', initial?: Partial<Application> & {deadline?: string}, onSaved?: (a) => void }`
- **Fields:** Organisation\*, Role title\*, Role tag\* (Segment over `ROLES`, `seed.ts:411`), Stage\* (Segment over `STAGES`, default `draft`), Source (4 values from `applicationSources`), Posting URL (validated with `new URL()`), Location, Comp, **Deadline (date)** → mints a `TimelineItem{kind:'deadline', applicationId, remind:true}`, Note (Textarea), Keywords (`LabelPicker` on `refKey('app', id)`).
- **Prefill helpers:** `draftFromText(s)` splits on the em dash into org/role; `draftFromUrl(u)` → hostname to org, last path segment to role, hostname class to source, url into Posting URL. Both leave Role title focused and selected, with a `DialogDescription` reading "Prefilled from the URL — check these before saving".
- **On save:** `add()` → `daysAgo:0`, `lastAction:'Draft created'` → success toast → `navigate(appPath(created.id))`.
- **Entry points:** Applications header "New application" (`Applications.tsx:308`); per-column `+ Add here` in `BoardColumn` (`:151`, stage preselected); zero-rows EmptyState action (`:320-327`); `AddByUrl` submit (now controlled, `onSubmit(url)` prop) on Dashboard QuickAdd and Applications header; Topbar `+ New`; Spotlight Actions.

### W1.2 · `TimelineItemDialog` (reminder **and** event — one component)
- **Create:** `src/components/timeline/TimelineItemDialog.tsx`
- **Edit:** `src/components/vault/RemindersTool.tsx`, `src/routes/Calendar.tsx`, `src/routes/Vault.tsx`
- **Shape:** Dialog. `mode: 'reminder'|'event'` only changes the title, the default `remind` flag and which fields lead.
- **Fields:** Title\*, Related application (Popover + `Command` over `useApplications().all`, storing `applicationId`), Date\* (date input + quick chips Today / Tomorrow / In a week), All-day Switch → reveals Time + Duration, Kind\* (Segment over the 7 `TimelineKind`s, reusing `kindIcon` at `Calendar.tsx:32-49` and `RemindersTool.tsx:18-23`), Urgency (Segment red/amber/gray), Detail, Note (Textarea), "Show in reminders" Switch, Keywords.
- **Derived, never collected:** `status`, `when`, `daysLeft`.
- **Entry points (Wave 1):** Vault → Reminders "Add reminder" (`RemindersTool.tsx:165-168`, currently a silent no-op); Reminders empty state; Topbar `+ New`; Spotlight Actions. (Calendar entry points land in Wave 3.)

### W1.3 · Repoint readers at the store
- **Edit:** `src/routes/Applications.tsx:27,184,209,305-306` (drop `stageById` local state entirely — `setStage` now lives in the store, so a drag survives navigation), `src/components/dashboard/PipelineBreakdown.tsx:2`, `src/components/dashboard/RecentApplications.tsx:4`, `src/components/layout/RoleFilter.tsx:13,19-25` (counts must be computed in-render, not at module load), `src/components/layout/SpotlightSearch.tsx:31`, `src/data/priority.ts:1` (becomes `usePriorityActions()`), `src/components/vault/RemindersTool.tsx:10,107-119` (`doneIds` → `toggleDone`), `src/routes/Vault.tsx:50-53`.
- Table search haystack (`Applications.tsx:227`) gains `a.org`; the "Position" sort (`:240`) sorts `org` then `role`.

### W1.4 · Honest empty states + the silent no-ops
- **Edit:** `RemindersTool.tsx:165` (now wired), `Calendar.tsx:243` and `JobScout.tsx:133` → wired in later waves, so **until then make them `disabled` with a `title`**, matching `AddByUrl.tsx:61`. Zero enabled-but-inert buttons may survive Wave 1.
- Applications role-filter EmptyState (`Applications.tsx:320-327`) gains `action={<Button onClick={clear}>Clear role filter</Button>}` from `useRoles()`.
- **Rule for the rest of the plan:** every empty state names the filter responsible and offers its reset, copying `RemindersTool.tsx:202-220`.

---

## 3. Wave 2 — "I can open it, change it, and get rid of it"

Demo: click any row anywhere in the app → the record opens → edit it, move its stage through a real menu, log the offer terms, delete it and undo. Every link in the product now lands on the record, not the list.

### W2.1 · Application detail route
- **Create:** `src/routes/ApplicationDetail.tsx`, `src/components/applications/ApplicationHeader.tsx`, `src/components/applications/OfferBlock.tsx`
- **Edit:** `src/App.tsx:21` (nest `:id`), `src/routes/Applications.tsx` (render `<Outlet/>` in a right column at `lg`; table row `<tr>` and board card body become links via `appPath`, grip keeps `stopPropagation` so click and drag do not fight)
- **Sections:** header (org — role, roleTag Chip, stage Chip, flag toggle, overflow: Edit / Duplicate / Move to… / Delete); facts `dl` (source, location, comp, applied on, submitted on, posting URL) using the `PriorityActions.tsx:73-80` pattern; `LabelChips` + `LabelPicker`; note in `RichTextEditor`; **Upcoming** (`useTimeline().forApplication(id)`, with "Add" → `TimelineItemDialog` prefilled); **Reminders** (same array, `remind:true`); offer block when `stage==='offer'`; stage `Timeline` rail from `lastAction`/`daysAgo`.
- **Missing-record fallback:** EmptyState "This application no longer exists" + Back link (bookmarks and undo-expired links).

### W2.2 · Stage control everywhere + `StageTransitionDialog`
- **Create:** `src/components/applications/StageMenu.tsx`, `src/components/applications/StageTransitionDialog.tsx`
- **Edit:** `Applications.tsx:418-420` (table Stage Chip becomes a Popover trigger listing the six stages, dot + label + check, mirroring `LabelFilter.tsx:167-195`), `:251-255` (drag calls store `setStage`), `:80-83` (add `[@media(hover:none)]:opacity-100` so the grip exists on touch), `:445-448` (instruction copy).
- **`StageTransitionDialog` field blocks by target stage:** `submitted` → date (default today), portal URL, confirmation ref, documents sent (multi-select over vault files, versions stamped at send time); `interview` → date + format; `offer` → respond by (date), package, note; `closed` → outcome (`rejected|withdrawn|accepted|declined|ghosted`). Every block has **Skip for now**. Moving *out* of `offer` asks "Keep the offer details?".
- Also add a one-click **Advance** to the next stage, and a `Move to…` item in the row/card overflow.

### W2.3 · Edit / duplicate / delete / flag / chips
- **Edit:** `Applications.tsx:389-432` (new trailing actions `<td>`: flag toggle, `LabelPicker`, overflow), `:72-113` (board card overflow), detail header.
- Flag toggle inline (`aria-pressed`, red dot). Chips edited via a small Popover over the five `Chip` tones. Delete → `ConfirmDialog` (D7 copy) → `remove()` → undo toast.

### W2.4 · Deep links land on records
- **Edit:** `SpotlightSearch.tsx:84,98,113` → `appPath(a.id)`, `vaultPath({tool:'reminders',focus:r.id})`, `calendarPath({y,m,d,focus:e.id})`; `RecentApplications.tsx:47-61` rows become links, "View all" → `applicationsPath({view:'table',sort:'recent'})`; `priority.ts:51,74,120` → `appPath(id)`; `RemindersTool.tsx:74` related line → `appPath(applicationId)`; `FollowUpTimeline.tsx:20-26` title → link; `JobScout.tsx:148-150` "linked to application" chip → link.
- Vault and Calendar read `focus` and ring-highlight + scroll the target row; Vault forces `filter=all` when the target is completed.
- **Edit:** `src/components/layout/Sidebar.tsx:36-42` — badges become selectors over the store (`badge?: (s) => {text,tone}|null`, no badge at zero) pointing at filtered destinations.

### W2.5 · Scout → application (the product's headline handoff)
- **Edit:** `src/routes/JobScout.tsx:103` (enable "Add to applications" → `ApplicationDialog` prefilled via `draftFromText(m.role)`, `source:'Job scout'`, `note:m.detail`; on save the row shows a "tracked" Chip linking to the record), `:133` (wrap the field in a `<form>`, push a `SavedPosting` into the store, clear + focus, success toast), `:144-146` (URL becomes a real external anchor, `target=_blank rel="noopener noreferrer"`, copying `LinksTool.tsx:59-92`), `src/data/scout.ts:74,94` (`linked: boolean` → `applicationId?: AppId`; add `url` to `Match`).

---

## 4. Wave 3 — time surfaces become tools

Demo: create an interview on the calendar by clicking a day, drag it to another day, snooze an overdue chase and watch it jump panels, draft the follow-up email and mark it sent — and see the dashboard count drop.

### W3.1 · Calendar create / open / edit / move / delete
- **Edit:** `src/routes/Calendar.tsx` — day cell restructured so the date and the chips are separate buttons (`:313-317`, `:368-387`) and a chip click opens the event rather than selecting the day; `Add event` (`:243`) and a hover `+` per cell open `TimelineItemDialog` pre-dated; selected-day rows (`:419-435`) and rest-of-month rows (`:455-466`) become buttons; per-row delete + undo; drag-to-reschedule reusing the `@dnd-kit` pattern already proven in `Applications.tsx:449-476` (day cell `useDroppable`, chip `useDraggable`, `DragOverlay`).
- Fix rest-of-month's year blindness (`:448-453` must apply the grid's year filter) and give it an EmptyState with an add action.
- Show `09:30–10:15` in the day list, GlancePanel agenda and ThisWeek rows; sort each day by start time.

### W3.2 · Reminders complete
- **Edit:** `src/components/vault/RemindersTool.tsx` — row title opens `TimelineItemDialog` in edit mode; trailing overflow (Edit / Duplicate / Delete); snooze Popover on the date block (Tomorrow / In 3 days / Next week / Pick a date…) with the row visibly jumping between the Overdue / Today / Upcoming panels; status and `when` now derived from `date`+`completedOn`, so ticking "8 days overdue" reads "Completed today".
- Vault subtitle (`Vault.tsx:50-53`), sidebar badge and priority deck all read the same selectors — ticking one box moves all three.

### W3.3 · `DraftDialog`
- **Create:** `src/components/draft/DraftDialog.tsx`
- **Edit:** `RemindersTool.tsx:94-98`, `FollowUpTimeline.tsx:27-32`, `PriorityActions.tsx:89-93` (+ `priority.ts:50,73,96,119` gain `intent`)
- **Shape:** Dialog. `Command` list of `tag === 'Email'` snippets → body loaded into `RichTextEditor` with `[NAME]/[ROLE]/[DATE]/[PORTAL]/[YOUR NAME]` substituted from the related application and profile. Footer: Copy (reuse the clipboard + failure pattern at `SnippetsTool.tsx:45-59`), Save as snippet, **Mark sent** (sets `completedOn` on the follow-up item), Open in assistant (secondary).
- Also implements snippet placeholder filling generally: detect `/\[[A-Z ]+\]/g`, show a "4 blanks" chip on snippet cards, and route Copy through a fill step when blanks exist.

### W3.4 · Dashboard time panels become actionable
- **Edit:** `src/components/dashboard/ThisWeek.tsx` (rows → buttons opening the item; hover checkbox to complete; day cells → `calendarPath`; "Later" chips → the same detail; EmptyState), `src/components/dashboard/GlancePanel.tsx:187-192,263-294` ("Open calendar" carries `view`+`selected`; day list rows open the item; `+` beside the day heading; "Nothing planned" gains an add action), `FollowUpTimeline.tsx` (Mark sent / Snooze / Open beside Draft; EmptyState "Nobody is waiting on you"), `PriorityActions.tsx` (Done / Snooze per card; deck rebuilt from live state; lorem `description` at `priority.ts:41-43,64-65,88-89,110-111` **deleted** — render an "Add a note" ghost button in that space when a record has none).

---

## 5. Wave 4 — the Vault and the keyword system

Demo: save a link, drop a file, write and save a snippet, tag an application with a keyword and filter the board by it, rename a mistyped keyword.

### W4.1 · Links / Files / Snippets CRUD
- **Edit:** `LinksTool.tsx` (paste-first URL Input + "Save link" in the header beside the BucketFilter; title derived via the existing `hostOf`; per-row Pencil/Trash outside the anchor), `FilesTool.tsx` (Add file button + real drop target on the list Panel; read `name`/`size`/`type` only; keep the `File` object for session-added PDFs so `URL.createObjectURL` genuinely previews through `FileViewer`; per-row overflow: Rename / Move bucket / Edit note / Delete; **fix the stale doc comment at `:21-27`**), `SnippetsTool.tsx:165-185` (title `Field`, tag Segment over `SNIPPET_TAGS`, **Save / Cancel / Delete** footer, HTML→plain-text inverse of `:66-73`, dirty-check on close, replace the false "edits stay in this session" note).
- Vault gains a text search Input beside the tool Segment, combining with bucket + keyword filters.
- Add links/files/snippets as three Spotlight CommandGroups.

### W4.2 · Keywords: manage + scope to applications
- **Edit:** `src/lib/labels-context.ts` / `src/lib/labels.tsx` — add `renameLabel(id,name)`, `removeLabel(id)` (strips from `byRecord` **and** `selected`), `setTone(id,tone)`, `removeRecord(key)`; stop deriving the id from the name after creation so rename is stable.
- **Migrate `byRecord` keys to `refKey`** (`src/data/labels.ts:37-91` is already grouped by type in comments — mechanical).
- **Edit:** `LabelFilter.tsx` — per-chip context menu (Rename / Colour swatches / Delete with `countFor` in the confirm); `LabelChips` gains an optional `onRemove`; reconsider the auto-select at `:50` (a zero-record keyword empties every list).
- **Mount on applications:** `LabelChips` on the table Position cell and the board card, `LabelPicker` in the row actions and detail, `LabelFilter scopeIds={rows.map(r=>refKey('app',r.id))}` in the table toolbar, filtered through `matches`. Also mount on calendar event detail.
- New **Keywords panel** in `src/routes/Settings.tsx` (usage count, tone swatch, rename, delete) using `SettingRow`.

### W4.3 · Documents unified (D11)
- **Edit:** `src/data/vault.ts` (`VaultFile` gains `version`, `track`, `applicationIds`, `body?` for `.note`), `src/routes/Profile.tsx:10-43,184-222` (private array deleted; panel becomes a view over `bucket==='Applications'`; Upload wired to a hidden file input; per-card Replace/Rename/Set track/Remove), `FileViewer.tsx:67-73` (render `.note` bodies through `RichTextEditor`; keep the honest no-preview state for `doc`/`slides` only, reworded).
- Profile Basics/Links become controlled off `useProfile()` with a sticky Save / Discard bar; "keywords" renamed **Match terms** with a working inline add (copy `LabelFilter.tsx:96-113` verbatim: trim guard, Enter handler) and undo on remove.

---

## 6. Wave 5 — every number becomes true

Demo: drag a card to Interview and watch the funnel, the pipeline bar, the sidebar badge and the sources donut all move; click "Interview 4" and land on the filtered table.

- **Derive** `summary`, `stats`, `applicationSources`, `funnel`, `outcomes`, `trackComparison` from `useApplications()`; delete the constants in `src/data/statistics.ts:13-119` that duplicate them. Keep median reply time, KPI deltas and the health radar, labelled "illustrative" in the panel hint.
- **Reply logging:** `firstReplyOn` + a `Log a reply` action (date, kind `acknowledgement|rejection|request|invite`, note) in the row overflow and detail header; `invite` offers to create an interview event, `rejection` offers to close with outcome. Funnel "Responded" and the response-rate KPI derive from it. Add a "Replied" table column.
- **Track axis:** `ROLE_TRACK: Record<RoleTag,'academia'|'industry'>` beside `ROLES`, with a per-application override in the dialog; wire Profile's two include-switches to the scout filter; delete or rebuild `applicationFrequency`.
- **Drilldowns:** `PipelineBreakdown.tsx:28-43`, `GlancePanel.tsx:121-135`, `Statistics.tsx:89-115,209-224`, `SearchHealth.tsx:58-82` all become links via `applicationsPath({stage|outcome|track})`; the destination shows a "From Statistics: Interviewed" chip with a clear button.
- **Seed expansion** to ~37 applications (D8), plus a Demo data / Empty Segment and a Reset button in Settings → Your data, and a working **Export** (Blob + object URL, the lifecycle already demonstrated in `FileViewer.tsx:41-48`).
- Guide steps gain `done|available|coming` state from store selectors and deep-link into the dialogs (`applicationsPath({new:true})`), turning it into a working first-run checklist.

---

## 7. Wave 6 — optional, cut it if time is short

`RuntimeProvider` (session-only `{model, bridge, autoSync, snapshots}`), Settings fields made controlled with a faked 2s "Test connection", read by `Assistant.tsx:33-45`, `JobScout.tsx:55-64` and `Sidebar.tsx:49-53,204-224` (tiles navigate to the matching Settings panel). Assistant gets a message list, a live composer and per-quick-action scripted replies, every one badged **"Example response · no model connected"**, with Copy and Save to Snippets. Cut this whole wave before cutting anything in Waves 1–4.

---

## 8. Do not build

| Not building | Why |
|---|---|
| **Recurrence / repeat** on items | A whole scheduling engine (next-occurrence, until-conditions, edit-this-vs-all) for a demo payoff of one re-appearing row. Nothing else depends on it. |
| **Contacts / People entity** | Adds a sixth vault tool, a new relation, and `[NAME]` substitution plumbing. `DraftDialog` can leave `[NAME]` as the one field the user types. Revisit only if the draft flow proves the need. |
| **Interview entity** (rounds, debrief, thank-you) | The stage plus a `TimelineItem{kind:'interview'}` covers the walkable journey. A full record needs its own detail surface and a "how did it go" prompt system. |
| **Season / archive** | Requires a period control on every panel plus an archive filter on the board. The prototype has one season of data; nothing is provably wrong without it. |
| **`/chat`** | Deleted (D6). A nav icon that always disappoints is worse than one fewer icon. |
| **Bulk multi-select on the table** | Selection model, shift-range, a bulk action bar and a bulk confirm — a lot of surface for housekeeping journeys, and it multiplies the delete/unlink edge cases. |
| **Import** (`Settings.tsx:172`) | Export is a pure read and ships in Wave 5. Import means a schema validator, a version field and a destructive replace confirm, for a journey nobody can complete in a session-only app. **Excel export** dropped entirely rather than left disabled. |
| **Week / Agenda calendar views** | Month grid + a working detail + rest-of-month overflow answers "what is next". Two more layouts is a second calendar. |
| **Persisting page-option toggles** | Six popovers whose toggles reset on navigation. Cosmetic; no journey ends there. Leave as-is rather than build a preferences store. |
| **Per-panel error boundaries** | Route-level boundary keyed on pathname (Wave 0) already means a broken panel never traps the user. Nine more boundaries is nine more fallbacks to design. |
| **Keyboard shortcut overlay + `g` chords** | Ship only `n` (new) and the ⌘K typing-target fix. A chord system and a shortcuts dialog serve discoverability, not a blocked journey. |
| **Scout snapshot viewer** | "Open snapshot" stays `disabled` with a title. Rendering a fake snapshot through `placeholderPdf` asserts the app fetched and stored a page it did not. |
| **Editable role taxonomy** | `ROLES` stays closed for now. Making it mutable means reassignment-on-delete, a Settings panel, and reconciling with Profile target roles — and every seeded application already has a valid tag. Add "Create role…" only if the create dialog proves it blocks people. |

**Two standing rules for every wave:** no button ships enabled-and-inert — it either opens real UI or is `disabled` with a `title` naming the blocker; and no destructive action ships without either an undo toast (cheap records) or a `ConfirmDialog` (authored records), never both.