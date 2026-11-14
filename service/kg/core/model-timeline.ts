/**
 * L1 — timeline items: deadlines, interviews and reminders, as a screen reads
 * them and as they are stored. Re-exported by `core/model.ts`.
 */

import type { ISODate } from './model-graph'

export const URGENCY_VALUES = ['red', 'amber', 'gray'] as const
export type Urgency = (typeof URGENCY_VALUES)[number]

export const TIMELINE_KIND_VALUES = [
  'deadline',
  'interview',
  'visit',
  'call',
  'prep',
  'admin',
  'follow-up',
] as const
export type TimelineKind = (typeof TIMELINE_KIND_VALUES)[number]

export type TimelineItem = {
  id: string
  title: string
  /** One-line context, shown under the title. */
  detail?: string
  /** The user's own scribble, kept apart from `detail` so edits never clobber it. */
  note?: string
  /** 'YYYY-MM-DD'. A real sortable date, never "in 3 days". */
  date: string
  /** Derived: `startMins === undefined`. See project.ts. */
  allDay: boolean
  /** Minutes from midnight. Undefined whenever `allDay`. */
  startMins?: number
  durationMins?: number
  kind: TimelineKind
  urgency: Urgency
  /**
   * Every application this is about, newest edge last.
   *
   * A LIST, and it replaced a scalar `applicationId`. A reference deadline
   * covers three applications; a conference is where you meet two departments.
   * Empty rather than absent, so a caller never has to ask which kind of nothing
   * it is looking at.
   */
  applicationIds: string[]
  /** Whether this surfaces in the Vault's Reminders tool. */
  remind: boolean
  completedOn?: string | null
  location?: string
  joinUrl?: string
}

/**
 * What a form hands in to create a timeline item.
 *
 * Derived from `TimelineItem` rather than written out, so a field added to the
 * record cannot be forgotten here. The four made optional are the ones the
 * projection guarantees on the way out but a caller should not have to state on
 * the way in — `applicationIds: []` to say "filed under nothing" is noise.
 *
 * IN CORE rather than beside `useTimeline`, because `core/stage-policy.ts`
 * returns one and core may not import the React layer. `kg/react/use-timeline`
 * re-exports it, so every existing importer is unaffected.
 */
export type TimelineDraft = Omit<
  TimelineItem,
  'id' | 'allDay' | 'remind' | 'urgency' | 'applicationIds'
> &
  Partial<Pick<TimelineItem, 'allDay' | 'remind' | 'urgency' | 'applicationIds'>>

export type TimelineItemProps = {
  slug: string
  title: string
  detail?: string
  note?: string
  date: ISODate
  /** Absent means all-day. `allDay` was the same fact stored twice. */
  startMins?: number
  durationMins?: number
  kind: TimelineKind
  urgency: Urgency
  remind: boolean
  /**
   * Absent while the item is open.
   *
   * The domain type spells this `string | null` because `null` is how the
   * reducer reopened an item. Storing that distinction would keep an explicit
   * `null` on disk, where structured clone preserves it — so `'completedOn' in
   * props` would answer yes for an item nobody has completed.
   */
  completedOn?: ISODate
  location?: string
  joinUrl?: string
}
