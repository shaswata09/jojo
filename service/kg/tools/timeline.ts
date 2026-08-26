/**
 * L3 — the timeline tools.
 *
 * One model for anything with a date on it. The same real-world event used to be
 * typed five ways with no key joining the copies, so ticking off "UT Austin
 * statements" in the Vault could never reach the calendar or the dashboard.
 *
 * `toggleDone` is gone, split into `complete` and `reopen`. A toggle is an
 * instruction to invert whatever it finds, and by the time an undo fires the item
 * may have been unticked on another screen — so the undo would re-tick it. This
 * codebase already wrote that down three times before anyone acted on it — on
 * the Undo of the completion toast in `PriorityActions.tsx`,
 * `RemindersTool.tsx` and `OwedThisWeek.tsx`. `snooze` is the same shape of
 * trap and is written
 * here as an absolute date so its undo is exact.
 *
 * `allDay` is not stored. It was `startMins === undefined` written down a second
 * time, and the two disagreed the moment a card cleared the start time without
 * remembering to flip the boolean.
 */

import { addDays, shortDate } from '../core/dates'
import { TIMELINE_KIND_VALUES, URGENCY_VALUES } from '../core/model'
import type { ISODate, NodeId } from '../core/model'
import { s } from '../core/schema'
import { defineTool } from './tool'
import type { ToolContext } from './tool'
import { dayOf, opt } from './support'

const itemId = s.id('timelineItem', { label: 'Item' })

const fields = {
  title: s.optional(s.string({ min: 1, label: 'Title' })),
  detail: s.optional(s.string({ label: 'Detail' })),
  note: s.optional(s.string({ label: 'Note', multiline: true })),
  date: s.optional(s.isoDate({ label: 'Date' })),
  startMins: s.optional(s.nullable(s.number({ min: 0, max: 1439, int: true, label: 'Starts at' }))),
  durationMins: s.optional(s.nullable(s.number({ min: 0, int: true, label: 'Lasts' }))),
  kind: s.optional(s.enum(TIMELINE_KIND_VALUES, { label: 'Kind' })),
  urgency: s.optional(s.enum(URGENCY_VALUES, { label: 'Urgency' })),
  remind: s.optional(s.boolean({ label: 'Show in Reminders' })),
  location: s.optional(s.string({ label: 'Location' })),
  joinUrl: s.optional(s.string({ label: 'Join link' })),
  /** `null` unfiles it; absent leaves the edge alone. */
  /**
   * The applications this is about, as a SET.
   *
   * A list, since `ABOUT` became `fromCardinality: 'many'`. Absent leaves the
   * filing alone; an empty list makes it about nothing.
   */
  applicationIds: s.optional(
    s.nullable(
      s.array(s.id('application'), {
        label: 'Applications',
        /*
         * Says that leaving it off is NORMAL, because models treat an optional
         * field as a required one they have not found the value for yet.
         *
         * Measured: "remind me to email the search committee on the 20th" made
         * Gemma list every application and stop to ask which the reminder was
         * for — twice, in two different phrasings, once about six records and
         * once about two. It never created the reminder. Two sentences added to
         * the system prompt did not shift it; this did, because this is what it
         * is reading when it builds the call.
         */
        description:
          'Which applications this is about. Leave it out entirely when the entry does not belong to one — a reminder or a deadline with no application attached is normal and complete.',
      }),
    ),
  ),
}

const cleared = (value: string | undefined) =>
  value === undefined ? undefined : value.trim() || undefined

/**
 * Makes the item about exactly the applications given.
 *
 * A SET operation, not an add: the list replaces whatever was there. `ABOUT` is
 * `fromCardinality: 'many'` now — a reference deadline is genuinely about the
 * three applications it covers — so `tx.link` no longer displaces the previous
 * edge on its own, and the `unlinkAll` is what keeps this a set rather than a
 * pile that only grows.
 *
 * `null` is the spelling of "this is about nothing now". Absent keeps meaning
 * "leave it where it is", or every save of a title would unfile the item.
 */
function fileUnder(
  ctx: ToolContext,
  id: NodeId,
  applicationIds: readonly NodeId[] | null | undefined,
) {
  if (applicationIds === undefined) return
  ctx.tx.unlinkAll(id, { rel: 'ABOUT' })
  if (applicationIds === null) return
  for (const applicationId of applicationIds) ctx.tx.link(id, 'ABOUT', applicationId)
}

