/**
 * L3 — the scout tools: saved postings, matches and pipelines.
 *
 * `draftFromUrl` and `draftFromText` are imported from `kg/core/parse-posting`.
 * They used to live in `components/applications/draft-from`, which meant the
 * store — a domain write — reached UP into a component folder for URL parsing
 * (the removed `store-context.ts`). That is the one existing layer violation the plan
 * names, and it is fixed by moving the parser DOWN rather than by moving the
 * caller up. If you are tempted to tidy it back into `components/` because the
 * dialog also uses it: the dialog imports it from core too, and a domain write
 * that has to reach into the UI is how the boundary went in the first place.
 *
 * Promotion links, it does not move. The match stays in the feed carrying its fit
 * score, because the feed is generated and there is nothing to press to get one
 * suggestion back — a mis-click that consumed the row would be unrecoverable.
 * `SavedPosting.linked` was that idea stored as a boolean and kept in step by
 * hand across four write sites; it is now the presence of a `BECAME` edge.
 */

import type { NodeId } from '../core/model'
import { draftFromText, draftFromUrl, roleFromTitle } from '../core/parse-posting'
import { ROLES } from '../core/model'
import { s } from '../core/schema'
import { defineTool } from './tool'
import { dayOf, displayOf, guessRoleTag } from './support'

const postingId = s.id('posting', { label: 'Posting' })
const matchId = s.id('match', { label: 'Match' })
const pipelineId = s.id('pipeline', { label: 'Pipeline' })
const roleTag = s.optional(s.enum(ROLES, { label: 'Role type' }))

/* -------------------------------- postings -------------------------------- */

