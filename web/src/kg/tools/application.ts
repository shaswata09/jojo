/**
 * L3 — the application tools.
 *
 * The composites here are the reason the tool layer exists. `application.create`
 * used to be four writes in a component: the record, the keyword set, the
 * deadline item, and the toast that described all three (`ApplicationDialog.tsx`
 * :334-354). Nothing made them atomic and nothing could undo them together, so a
 * failure between the second and the third left an application tagged with
 * keywords and missing the deadline the toast had just promised was on the
 * calendar. One transaction, one journal row, one Undo.
 *
 * `org` is no longer a string on the record. It is an `AT` edge to an
 * organisation node, because an employer is something the user can rename — and
 * renaming it used to mean editing every application that named it, or living
 * with two spellings that the sources breakdown counted separately.
 */

import { shortDate } from '@/data/timeline'
import { ROLES, SOURCES } from '@/kg/core/model'
import type { ISODate, NodeId, Outcome } from '@/kg/core/model'
import { foldName } from '@/kg/core/ref'
import { s } from '@/kg/core/schema'
import { defineTool } from './tool'
import type { ToolContext } from './tool'
import {
  DEADLINE_DETAIL,
  STAGE_IDS,
  STAGE_LABEL,
  TIMELINE_KINDS,
  URGENCIES,
  applicationDeadlineOf,
  dayOf,
  opt,
  deadlineUrgency,
  displayOf,
  touch,
} from './support'

const OUTCOMES = [
  'rejected',
  'withdrawn',
  'accepted',
  'declined',
  'ghosted',
] as const satisfies readonly Outcome[]

const appId = s.id('application', { label: 'Application' })

/** Every field the form can write, all optional, shared by create and update. */
const fields = {
  org: s.optional(s.string({ min: 1, label: 'Employer' })),
  role: s.optional(s.string({ label: 'Role' })),
  roleTag: s.optional(s.enum(ROLES, { label: 'Role type' })),
  stage: s.optional(s.enum(STAGE_IDS, { label: 'Stage' })),
  note: s.optional(s.string({ label: 'Note', multiline: true })),
  source: s.optional(s.enum(SOURCES, { label: 'Where it came from' })),
  location: s.optional(s.string({ label: 'Location' })),
  comp: s.optional(s.string({ label: 'Compensation' })),
  url: s.optional(s.string({ label: 'Posting link' })),
}