export const timelineItemCreate = defineTool({
  name: 'timeline.item.create',
  title: 'Add to the timeline',
  summary: 'Files a dated item — a deadline, an interview, a reminder.',
  effect: 'create',
  touches: ['timelineItem'],
  input: s.object({
    ...fields,
    title: s.string({ min: 1, label: 'Title' }),
    date: s.isoDate({ label: 'Date' }),
    kind: s.enum(TIMELINE_KIND_VALUES, {
      label: 'Kind',
      /*
       * The list is short and none of the words is "reminder", which is the
       * one a model reaches for.
       *
       * Measured: asked to add a reminder to chase an offer, Gemma sent
       * `kind: "reminder"` with `remind: true` — a perfectly sensible reading
       * of the request and not a value this app has. Whether a row APPEARS in
       * Reminders is `remind`; `kind` is what the thing IS. Saying so here is
       * cheaper than the refusal and the retry, which on a local model is
       * several seconds of somebody's evening.
       */
      description:
        'What the entry is. A reminder or a chase is "follow-up" — whether it shows in Reminders is the separate "remind" flag. Paperwork and references are "admin".',
    }),
    /** Something logged after it was done — a call you are recording, not planning. */
    completedOn: s.optional(s.isoDate({ label: 'Completed on' })),
  }),

  run(ctx, input): NodeId {
    const id = ctx.newId('timelineItem')
    ctx.tx.put({
      id,
      type: 'timelineItem',
      props: {
        slug: ctx.mintSlug('timelineItem', input.title),
        title: input.title.trim(),
        date: input.date,
        kind: input.kind,
        urgency: input.urgency ?? 'gray',
        remind: input.remind ?? false,
        ...opt('detail', cleared(input.detail)),
        ...opt('note', cleared(input.note)),
        ...opt('startMins', input.startMins ?? undefined),
        ...opt('durationMins', input.durationMins ?? undefined),
        ...opt('location', cleared(input.location)),
        ...opt('joinUrl', cleared(input.joinUrl)),
        ...opt('completedOn', input.completedOn),
      },
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    fileUnder(ctx, id, input.applicationIds)
    return id
  },

  describe: (input) => ({ title: `${input.title} added`, description: shortDate(input.date) }),
})

export const timelineItemUpdate = defineTool({
  name: 'timeline.item.update',
  title: 'Edit timeline item',
  summary: 'Saves the item — its title, date, time and detail.',
  effect: 'update',
  touches: ['timelineItem'],
  input: s.object({
    id: itemId,
    ...fields,
    /**
     * `null` reopens the item; absent leaves the tick alone.
     *
     * Here as well as on `complete`/`reopen` because a card that restores a
     * before-image hands back every field it changed at once (the Undo in
     * `components/timeline/dialog/ItemForm.tsx`), and a save that dropped this one silently
     * would put back the title and leave the item ticked.
     */
    completedOn: s.optional(s.nullable(s.isoDate({ label: 'Completed on' }))),
  }),

  run(ctx, input) {
    ctx.require('timelineItem', input.id)
    ctx.tx.patch<'timelineItem'>(input.id, {
      ...(input.title === undefined ? {} : { title: input.title.trim() }),
      ...(input.date === undefined ? {} : { date: input.date }),
      ...(input.kind === undefined ? {} : { kind: input.kind }),
      ...(input.urgency === undefined ? {} : { urgency: input.urgency }),
      ...(input.remind === undefined ? {} : { remind: input.remind }),
      ...(input.detail === undefined ? {} : { detail: cleared(input.detail) }),
      ...(input.note === undefined ? {} : { note: cleared(input.note) }),
      ...(input.startMins === undefined ? {} : { startMins: input.startMins ?? undefined }),
      ...(input.durationMins === undefined
        ? {}
        : { durationMins: input.durationMins ?? undefined }),
      ...(input.location === undefined ? {} : { location: cleared(input.location) }),
      ...(input.joinUrl === undefined ? {} : { joinUrl: cleared(input.joinUrl) }),
      ...(input.completedOn === undefined ? {} : { completedOn: input.completedOn ?? undefined }),
    })
    fileUnder(ctx, input.id, input.applicationIds)
  },

  describe: (input, _output, m) => ({
    title: 'Item saved',
    description: m.node(input.id, 'timelineItem')?.props.title ?? '',
  }),
})

export const timelineItemDelete = defineTool({
  name: 'timeline.item.delete',
  title: 'Delete timeline item',
  summary: 'Removes the item from the calendar, the reminders list and the deck.',
  effect: 'delete',
  touches: ['timelineItem'],
  input: s.object({ id: itemId }),

  run(ctx, input) {
    ctx.require('timelineItem', input.id)
    ctx.tx.del(input.id)
  },

  describe: (input, _output, m) => ({
    title: `${m.node(input.id, 'timelineItem')?.props.title ?? 'Item'} deleted`,
    tone: 'danger',
  }),
})

export const timelineItemDuplicate = defineTool({
  name: 'timeline.item.duplicate',
  title: 'Duplicate timeline item',
  summary: 'Copies the item, reopened, keeping its application and its detail.',
  effect: 'create',
  touches: ['timelineItem'],
  input: s.object({ id: itemId }),

  run(ctx, input): NodeId {
    const source = ctx.require('timelineItem', input.id)
    const id = ctx.newId('timelineItem')

    // `completedOn` is deliberately absent from the copy: a duplicate is
    // something still to do, and one that arrives already ticked is a row nobody
    // will ever look at again.
    const { slug: _slug, completedOn: _done, ...rest } = source.props
    ctx.tx.put({
      id,
      type: 'timelineItem',
      props: { ...rest, slug: ctx.mintSlug('timelineItem', source.props.title) },
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })

    // EVERY application, not the first. `ABOUT` is `fromCardinality: 'many'`,
    // and `memory.one` answers with whichever edge it reaches first — so a
    // reference deadline covering three jobs duplicated to one covering a
    // single job, which is a copy that quietly means something else.
    for (const about of ctx.memory.many(input.id, 'ABOUT', 'out', 'application')) {
      ctx.tx.link(id, 'ABOUT', about.id)
    }
    return id
  },

  describe: (_input, id, m) => ({
    title: `${m.node(id, 'timelineItem')?.props.title ?? 'Item'} duplicated`,
  }),
})

/* ------------------------------ done / reopen ----------------------------- */

export const timelineItemComplete = defineTool({
  name: 'timeline.item.complete',
  title: 'Tick off',
  summary: 'Marks the item done, dated today.',
  effect: 'update',
  touches: ['timelineItem'],
  input: s.object({ id: itemId, on: s.optional(s.isoDate({ label: 'Completed on' })) }),

  run(ctx, input) {
    ctx.require('timelineItem', input.id)
    ctx.tx.patch<'timelineItem'>(input.id, { completedOn: input.on ?? dayOf(ctx.now) })
  },

  describe: (input, _output, m) => ({
    title: 'Ticked off',
    description: m.node(input.id, 'timelineItem')?.props.title ?? '',
  }),
})

export const timelineItemReopen = defineTool({
  name: 'timeline.item.reopen',
  title: 'Reopen',
  summary: 'Clears the completion date and puts the item back in the deck.',
  effect: 'update',
  touches: ['timelineItem'],
  input: s.object({ id: itemId }),

  run(ctx, input) {
    ctx.require('timelineItem', input.id)
    // The key is deleted, not set to null. `null` is how the reducer spelled
    // "reopened", and structured clone preserves it — so after a reload
    // `'completedOn' in props` answered yes for an item nobody had completed.
    ctx.tx.patch<'timelineItem'>(input.id, { completedOn: undefined })
  },

  describe: (input, _output, m) => ({
    title: 'Reopened',
    description: m.node(input.id, 'timelineItem')?.props.title ?? '',
  }),
})

/* ------------------------------- rescheduling ----------------------------- */

export const timelineItemSnooze = defineTool({
  name: 'timeline.item.snooze',
  title: 'Snooze',
  summary: 'Pushes the item out by a number of days.',
  effect: 'move',
  touches: ['timelineItem'],
  input: s.object({
    id: itemId,
    days: s.number({ min: 1, max: 365, int: true, label: 'Days' }),
  }),

  run(ctx, input): ISODate {
    const item = ctx.require('timelineItem', input.id)
    const today = dayOf(ctx.now)
    // Counted from today when the item is already overdue — otherwise "snooze a
    // day" on something eight days late leaves it seven days late.
    const from = item.props.date < today ? today : item.props.date
    const date = addDays(from, input.days)
    ctx.tx.patch<'timelineItem'>(input.id, { date })
    return date
  },

  describe: (input, date, m) => ({
    title: `Snoozed to ${shortDate(date)}`,
    description: m.node(input.id, 'timelineItem')?.props.title ?? '',
  }),
})

export const timelineItemReschedule = defineTool({
  name: 'timeline.item.reschedule',
  title: 'Reschedule',
  summary: 'Moves the item to another day, and optionally another time.',
  effect: 'move',
  touches: ['timelineItem'],
  input: s.object({
    id: itemId,
    date: s.isoDate({ label: 'Date' }),
    startMins: s.optional(s.number({ min: 0, max: 1439, int: true, label: 'Starts at' })),
  }),

  run(ctx, input) {
    ctx.require('timelineItem', input.id)
    ctx.tx.patch<'timelineItem'>(input.id, {
      date: input.date,
      ...(input.startMins === undefined ? {} : { startMins: input.startMins }),
    })
  },

  describe: (input, _output, m) => ({
    title: `Moved to ${shortDate(input.date)}`,
    description: m.node(input.id, 'timelineItem')?.props.title ?? '',
  }),
})

export const timelineItemRemindSet = defineTool({
  name: 'timeline.item.remind.set',
  title: 'Show in Reminders',
  summary: "Adds or removes the item from the Vault's reminders list.",
  effect: 'update',
  touches: ['timelineItem'],
  input: s.object({ id: itemId, remind: s.boolean({ label: 'Show in Reminders' }) }),

  run(ctx, input) {
    ctx.require('timelineItem', input.id)
    ctx.tx.patch<'timelineItem'>(input.id, { remind: input.remind })
  },

  describe: (input) => ({
    title: input.remind ? 'Added to Reminders' : 'Removed from Reminders',
  }),
})