export const scoutPostingSave = defineTool({
  name: 'scout.posting.save',
  title: 'Save posting',
  summary: 'Files a job advert’s URL. No page is fetched — nothing here can.',
  effect: 'create',
  touches: ['posting'],
  input: s.object({
    url: s.string({ min: 1, label: 'Posting link' }),
    title: s.optional(s.string({ label: 'Title' })),
    size: s.optional(s.string()),
    savedOn: s.optional(s.isoDate()),
    pipelineId: s.optional(s.id('pipeline')),
  }),

  run(ctx, input): NodeId {
    const url = input.url.trim()
    const guess = draftFromUrl(url)
    // The title is a guess made from the URL, offered so the row is readable —
    // the record says what it is, which is a link you kept.
    const title = input.title?.trim() || [guess.org, guess.role].filter(Boolean).join(' — ') || url

    const id = ctx.newId('posting')
    ctx.tx.put({
      id,
      type: 'posting',
      props: {
        slug: ctx.mintSlug('posting', title),
        title,
        url,
        savedOn: input.savedOn ?? dayOf(ctx.now),
        size: input.size ?? '—',
      },
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    if (input.pipelineId !== undefined) ctx.tx.link(id, 'FROM', input.pipelineId)
    return id
  },

  describe: (_input, id, m) => ({
    title: 'Posting saved',
    description: m.node(id, 'posting')?.props.title ?? '',
  }),
})

export const scoutPostingDelete = defineTool({
  name: 'scout.posting.delete',
  title: 'Remove posting',
  summary: 'Removes the saved posting. Any application made from it stays.',
  effect: 'delete',
  touches: ['posting'],
  input: s.object({ id: postingId }),

  run(ctx, input) {
    ctx.require('posting', input.id)
    ctx.tx.del(input.id)
  },

  describe: (input, _output, m) => ({
    title: 'Posting removed',
    description: m.node(input.id, 'posting')?.props.title ?? '',
    tone: 'danger',
  }),
})

/**
 * The saved posting, applied for.
 *
 * Without it a saved posting was a dead end: the panel offered it as "enough …
 * to apply from" and then gave you nothing to apply with, while the matches
 * directly above carried "Add to applications".
 *
 * The employer is read out of the URL and not out of the title. A title is
 * either a guess `draftFromUrl` already made from that same URL, or — for the
 * seeded rows — prose written the other way round ('Assistant Professor of
 * Computer Science — Rice University'), which would file the application under a
 * job title. The title only gets a turn at naming the employer when the URL
 * names nobody.
 *
 * The ROLE is a different question and used to share that answer, which is the
 * bug: a URL that named the employer ended the enquiry, so the Rice posting
 * promoted to an application displayed as bare 'Rice' with an empty Role — the
 * job title sitting unread in the row the user had just pressed. `roleFromTitle`
 * drops the employer out of the title and keeps the rest, so the title seeds the
 * role whichever way round it is written.
 */
export const scoutPostingPromote = defineTool({
  name: 'scout.posting.promote',
  title: 'Add posting to applications',
  summary: 'Starts an application from a saved posting and links the two.',
  effect: 'create',
  touches: ['posting', 'application'],
  input: s.object({ id: postingId, roleTag }),

  run(ctx, input): NodeId {
    const posting = ctx.require('posting', input.id)
    const guess = draftFromUrl(posting.props.url)
    const named = guess.org ? guess : { ...guess, ...draftFromText(posting.props.title) }
    const org = named.org || posting.props.title
    // The URL's reading wins when it has one — it is the more structured
    // source, and a slug is the job spelled the way the employer files it.
    const role = named.role || roleFromTitle(posting.props.title, org)

    const application = ctx.call('application.create', {
      org,
      role,
      // Blank rather than a sentence about where this came from: `lastAction`
      // already says that, and the note field belongs to the user.
      note: '',
      roleTag: input.roleTag ?? guessRoleTag(`${posting.props.title} ${role}`),
      stage: 'draft',
      // Where the ad lives, the same reading the paste field on /applications
      // takes. 'Job scout' is reserved for what a pipeline found by itself.
      ...(named.source === undefined ? {} : { source: named.source }),
      url: named.url ?? posting.props.url,
      lastAction: 'Added from a saved posting',
    })

    ctx.tx.link(input.id, 'BECAME', application)
    return application
  },

  describe: (_input, id, m) => ({
    title: `${displayOf(m, id)} added as a draft`,
    description: 'The posting stays saved here, now linked to the application.',
  }),
})

/**
 * The plain edit of a saved posting.
 *
 * Absent from §4's catalogue, which lists only save / delete / promote, because
 * nothing in the UI edits a posting today. It exists because `useScout()` has
 * always exposed `updatePosting`, and a compatibility hook that answered "there
 * is no tool for that" would be a silent no-op at a call site the compiler had
 * just told the author was fine.
 */
export const scoutPostingUpdate = defineTool({
  name: 'scout.posting.update',
  title: 'Edit posting',
  summary: 'Saves the posting’s title, link and where it is filed.',
  effect: 'update',
  touches: ['posting'],
  input: s.object({
    id: postingId,
    title: s.optional(s.string({ min: 1, label: 'Title' })),
    url: s.optional(s.string({ min: 1, label: 'Posting link' })),
    size: s.optional(s.string()),
    savedOn: s.optional(s.isoDate()),
    /** `null` unlinks the application it became. */
    applicationId: s.optional(s.nullable(s.id('application'))),
  }),

  run(ctx, input) {
    ctx.require('posting', input.id)
    ctx.tx.patch<'posting'>(input.id, {
      ...(input.title === undefined ? {} : { title: input.title.trim() }),
      ...(input.url === undefined ? {} : { url: input.url.trim() }),
      ...(input.size === undefined ? {} : { size: input.size }),
      ...(input.savedOn === undefined ? {} : { savedOn: input.savedOn }),
    })
    if (input.applicationId === null) ctx.tx.unlinkAll(input.id, { rel: 'BECAME' })
    else if (input.applicationId !== undefined) {
      ctx.tx.link(input.id, 'BECAME', input.applicationId)
    }
  },

  describe: (input, _output, m) => ({
    title: 'Posting saved',
    description: m.node(input.id, 'posting')?.props.title ?? '',
  }),
})

/* --------------------------------- matches -------------------------------- */

/**
 * A match, written down.
 *
 * `internal` because nothing user-facing creates one: the feed is generated, and
 * until a model is connected the only source is the fixtures.
 *
 * UNREACHABLE TODAY, AND KEPT ANYWAY — the reason, stated plainly, because it
 * has now been wrong twice.
 *
 * It first said "`useScout().addMatch` is part of a signature 36 files compile
 * against". That was false: the 36 was the importer count of the deleted
 * `store-context.ts` façade, carried onto a hook it was never about. It was then
 * rewritten to say the tool is retained because "the hook exposes it" — and in
 * the same pass `use-scout.ts` deleted `addMatch` for having no caller. The two
 * files ended up each citing the other, and neither claim was true.
 *
 * The honest reason: this is the only one of the twelve scout tools with no hook
 * method, because it is the only one that CREATES a record the user does not
 * author. Postings, pipelines and the rest are user actions; matches are
 * generated by a feed, and until a source is connected the only source is the
 * fixtures. Deleting it would leave the feed able to update, promote and dismiss
 * a match but not make one — an incoherent registry on the day a real source
 * arrives, which is a worse trade than one tool that nothing calls yet.
 *
 * It is `internal: true`, so it is not offered in the palette and carries no UI
 * surface. If scout is dropped, this goes with the other eleven.
 */
export const scoutMatchSave = defineTool({
  name: 'scout.match.save',
  title: 'Add match',
  summary: 'Records a suggested posting in the scout feed.',
  effect: 'create',
  touches: ['match'],
  internal: true,
  input: s.object({
    role: s.string({ min: 1, label: 'Role' }),
    detail: s.string({ label: 'Detail' }),
    fit: s.number({ min: 0, max: 100, label: 'Fit' }),
    applicationId: s.optional(s.nullable(s.id('application'))),
  }),

  run(ctx, input): NodeId {
    const id = ctx.newId('match')
    ctx.tx.put({
      id,
      type: 'match',
      props: {
        slug: ctx.mintSlug('match', input.role),
        role: input.role.trim(),
        detail: input.detail,
        fit: input.fit,
      },
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    if (input.applicationId) ctx.tx.link(id, 'BECAME', input.applicationId)
    return id
  },

  describe: (input) => ({ title: 'Match added', description: input.role.trim() }),
})

export const scoutMatchUpdate = defineTool({
  name: 'scout.match.update',
  title: 'Edit match',
  summary: 'Saves the match’s wording, score and the application it became.',
  effect: 'update',
  touches: ['match'],
  internal: true,
  input: s.object({
    id: matchId,
    role: s.optional(s.string({ min: 1, label: 'Role' })),
    detail: s.optional(s.string({ label: 'Detail' })),
    fit: s.optional(s.number({ min: 0, max: 100, label: 'Fit' })),
    applicationId: s.optional(s.nullable(s.id('application'))),
  }),

  run(ctx, input) {
    ctx.require('match', input.id)
    ctx.tx.patch<'match'>(input.id, {
      ...(input.role === undefined ? {} : { role: input.role.trim() }),
      ...(input.detail === undefined ? {} : { detail: input.detail }),
      ...(input.fit === undefined ? {} : { fit: input.fit }),
    })
    if (input.applicationId === null) ctx.tx.unlinkAll(input.id, { rel: 'BECAME' })
    else if (input.applicationId !== undefined) {
      ctx.tx.link(input.id, 'BECAME', input.applicationId)
    }
  },

  describe: (input, _output, m) => ({
    title: 'Match saved',
    description: m.node(input.id, 'match')?.props.role ?? '',
  }),
})

export const scoutMatchPromote = defineTool({
  name: 'scout.match.promote',
  title: 'Add match to applications',
  summary: 'Turns a suggested match into a real application and links the two.',
  effect: 'create',
  touches: ['match', 'application'],
  input: s.object({ id: matchId, roleTag }),

  run(ctx, input): NodeId {
    const match = ctx.require('match', input.id)
    // Matches read 'UNT — Assistant professor, machine learning'. Without the
    // dash the whole string is the employer, which is the safer half to keep.
    const parsed = draftFromText(match.props.role)

    const application = ctx.call('application.create', {
      org: parsed.org ?? match.props.role,
      role: parsed.role ?? '',
      note: match.props.detail,
      roleTag: input.roleTag ?? guessRoleTag(match.props.role),
      stage: 'draft',
      source: 'Job scout',
      lastAction: 'Added from Job scout',
    })

    ctx.tx.link(input.id, 'BECAME', application)
    return application
  },

  describe: (_input, id, m) => ({
    title: `${displayOf(m, id)} added as a draft`,
    description: 'The match stays in this feed, now linked to the application.',
  }),
})

export const scoutMatchDismiss = defineTool({
  name: 'scout.match.dismiss',
  title: 'Dismiss match',
  summary: 'Drops a suggestion from the feed.',
  effect: 'delete',
  touches: ['match'],
  input: s.object({ id: matchId }),

  run(ctx, input) {
    ctx.require('match', input.id)
    ctx.tx.del(input.id)
  },

  describe: (input, _output, m) => ({
    title: 'Match dismissed',
    description: m.node(input.id, 'match')?.props.role ?? '',
    tone: 'danger',
  }),
})

/* -------------------------------- pipelines ------------------------------- */

const pipelineFields = {
  name: s.string({ min: 1, label: 'Name' }),
  source: s.string({ min: 1, label: 'Where it watches' }),
  schedule: s.string({ min: 1, label: 'How often' }),
  filter: s.string({ label: 'Filter' }),
}

export const scoutPipelineCreate = defineTool({
  name: 'scout.pipeline.create',
  title: 'Add pipeline',
  summary: 'Saves a search over a job board for the scout to watch.',
  effect: 'create',
  touches: ['pipeline'],
  input: s.object({ ...pipelineFields, enabled: s.optional(s.boolean({ label: 'Active' })) }),

  run(ctx, input): NodeId {
    const id = ctx.newId('pipeline')
    ctx.tx.put({
      id,
      type: 'pipeline',
      props: {
        slug: ctx.mintSlug('pipeline', input.name),
        name: input.name.trim(),
        source: input.source.trim(),
        schedule: input.schedule.trim(),
        filter: input.filter.trim() || '—',
        // Switched on by default: the banner above the list already says why
        // nothing runs, and a new pipeline that arrived off would read as a
        // create that failed.
        enabled: input.enabled ?? true,
      },
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    return id
  },

  describe: (input) => ({
    title: 'Pipeline created',
    description: `${input.name.trim()} — paused until a model is connected.`,
  }),
})

export const scoutPipelineUpdate = defineTool({
  name: 'scout.pipeline.update',
  title: 'Edit pipeline',
  summary: 'Saves the pipeline’s name, source, schedule and filter.',
  effect: 'update',
  touches: ['pipeline'],
  input: s.object({
    id: pipelineId,
    name: s.optional(pipelineFields.name),
    source: s.optional(pipelineFields.source),
    schedule: s.optional(pipelineFields.schedule),
    filter: s.optional(pipelineFields.filter),
  }),

  run(ctx, input) {
    ctx.require('pipeline', input.id)
    ctx.tx.patch<'pipeline'>(input.id, {
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      ...(input.source === undefined ? {} : { source: input.source.trim() }),
      ...(input.schedule === undefined ? {} : { schedule: input.schedule.trim() }),
      ...(input.filter === undefined ? {} : { filter: input.filter.trim() || '—' }),
    })
  },

  describe: (input, _output, m) => ({
    title: 'Pipeline updated',
    description: m.node(input.id, 'pipeline')?.props.name ?? '',
  }),
})

export const scoutPipelineDelete = defineTool({
  name: 'scout.pipeline.delete',
  title: 'Delete pipeline',
  summary: 'Stops watching this search. Anything it already found stays.',
  effect: 'delete',
  touches: ['pipeline'],
  input: s.object({ id: pipelineId }),

  run(ctx, input) {
    ctx.require('pipeline', input.id)
    ctx.tx.del(input.id)
  },

  describe: (input, _output, m) => {
    const pipeline = m.node(input.id, 'pipeline')
    return {
      title: 'Pipeline deleted',
      description: pipeline
        ? `${pipeline.props.name} stops watching ${pipeline.props.source}.`
        : '',
      tone: 'danger',
    }
  },
})

export const scoutPipelineEnableSet = defineTool({
  name: 'scout.pipeline.enable.set',
  title: 'Pause or resume a pipeline',
  summary: 'Switches the pipeline on or off.',
  effect: 'update',
  touches: ['pipeline'],
  input: s.object({ id: pipelineId, enabled: s.boolean({ label: 'Active' }) }),

  run(ctx, input) {
    ctx.require('pipeline', input.id)
    ctx.tx.patch<'pipeline'>(input.id, { enabled: input.enabled })
  },

  describe: (input, _output, m) => ({
    title: input.enabled ? 'Pipeline resumed' : 'Pipeline paused',
    description: m.node(input.id, 'pipeline')?.props.name ?? '',
  }),
})
