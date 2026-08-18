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
  applicationId: s.optional(s.nullable(s.id('application', { label: 'Application' }))),
}

const cleared = (value: string | undefined) =>
  value === undefined ? undefined : value.trim() || undefined

/**
 * Files the item under an application, or leaves the edge alone.
 *
 * `ABOUT` is `fromCardinality: 'one'`, so a second link replaces the first in
 * the same commit. That is what the old scalar `applicationId` meant and never
 * enforced — nothing stopped a write leaving a reminder about two applications.
 */
function fileUnder(ctx: ToolContext, id: NodeId, applicationId: NodeId | null | undefined) {
  if (applicationId === undefined) return
  // `null` is the spelling of "this is about nothing now". Absent had to keep
  // meaning "leave it where it is", or every save of a title would have
  // unfiled the item from the application it was about.
  if (applicationId === null) ctx.tx.unlinkAll(id, { rel: 'ABOUT' })
  else ctx.tx.link(id, 'ABOUT', applicationId)
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
    kind: s.enum(TIMELINE_KIND_VALUES, { label: 'Kind' }),
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
    fileUnder(ctx, id, input.applicationId)
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
    fileUnder(ctx, input.id, input.applicationId)
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

    const about = ctx.memory.one(input.id, 'ABOUT', 'application')
    if (about) ctx.tx.link(id, 'ABOUT', about.id)
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
