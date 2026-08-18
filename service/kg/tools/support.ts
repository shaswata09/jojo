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
 * Told apart from every other `kind: 'deadline'` on the same application by the
 * detail line. Baylor's only deadline is its offer-response date — matching on
 * kind alone would let the form's date field move, or clear, a decision deadline
 * nobody touched.
 */
export function applicationDeadlineOf(m: GraphSnapshot, appId: NodeId) {
  return m
    .many(appId, 'ABOUT', 'in', 'timelineItem')
    .find((i) => i.props.kind === 'deadline' && (i.props.detail ?? '').startsWith(DEADLINE_DETAIL))
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
