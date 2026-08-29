/**
 * L3 — the handful of domain facts more than one tool module needs.
 *
 * Not a grab-bag: everything here is something two tool modules would otherwise
 * have spelled twice, and every one of those pairs is a place the app has
 * already drifted once. `guessRoleTag` lived inside `useScout` and was therefore
 * unreachable from the applications form; the stage labels were re-derived from
 * `STAGES` in four components; and "what counts as the application form's own
 * deadline" was written in a `components/` module that a domain write had to
 * reach up into.
 *
 * Time enters through `ctx.now` (D26). Nothing here reads a clock of its own.
 */

import { daysBetween } from '../core/dates'
import type { ISODate, NodeId, RoleTag, Urgency } from '../core/model'
import type { GraphSnapshot } from '../core/snapshot'
import type { ToolContext } from './tool'

/**
 * What each stage is called, re-exported and not redeclared.
 *
 * `kg/core/model.ts` owns it as a `Record<Stage, string>` annotation on an
 * object literal beside `STAGE_VALUES`, which is the only spelling where a
 * missing stage is a compile error. There were five copies of this lookup, each
 * built as `Object.fromEntries(STAGES.map(…)) as Record<Stage, string>` — and
 * the `as` turns "a missing stage is a compile error" into "a missing stage
 * renders `undefined`" in a chip, a toast and an aria-label. The one here was
 * the fifth.
 *
 * The re-export is now only a convenience for tool modules that already import
 * this file: it used to be load-bearing, because the map lived in `@/data/seed`
 * and `kg/react/use-applications.ts` may not import a fixture. That hook reads
 * `core/model.ts` directly now.
 */
export { STAGE_LABEL } from '../core/model'

/*
 * The unions a tool schema is built from are NOT here any more.
 *
 * `STAGE_IDS`, `TIMELINE_KINDS` and `URGENCIES` lived in this file as fresh
 * literals guarded by `satisfies` — which does not guard this. `['a','b'] as
 * const satisfies readonly Kind[]` asserts every element IS a Kind and says
 * nothing about every Kind being present, so a SHORTER list still compiles.
 * That split the model in half across two layers: `core/validate.ts` imports
 * `TIMELINE_KIND_VALUES` and so accepted a newly-added kind off disk, while
 * `s.enum(TIMELINE_KINDS)` refused to create or update it — the record loaded,
 * rendered, and could not be written by the tool that owns it. Journal replay
 * bypasses schemas, so undo put it back too: a value in the graph that no tool
 * could produce.
 *
 * `STAGE_IDS` was worse. It was `STAGES.map((s) => s.id) as readonly Stage[]` —
 * the schema for a persisted field, derived from the demo fixtures through a
 * cast that erased the only check that would have caught a gap.
 *
 * So every tool module imports `STAGE_VALUES`, `TIMELINE_KIND_VALUES`,
 * `URGENCY_VALUES` and the rest from `kg/core/model` directly, and the import
 * line says where the truth is. Where a tool genuinely needs a subset, spell it
 * as a filter over the const, never as a second list.
 * `tools.test.ts`'s "every value the model declares" case is what keeps this
 * from being re-derived by hand the next time.
 */

/**
 * The calendar day the user is standing in, from the transaction's instant.
 *
 * Defined in `core/project.ts` and re-exported here, which is where the eight
 * tool call sites below already look for it. It went down a layer when
 * `repo/seed.ts` needed it and could not import `tools`; the re-export is what
 * kept that from being a rename across eight files.
 */
export { dayOf } from '../core/project'

/**
 * Every write counts as activity.
 *
 * This replaces `daysAgo: 0`, which `useApplications.update` spread into every
 * patch (in the removed `store-context.ts`). An edit that left the timestamp alone sank the
 * row the user had just touched to the bottom of the recent feed, which is the
 * default sort on two screens.
 */
export function touch(ctx: ToolContext, id: NodeId, lastAction: string): void {
  ctx.tx.patch<'application'>(id, { lastAction, lastActionAt: ctx.now })
}

/**
 * Spreads a key only when there is a value for it.
 *
 * `...(x === undefined ? {} : { note: x })` reads the same and does not compile
 * when `x` is a call rather than a variable: TypeScript narrows a property
 * access across the ternary but not a function result, so the second mention is
 * still `string | undefined` and `exactOptionalPropertyTypes` rejects it. Doing
 * it here also means a props object can never gain an explicit `undefined`,
 * which is the round-trip bug D21 names.
 */
export function opt<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }
}

/* -------------------------------- naming ---------------------------------- */

export function orgNameOf(m: GraphSnapshot, appId: NodeId): string {
  return m.one(appId, 'AT', 'organisation')?.props.name ?? ''
}

/**
 * 'Rice — Assistant professor', or just 'Rice'.
 *
 * Only the employer is required, and a posting promoted from a URL that names no
 * job arrives with the role blank. Interpolating regardless left a dangling
 * separator on the end of the name — punctuation promising a second half that is
 * not there.
 */
