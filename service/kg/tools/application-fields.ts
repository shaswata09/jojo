/**
 * L3 — the input vocabulary the application tools share, and the two writes the
 * form owns beyond the record itself.
 *
 * Split out of `application.ts` because four modules now spell these: create and
 * update share `fields` verbatim, `application.stage.advance` shares
 * `offerShape`, and every tool that takes an id takes `appId`. A second copy of
 * any of them is a schema that accepts a value the other one rejects, which
 * shows up as a form that saves in one dialog and refuses in the next.
 *
 * The closed unions are NOT among them. They come from `core/model.ts` at
 * every call site — `OUTCOMES` used to be a fifth spelling of `OUTCOME_VALUES`
 * here, and it also collided by name with a differently-shaped `OUTCOMES` in
 * `components/applications/dialog/transition-options.ts`.
 */

import { SOURCES, STAGE_VALUES } from '../core/model'
import type { ISODate, NodeId } from '../core/model'
import { s } from '../core/schema'
import {
  DEADLINE_DETAIL,
  applicationDeadlineOf,
  dayOf,
  deadlineUrgency,
  displayOf,
} from './support'
import type { ToolContext } from './tool'

export const appId = s.id('application', { label: 'Application' })

/** Every field the form can write, all optional, shared by create and update. */
export const fields = {
  org: s.optional(s.string({ min: 1, label: 'Employer' })),
  role: s.optional(s.string({ label: 'Role' })),
  roleTag: s.optional(s.string({ min: 1, label: 'Role type' })),
  stage: s.optional(s.enum(STAGE_VALUES, { label: 'Stage' })),
  note: s.optional(s.string({ label: 'Note', multiline: true })),
  source: s.optional(s.enum(SOURCES, { label: 'Where it came from' })),
  location: s.optional(s.string({ label: 'Location' })),
  comp: s.optional(s.string({ label: 'Compensation' })),
  url: s.optional(s.string({ label: 'Posting link' })),
}

export const offerShape = s.object({
  respondBy: s.isoDate({ label: 'Respond by' }),
  comp: s.optional(s.string({ label: 'Package' })),
  note: s.string({ label: 'Note', multiline: true }),
})

/**
 * A blank string clears the field rather than storing one.
 *
 * The form hands back `form.location.trim() || undefined`, and under
 * `exactOptionalPropertyTypes` an explicit `undefined` cannot cross a parsed
 * schema at all — `s.optional` drops the key. So emptiness arrives as `''`, and
 * the difference between "left blank" and "cleared" is settled here, once,
 * rather than in each of the nine fields.
 */
export const cleared = (value: string | undefined) =>
  value === undefined ? undefined : value.trim() || undefined

/* --------------------------------- helpers -------------------------------- */

/**
 * Syncs the one deadline the application form owns.
 *
 * `undefined` means the field was never touched and nothing happens — a save
 * that always wrote minted a second deadline every time someone edited a
 * location. `null` means the user emptied it, which is the one destructive half
 * of an otherwise harmless save.
 */
export function syncDeadline(ctx: ToolContext, id: NodeId, deadline: ISODate | null | undefined) {
  if (deadline === undefined) return
  const existing = applicationDeadlineOf(ctx.memory, id)

  if (deadline === null) {
    if (existing) ctx.call('timeline.item.delete', { id: existing.id })
    return
  }

  const title = displayOf(ctx.memory, id)
  if (!existing) {
    // Without this the first application anyone adds is invisible everywhere
    // that reads dates — the calendar, This week, the priority deck — and the
    // app looks like it lost the record.
    ctx.call('timeline.item.create', {
      title,
      detail: DEADLINE_DETAIL,
      date: deadline,
      kind: 'deadline',
      urgency: deadlineUrgency(dayOf(ctx.now), deadline),
      applicationIds: [id],
      // Off, like every seeded application deadline: the reminders list captions
      // a reminder with its related application, and this item's title IS that
      // application, so with `remind` on the row rendered its own name twice.
      remind: false,
    })
    return
  }

  ctx.call('timeline.item.update', {
    id: existing.id,
    date: deadline,
    ...(existing.props.date === deadline
      ? {}
      : { urgency: deadlineUrgency(dayOf(ctx.now), deadline) }),
  })
}

/** Replaces the keyword set on a record, or leaves it alone when absent. */
export function syncKeywords(
  ctx: ToolContext,
  id: NodeId,
  keywords: readonly NodeId[] | undefined,
) {
  if (keywords === undefined) return
  ctx.call('keyword.record.set', { record: id, keywords: [...keywords] })
}
