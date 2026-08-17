/**
 * L3 — the application form's save path: find the employer, then create or update.
 *
 * The composites here are the reason the tool layer exists. `application.create`
 * used to be four writes in a component: the record, the keyword set, the
 * deadline item, and the toast that described all three (`create` in
 * `components/applications/dialog/use-application-writes.ts`).
 * Nothing made them atomic and nothing could undo them together, so a
 * failure between the second and the third left an application tagged with
 * keywords and missing the deadline the toast had just promised was on the
 * calendar. One transaction, one journal row, one Undo.
 *
 * `org` is no longer a string on the record. It is an `AT` edge to an
 * organisation node, because an employer is something the user can rename — and
 * renaming it used to mean editing every application that named it, or living
 * with two spellings that the sources breakdown counted separately.
 *
 * The rest of the application tools sit beside this file: the shared input
 * schema and the two writes the form owns in `application-fields.ts`, delete,
 * duplicate and the one-field edits in `application-record.ts`, and the stage
 * and offer tools in `application-stage.ts`.
 */

import { shortDate } from '@/kg/core/dates'
import { OUTCOME_VALUES, ROLES, SOURCES, STAGE_VALUES } from '@/kg/core/model'
import type { NodeId } from '@/kg/core/model'
import { foldName } from '@/kg/core/ref'
import { s } from '@/kg/core/schema'
import {
  appId,
  cleared,
  fields,
  offerShape,
  syncDeadline,
  syncKeywords,
} from './application-fields'
import { STAGE_LABEL, displayOf, opt, touch } from './support'
import { defineTool } from './tool'

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
    // Matched on the folded NAME, not on the slug of it — the rule `foldName`
    // states, arrived at for keywords, for the same reason. After a rename a slug
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
    stage: s.enum(STAGE_VALUES, { label: 'Stage' }),
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
    outcome: s.optional(s.enum(OUTCOME_VALUES, { label: 'Outcome' })),
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
     * be the whole record or it is not one: `revertOf` in
     * `routes/ApplicationDetail.tsx` restores
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
     * for an edit and wrong for the undo of one: `onSetStage` in
     * `components/applications/use-row-actions.tsx` snapshots the three fields
     * a stage move rewrites precisely because a row
     * put back at "touched today" sorts to the top of the list it was never at
     * the top of, and that list's default sort is this field.
     */
    lastActionAt: s.optional(s.instant()),
    flagged: s.optional(s.nullable(s.boolean({ label: 'Needs attention' }))),
    appliedOn: s.optional(s.nullable(s.isoDate({ label: 'Applied on' }))),
    submittedOn: s.optional(s.nullable(s.isoDate({ label: 'Submitted on' }))),
    firstReplyOn: s.optional(s.nullable(s.isoDate({ label: 'First reply' }))),
    outcome: s.optional(s.nullable(s.enum(OUTCOME_VALUES, { label: 'Outcome' }))),
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
