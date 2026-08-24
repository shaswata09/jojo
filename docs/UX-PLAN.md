# jojo — plan to platform standard

> **SUPERSEDED — kept as a record, not as guidance.**
>
> Its diagnosis describes an app that no longer exists ("cannot track anything",
> "lies about state"), and it prescribes two libraries that were evaluated and
> rejected: Dexie, and Sonner. Neither is in the lockfile. It also names
> components that were never built under those names.
>
> The UX decisions that actually shipped are in `docs/UX-FINALISATION.md` and in
> the components themselves.

Derived from a seven-track UX audit (Nielsen heuristics, WCAG 2.2 AA, task-flow
analysis, state coverage, information architecture, interaction patterns, and the
Material 3 / HIG / Fluent 2 comparison), plus the `apple-design` skill.

> ⚠️ The Material 3 / HIG / Fluent 2 verification pass did **not** complete. Any
> claim attributed to those systems is **unverified** and must be re-checked
> against primary sources before it drives a decision. Everything else here was
> either locally verified against the codebase or independently confirmed.

---

## Diagnosis

The visual layer is no longer the problem. Three things are.

**1. It cannot track anything.** Nothing persists and nothing writes. Twelve
buttons are inert on first load. The search box accepts keystrokes and discards
them. The Academia/Industry toggle updates a context only the topbar reads.

**2. The data model cannot support the features.** Dates are stored as display
strings — `"in 3 days"`, `"Oct 15"`, `"21 days of silence"`. Urgency is
*authored*, not computed. No sorting, filtering, or date arithmetic is possible
on top of this shape. This blocks nearly everything else.

**3. It lies about state.** The Runtime strip reports live status for subsystems
that do not exist. Count badges are literals. Several hardcoded numbers
contradict each other.

Against Apple's eight principles, the failure is **Agency** (no undo, no control,
nothing reversible) and **Craft** (controls that promise and don't deliver), not
aesthetics.

---

## Phase 0 — Correctness

Objective defects. No design decisions, no dependencies, each independently
shippable.

| # | Defect | File |
|---|---|---|
| 0.1 | `funnel[0].count` throws on empty data | `routes/Statistics.tsx:11` |
| 0.2 | Five division sites unguarded → `NaN%` / `Infinity%` | `Statistics.tsx`, `ApplicationSources.tsx`, `PipelineBreakdown.tsx` |
| 0.3 | Drawer declares `aria-modal` with no focus trap — Tab walks behind the backdrop | `Sidebar.tsx`, `AppShell.tsx` |
| 0.4 | `outline-none` cancels the global `:focus-visible` rule | `Topbar.tsx`, `ui/button.tsx` |
| 0.5 | Undefined Tailwind utilities render nothing, killing the timeline colour channel | `common/Timeline.tsx` |
| 0.6 | Chart tooltip is mouse-only — no keyboard, no touch | `ApplicationFrequency.tsx:158-169` |
| 0.7 | ~~`--text-3` below 4.5:1 in both themes~~ | **done** — `index.css` |

## Phase 1 — Stop the interface lying

Cheap, high-trust. Apple calls this Craft; Nielsen calls it H1 (visibility of
system status).

- Every inert control gets `disabled` plus a reason — *"Drafting needs a local
  LLM — see How to use"*. An affordance that does nothing is worse than an
  absent one.
- Empty states for the six components that currently render a titled panel
  wrapped around nothing.
- The Runtime strip either reports real state or goes.
- Reconcile the contradictory hardcoded numbers.

## Phase 2 — Data model and persistence

The unblocker. Nothing above trivial is possible until this lands.

- Real `Date` values throughout; derive `"in 3 days"` at render, never store it.
- Urgency computed from dates, not authored.
- Dexie schema: applications, events, reminders, documents, stage transitions.
- **Stage transitions with history** — the funnel statistics are currently
  unbackable because no transition is recorded.
- **A document model.** The search box promises to search "materials"; there is
  no material entity.
- **Reference letters as first-class.** A dependency on other people is central
  to an academic search and is currently four hardcoded strings.

## Phase 3 — Core functionality

- Add / edit / delete an application.
- Search that searches.
- The track filter actually filtering.
- Undo via toast (Sonner) rather than confirmation dialogs — reversible actions
  should be reversible, not gated.
- Validation on blur for format-checkable fields, live for constructive ones.
  Never only on submit.

## Phase 4 — Information architecture

Ten flat peers, with Settings and How to use as siblings of workflow
destinations. Group into two levels; move account/help/settings out of primary
navigation.

## Phase 5 — Craft and motion

Per `apple-design`:

- Feedback on **pointer-down**, not release.
- Springs, not fixed-duration transitions, for anything grabbable —
  `damping 1.0` by default, bounce only after momentum.
- Every animation interruptible, animating from the **presentation** value.
- Enter and exit along the same path; anchor popovers to their trigger.
- Size-specific tracking: tighten large text, body near `0`.

---

## Explicitly not building

A single-user app with ~37 records does not need everything Linear has.

- **Command palette** — scale pattern; friction at this size.
- **Bulk selection** — nothing to bulk-act on.
- **Saved views** — three filters do not need persisting as named views.
- **Optimistic-update machinery** — writes are local and synchronous; there is
  no latency to hide. Keep the undo toast, drop the reconciliation layer.