const offerShape = s.object({
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
const cleared = (value: string | undefined) =>
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
function syncDeadline(ctx: ToolContext, id: NodeId, deadline: ISODate | null | undefined) {
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
      applicationId: id,
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
function syncKeywords(ctx: ToolContext, id: NodeId, keywords: readonly NodeId[] | undefined) {
  if (keywords === undefined) return
  ctx.call('keyword.record.set', { record: id, keywords: [...keywords] })
}

/* ------------------------------- org.ensure ------------------------------- */

export const orgEnsure = defineTool({
  name: 'org.ensure',
  title: 'Find or add an employer',
  summary: 'Returns the organisation with this name, creating it if it is new.',
  effect: 'create',
  touches: ['organisation'],
  internal: true,
  input: s.object({ name: s.string({ min: 1, label: 'Employer' }) }),

  run(ctx, input): NodeId {
    const name = input.name.trim()
    // Matched on the folded NAME, not on the slug of it — the rule `labels.tsx`
    // :41-53 arrived at for keywords, for the same reason. After a rename a slug
    // says nothing about what the record is called, so a slug match would miss
    // 'Rice' spelled 'rice-2' and stand a second Rice up beside it.
    const existing = ctx.memory
      .ofType('organisation')
      .find((o) => foldName(o.props.name) === foldName(name))
    if (existing) return existing.id

    const id = ctx.newId('organisation')
    ctx.tx.put({
      id,
      type: 'organisation',
      props: { slug: ctx.mintSlug('organisation', name), name },
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    return id
  },

  describe: (input) => ({ title: `${input.name} added` }),
})

/* ------------------------------ create/update ----------------------------- */

export const applicationCreate = defineTool({
  name: 'application.create',
  title: 'Add application',
  summary: 'Files a new application, with its employer, keywords and deadline.',
  effect: 'create',
  touches: ['application'],
  input: s.object({
    ...fields,
    org: s.string({ min: 1, label: 'Employer' }),
    role: s.string({ label: 'Role' }),
    roleTag: s.enum(ROLES, { label: 'Role type' }),
    stage: s.enum(STAGE_IDS, { label: 'Stage' }),
    lastAction: s.optional(s.string()),
    deadline: s.optional(s.isoDate({ label: 'Deadline' })),
    keywords: s.optional(s.array(s.id('keyword'), { label: 'Keywords' })),
    /**
     * The fields a logged-late application arrives with.
     *
     * People add an interview they are already booked for, and the dialog offers
     * every stage on the create form. Without these the record would be filed at
     * Interview with no date it ever happened on, and the only way to add one
     * would be to edit the row you had just saved.
     */
    flagged: s.optional(s.boolean({ label: 'Needs attention' })),
    appliedOn: s.optional(s.isoDate({ label: 'Applied on' })),
    submittedOn: s.optional(s.isoDate({ label: 'Submitted on' })),
    firstReplyOn: s.optional(s.isoDate({ label: 'First reply' })),
    outcome: s.optional(s.enum(OUTCOMES, { label: 'Outcome' })),
    offer: s.optional(offerShape),
  }),

  run(ctx, input): NodeId {
    const id = ctx.newId('application')
    const org = ctx.call('org.ensure', { name: input.org })

    ctx.tx.put({
      id,
      type: 'application',
      props: {
        slug: ctx.mintSlug('application', input.org),
        role: input.role.trim(),
        note: input.note?.trim() ?? '',
        roleTag: input.roleTag,
        stage: input.stage,
        // 'Draft created' is a lie for anything logged at a later stage, and
        // people do add an interview they are already booked for.
        lastAction:
          input.lastAction ??
          (input.stage === 'draft' ? 'Draft created' : `Added at ${STAGE_LABEL[input.stage]}`),
        lastActionAt: ctx.now,
        ...opt('source', input.source),
        ...opt('location', cleared(input.location)),
        ...opt('comp', cleared(input.comp)),
        ...opt('url', cleared(input.url)),
        ...opt('flagged', input.flagged || undefined),
        ...opt('appliedOn', input.appliedOn),
        ...opt('submittedOn', input.submittedOn),
        ...opt('firstReplyOn', input.firstReplyOn),
        ...opt('outcome', input.outcome),
        ...opt('offer', input.offer),
      },
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })

    ctx.tx.link(id, 'AT', org)
    syncKeywords(ctx, id, input.keywords)
    syncDeadline(ctx, id, input.deadline)
    return id
  },

  describe: (input, id, m) => ({
    title: `${displayOf(m, id)} added`,
    description: input.deadline
      ? `Deadline ${shortDate(input.deadline)} is on the calendar.`
      : 'No deadline yet — add one and it shows up in This week.',
  }),
})

export const applicationUpdate = defineTool({
  name: 'application.update',
  title: 'Edit application',
  summary: 'Saves the form: fields, keywords, and the deadline it owns.',
  effect: 'update',
  touches: ['application'],
  input: s.object({
    id: appId,
    ...fields,
    source: s.optional(s.nullable(s.enum(SOURCES, { label: 'Where it came from' }))),
    keywords: s.optional(s.array(s.id('keyword'), { label: 'Keywords' })),
    /** `null` empties it; absent leaves it alone. The two are not the same. */
    deadline: s.optional(s.nullable(s.isoDate({ label: 'Deadline' }))),
    /**
     * The rest of the record, all `null`-to-clear.
     *
     * The catalogue writes this tool's second argument as `patch`, and it has to
     * be the whole record or it is not one: `ApplicationDetail.tsx:268` restores
     * a before-image by handing back every field it changed, offer and outcome
     * included, and a schema that silently dropped five of them would have made
     * that undo look like it worked while leaving the offer on a closed
     * application.
     */
    lastAction: s.optional(s.string()),
    /**
     * The activity timestamp, restored rather than stamped.
     *
     * Every write counts as activity and `touch` stamps `now`, which is right
     * for an edit and wrong for the undo of one: `Applications.tsx:154-162`
     * snapshots the three fields a stage move rewrites precisely because a row
     * put back at "touched today" sorts to the top of the list it was never at
     * the top of, and that list's default sort is this field.
     */
    lastActionAt: s.optional(s.instant()),
    flagged: s.optional(s.nullable(s.boolean({ label: 'Needs attention' }))),
    appliedOn: s.optional(s.nullable(s.isoDate({ label: 'Applied on' }))),
    submittedOn: s.optional(s.nullable(s.isoDate({ label: 'Submitted on' }))),
    firstReplyOn: s.optional(s.nullable(s.isoDate({ label: 'First reply' }))),
    outcome: s.optional(s.nullable(s.enum(OUTCOMES, { label: 'Outcome' }))),
    offer: s.optional(s.nullable(offerShape)),
  }),

  run(ctx, input) {
    const current = ctx.require('application', input.id)
    const moved = input.stage !== undefined && input.stage !== current.props.stage

    if (input.org !== undefined) {
      ctx.tx.link(input.id, 'AT', ctx.call('org.ensure', { name: input.org }))
    }

    ctx.tx.patch<'application'>(input.id, {
      ...(input.role === undefined ? {} : { role: input.role.trim() }),
      ...(input.roleTag === undefined ? {} : { roleTag: input.roleTag }),
      ...(input.stage === undefined ? {} : { stage: input.stage }),
      ...(input.note === undefined ? {} : { note: input.note.trim() }),
      ...(input.source === undefined ? {} : { source: input.source ?? undefined }),
      ...(input.location === undefined ? {} : { location: cleared(input.location) }),
      ...(input.comp === undefined ? {} : { comp: cleared(input.comp) }),
      ...(input.url === undefined ? {} : { url: cleared(input.url) }),
      // `?? undefined` on a nullable field DELETES the key rather than storing
      // the null — the round-trip bug D21 names, where a stored `{ offer: null }`
      // survives structured clone as a present key and every `in` check that
      // guards the offer block answers the wrong way.
      ...(input.flagged === undefined ? {} : { flagged: input.flagged || undefined }),
      ...(input.appliedOn === undefined ? {} : { appliedOn: input.appliedOn ?? undefined }),
      ...(input.submittedOn === undefined ? {} : { submittedOn: input.submittedOn ?? undefined }),
      ...(input.firstReplyOn === undefined
        ? {}
        : { firstReplyOn: input.firstReplyOn ?? undefined }),
      ...(input.outcome === undefined ? {} : { outcome: input.outcome ?? undefined }),
      ...(input.offer === undefined ? {} : { offer: input.offer ?? undefined }),
    })

    touch(
      ctx,
      input.id,
      input.lastAction ??
        (moved && input.stage ? `Moved to ${STAGE_LABEL[input.stage]}` : 'Details edited'),
    )
    // After `touch`, which has just stamped `now` over it.
    if (input.lastActionAt !== undefined) {
      ctx.tx.patch<'application'>(input.id, { lastActionAt: input.lastActionAt })
    }
    syncKeywords(ctx, input.id, input.keywords)
    syncDeadline(ctx, input.id, input.deadline)
  },

  describe: (input, _output, m) => ({
    title: 'Changes saved',
    description:
      input.deadline === null
        ? `${displayOf(m, input.id)} — its deadline is off the calendar.`
        : displayOf(m, input.id),
  }),
})

/* --------------------------------- delete --------------------------------- */

export const applicationDelete = defineTool({
  name: 'application.delete',
  title: 'Delete application',
  summary: 'Removes the application. Everything filed under it survives, unlinked.',
  effect: 'delete',
  touches: ['application'],
  input: s.object({ id: appId }),

  run(ctx, input) {
    ctx.require('application', input.id)
    // `tx.del` drops the node and its edges and touches nothing at the other
    // end. That is D15 said in graph: the reference-letter tracker filed under
    // one application is a document in its own right, and a dialog saying
    // "delete Rice" cannot fairly be read as consent to delete the four files
    // someone spent an evening on.
    ctx.tx.del(input.id)
  },

  describe: (input, _output, m) => ({
    title: `${displayOf(m, input.id) || 'Application'} deleted`,
    description: 'Anything filed under it is still in the Vault.',
    tone: 'danger',
  }),
})

export const applicationDuplicate = defineTool({
  name: 'application.duplicate',
  title: 'Duplicate application',
  summary: 'The same posting, applied for again — back to draft, with a copy link.',
  effect: 'create',
  touches: ['application'],
  input: s.object({ id: appId }),

  run(ctx, input): NodeId {
    const source = ctx.require('application', input.id)
    const org = ctx.memory.one(input.id, 'AT', 'organisation')
    const id = ctx.newId('application')

    // Listed key by key rather than spread-and-clear. The offer, outcome and
    // dates belong to the attempt that earned them, and a copy carrying someone
    // else's offer is worse than no copy at all — `flagged` goes for the same
    // reason, it was a note-to-self about the round that just ended. A spread
    // with six `undefined` overrides would silently gain every field added to
    // ApplicationProps after today, which is the wrong default here.
    ctx.tx.put({
      id,
      type: 'application',
      props: {
        slug: ctx.mintSlug('application', org?.props.name ?? source.props.slug),
        role: source.props.role,
        note: source.props.note,
        roleTag: source.props.roleTag,
        stage: 'draft',
        lastAction: 'Duplicated',
        lastActionAt: ctx.now,
        ...opt('source', source.props.source),
        ...opt('location', source.props.location),
        ...opt('comp', source.props.comp),
        ...opt('url', source.props.url),
      },
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })

    if (org) ctx.tx.link(id, 'AT', org.id)
    // The edge `duplicate()` never wrote. Without it the two rows drifted apart
    // with no record that they had ever been the same job.
    ctx.tx.link(id, 'COPY_OF', input.id)
    return id
  },

  describe: (_input, id, m) => ({
    title: `${displayOf(m, id)} duplicated`,
    description: 'The copy is back at Draft, with the dates and any offer cleared.',
  }),
})

/* -------------------------------- one-field ------------------------------- */

export const applicationNoteSet = defineTool({
  name: 'application.note.set',
  title: 'Edit note',
  summary: "Replaces the application's note.",
  effect: 'update',
  touches: ['application'],
  input: s.object({ id: appId, note: s.string({ label: 'Note', multiline: true }) }),

  run(ctx, input) {
    ctx.require('application', input.id)
    ctx.tx.patch<'application'>(input.id, { note: input.note.trim() })
    touch(ctx, input.id, 'Note edited')
  },

  describe: () => ({ title: 'Note saved' }),
})

/**
 * Was a toggle.
 *
 * By the time an undo fires the flag may have been cleared elsewhere, and
 * toggling again would set it — a fact this codebase already writes down three
 * times (`PriorityActions.tsx:69-71`, `RemindersTool.tsx:497-499`,
 * `OwedThisWeek.tsx:177`). The card reads the current value and asks for the one
 * it wants.
 */
export const applicationFlagSet = defineTool({
  name: 'application.flag.set',
  title: 'Flag application',
  summary: 'Marks the application as needing attention, or clears the mark.',
  effect: 'update',
  touches: ['application'],
  input: s.object({ id: appId, flagged: s.boolean({ label: 'Needs attention' }) }),

  run(ctx, input) {
    ctx.require('application', input.id)
    ctx.tx.patch<'application'>(input.id, { flagged: input.flagged || undefined })
  },

  describe: (input, _output, m) => ({
    title: input.flagged ? 'Flagged' : 'Flag cleared',
    description: displayOf(m, input.id),
  }),
})

export const applicationStageSet = defineTool({
  name: 'application.stage.set',
  title: 'Move to stage',
  summary: 'Moves the application to another stage, with nothing attached.',
  effect: 'move',
  touches: ['application'],
  input: s.object({ id: appId, stage: s.enum(STAGE_IDS, { label: 'Stage' }) }),

  run(ctx, input) {
    ctx.require('application', input.id)
    ctx.tx.patch<'application'>(input.id, { stage: input.stage })
    touch(ctx, input.id, `Moved to ${STAGE_LABEL[input.stage]}`)
  },

  describe: (input, _output, m) => ({
    title: `${displayOf(m, input.id)} — ${STAGE_LABEL[input.stage]}`,
    description: 'Nothing else on the record changed.',
  }),
})

/**
 * The stage change with everything the dialog collects attached.
 *
 * Up to five field writes and a minted timeline item, which used to land as two
 * separate store calls in one tick with nothing making them atomic
 * (`StageTransitionDialog.tsx:203-304`). A failure between them left an
 * application at Interview with no interview on the calendar.
 */
export const applicationStageAdvance = defineTool({
  name: 'application.stage.advance',
  title: 'Record a stage change',
  summary: 'Moves the stage and records the dates, outcome or offer that came with it.',
  effect: 'move',
  touches: ['application'],
  input: s.object({
    id: appId,
    stage: s.enum(STAGE_IDS, { label: 'Stage' }),
    lastAction: s.optional(s.string()),
    appliedOn: s.optional(s.isoDate({ label: 'Applied on' })),
    submittedOn: s.optional(s.isoDate({ label: 'Submitted on' })),
    firstReplyOn: s.optional(s.isoDate({ label: 'First reply' })),
    url: s.optional(s.string({ label: 'Portal link' })),
    outcome: s.optional(s.enum(OUTCOMES, { label: 'Outcome' })),
    offer: s.optional(offerShape),
    /** True when the user chose not to keep an offer they are moving away from. */
    clearOffer: s.optional(s.boolean()),
    mint: s.optional(
      s.object({
        title: s.string({ min: 1 }),
        detail: s.optional(s.string()),
        date: s.isoDate(),
        kind: s.enum(TIMELINE_KINDS),
        urgency: s.optional(s.enum(URGENCIES)),
        location: s.optional(s.string()),
        remind: s.optional(s.boolean()),
      }),
    ),
  }),

  run(ctx, input) {
    const current = ctx.require('application', input.id)

    ctx.tx.patch<'application'>(input.id, {
      stage: input.stage,
      // Only filled where it was empty: the day you first applied is not the day
      // you got round to recording the submission.
      ...(input.appliedOn === undefined || current.props.appliedOn !== undefined
        ? {}
        : { appliedOn: input.appliedOn }),
      ...(input.submittedOn === undefined ? {} : { submittedOn: input.submittedOn }),
      ...(input.firstReplyOn === undefined ? {} : { firstReplyOn: input.firstReplyOn }),
      ...(cleared(input.url) === undefined ? {} : { url: cleared(input.url) }),
      ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
      ...(input.offer === undefined ? {} : { offer: input.offer }),
      ...(input.clearOffer ? { offer: undefined } : {}),
    })

    touch(ctx, input.id, input.lastAction ?? `Moved to ${STAGE_LABEL[input.stage]}`)

    if (input.mint) {
      ctx.call('timeline.item.create', {
        ...input.mint,
        applicationId: input.id,
        remind: input.mint.remind ?? true,
      })
    }
  },

  describe: (input, _output, m) => ({
    title: `${displayOf(m, input.id)} — ${STAGE_LABEL[input.stage]}`,
    ...(input.mint
      ? { description: `${input.mint.title} — ${shortDate(input.mint.date)} is on your calendar.` }
      : {}),
  }),
})

/* ---------------------------------- offer --------------------------------- */

const OUTCOME_ACTION: Record<'accepted' | 'declined', string> = {
  accepted: 'Offer accepted',
  declined: 'Offer declined',
}

export const applicationOfferDecide = defineTool({
  name: 'application.offer.decide',
  title: 'Decide on an offer',
  summary: 'Records the offer as accepted or declined and closes the application.',
  effect: 'update',
  touches: ['application'],
  input: s.object({
    id: appId,
    outcome: s.enum(['accepted', 'declined'] as const, { label: 'Decision' }),
  }),

  available(m, input) {
    const id = input?.id
    if (id === undefined) return { ok: true }
    const app = m.node(id, 'application')
    if (!app?.props.offer) return { ok: false, reason: 'There is no offer to decide on.' }
    return { ok: true }
  },

  run(ctx, input) {
    ctx.require('application', input.id)
    // The offer details stay. Turning a job down does not un-happen the offer,
    // and the record is the only place the package was ever written down.
    ctx.tx.patch<'application'>(input.id, { stage: 'closed', outcome: input.outcome })
    touch(ctx, input.id, OUTCOME_ACTION[input.outcome])
  },

  describe: (input, _output, m) => ({
    title: OUTCOME_ACTION[input.outcome],
    description: displayOf(m, input.id),
    ...(input.outcome === 'declined' ? { tone: 'danger' as const } : {}),
  }),
})

export const applicationOfferClear = defineTool({
  name: 'application.offer.clear',
  title: 'Clear offer details',
  summary: 'Drops the offer package from an application that has moved on.',
  effect: 'update',
  touches: ['application'],
  input: s.object({ id: appId }),

  run(ctx, input) {
    ctx.require('application', input.id)
    ctx.tx.patch<'application'>(input.id, { offer: undefined })
    touch(ctx, input.id, 'Offer details cleared')
  },

  describe: (input, _output, m) => ({
    title: 'Offer details cleared',
    description: displayOf(m, input.id),
    tone: 'danger',
  }),
})