/**
 * What to call ANY record, for an announcement that has to name one.
 *
 * `displayOf` below is application-only — it returns `''` for every other type,
 * which is a silent empty description when used on a thread or a keyword. This
 * is the general one: the same `name`/`title`/`role`/`slug` rule
 * `agent/queries.ts` uses for search results, kept here because tools may not
 * import from the agent layer.
 *
 * A list rather than a switch over a dozen types, so a new record type is
 * legible for free. `slug` is the last resort and is never nothing.
 */
const NAME_KEYS = ['name', 'title', 'role', 'slug'] as const

export function nameOf(m: GraphSnapshot, id: NodeId): string {
  const node = m.node(id)
  if (!node) return ''
  const props = node.props as Record<string, unknown>
  const own = NAME_KEYS.map((k) => props[k]).find((v) => typeof v === 'string' && v.length > 0)
  if (typeof own !== 'string') return ''
  // An application's role means little without the employer — "Assistant
  // professor" is several of the seeded records. `displayOf` says the same.
  if (node.type !== 'application') return own
  const org = m.one(id, 'AT', 'organisation')
  return org ? `${own} — ${String(org.props.name)}` : own
}

export function displayOf(m: GraphSnapshot, appId: NodeId): string {
  const app = m.node(appId, 'application')
  if (!app) return ''
  const org = orgNameOf(m, appId)
  return app.props.role.trim() ? `${org} — ${app.props.role}` : org
}

/* ------------------------------- deadlines -------------------------------- */

/** What the seed's application deadlines say, and what `application.*` writes. */
export const DEADLINE_DETAIL = 'Application deadline'

/**
 * The one dated item the application form owns.
 *
 * Three conditions, and the last two are each a measured bug rather than
 * defensiveness.
 *
 * KIND AND DETAIL. Told apart from every other `kind: 'deadline'` on the same
 * application by the detail line. Baylor's only deadline is its offer-response
 * date — matching on kind alone would let the form's date field move, or clear,
 * a decision deadline nobody touched. The match is a PREFIX because the seed's
 * deadlines carry an authored suffix (`'Application deadline · 3 reference
 * letters required'`) and go into the graph verbatim through `repo/seed.ts`;
 * requiring equality would make the form mint a second deadline on the first
 * edit of any demo application.
 *
 * ABOUT EXACTLY ONE APPLICATION. `ABOUT` was `fromCardinality: 'one'` when the
 * two lines above were written, so "every other deadline on the same
 * application" was the whole space. It is `'many'` now — a reference deadline
 * covering three jobs is the case it was widened FOR — and a shared item is
 * about this application without being the form's. Measured: two applications
 * created with no date, then one reference deadline about both with a detail
 * beginning 'Application deadline', then a date typed into each form.
 * `syncDeadline` found the shared item twice, moved it twice, and ended with
 * BOTH applications reporting the second date, no deadline of their own, and
 * the user's reference item destroyed. The form always writes
 * `applicationIds: [id]`, so an item about anything else is never the one it
 * owns.
 *
 * EXACT SENTINEL FIRST. `application-fields.ts` writes the detail as exactly
 * `DEADLINE_DETAIL`; only the seed and the user produce the prefixed form. Among
 * candidates, `find` returned whichever `many` yielded first, which is
 * edge-insertion order and NOT stable: measured, deleting the form's own
 * deadline and pressing undo re-inserts its ABOUT edge at the end, after a
 * user's own 'Application deadline · chase the letter' item — and from then on
 * the application reported the user's date as its deadline. Ranking the exact
 * match ahead makes the answer independent of the order edges happen to be
 * indexed in.
 *
 * What this still cannot settle: a single-application item the USER wrote whose
 * detail begins with the sentinel, when the form has no item of its own. It is
 * indistinguishable from a seeded deadline in the graph, and the sentinel's
 * contract says such an item IS the application's deadline — so the form adopts
 * it rather than minting a second. That is the design, not an oversight.
 */
export function applicationDeadlineOf(m: GraphSnapshot, appId: NodeId) {
  const owned = m
    .many(appId, 'ABOUT', 'in', 'timelineItem')
    .filter(
      (i) =>
        i.props.kind === 'deadline' &&
        (i.props.detail ?? '').startsWith(DEADLINE_DETAIL) &&
        m.out(i.id, 'ABOUT').length === 1,
    )
  return owned.find((i) => i.props.detail === DEADLINE_DETAIL) ?? owned[0]
}

export function deadlineUrgency(from: ISODate, date: ISODate): Urgency {
  const days = daysBetween(from, date)
  if (days <= 7) return 'red'
  if (days <= 21) return 'amber'
  return 'gray'
}

/* -------------------------------- guessing -------------------------------- */

/**
 * Best guess from a posting's own wording, checked most specific first so
 * "Assistant professor, data science" does not come back as a Researcher.
 *
 * A guess, offered as a default that the user can correct — never a value a tool
 * writes without one of them having had the chance to see it.
 */
export function guessRoleTag(text: string): RoleTag {
  const t = text.toLowerCase()
  if (t.includes('lecturer')) return 'Lecturer'
  if (t.includes('postdoc')) return 'Postdoc'
  if (t.includes('professor')) return 'Assistant Professor'
  if (t.includes('scientist') || t.includes('research')) return 'Researcher'
  return 'ML Engineer'
}
