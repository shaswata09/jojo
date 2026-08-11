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

import { STAGES } from '@/data/seed'
import { daysBetween } from '@/data/timeline'
import type {
  ISODate,
  NodeId,
  RoleTag,
  Stage,
  StoredNode,
  TimelineKind,
  Urgency,
} from '@/kg/core/model'
import type { GraphSnapshot } from '@/kg/core/snapshot'
import type { ToolContext } from './tool'

export const STAGE_IDS = STAGES.map((stage) => stage.id) as readonly Stage[]

/**
 * The unions as runtime lists, because `s.enum` needs the values and a type
 * cannot be iterated. Declared here rather than in each tool module so a new
 * kind is added in one place — `TimelineKind` grew 'follow-up' late, and the
 * three components that switched on it were found one bug report at a time.
 */
export const TIMELINE_KINDS = [
  'deadline',
  'interview',
  'visit',
  'call',
  'prep',
  'admin',
  'follow-up',
] as const satisfies readonly TimelineKind[]

export const URGENCIES = ['red', 'amber', 'gray'] as const satisfies readonly Urgency[]

export const STAGE_LABEL = Object.fromEntries(
  STAGES.map((stage) => [stage.id, stage.label]),
) as Record<Stage, string>

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

export const titleOf = (n: StoredNode): string => {
  const props = n.props as { title?: string; name?: string; role?: string }
  return props.title ?? props.name ?? props.role ?? ''
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
