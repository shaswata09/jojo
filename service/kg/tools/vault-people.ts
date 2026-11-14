/**
 * L3 — the vault's people tools: referees, chairs, recruiters, and which jobs
 * each is named on. The filing rules all four vault files share are in
 * `vault-shared.ts`.
 */

import {
  CONTACT_ROLE_VALUES,
  MAX_BRIEF_HIGHLIGHTS,
  MAX_BRIEF_HIGHLIGHT_TEXT,
  MAX_BRIEF_NOTE_TEXT,
  MAX_BRIEFS,
} from '../core/model'
import type { NodeId } from '../core/model'
import { briefsWithin, normaliseBriefs } from '../core/referee-brief'
import { s } from '../core/schema'
import type { GraphSnapshot } from '../core/snapshot'
import { defineTool } from './tool'
import { applicationIds, cleared, fileUnder } from './vault-shared'

const personId = s.id('person', { label: 'Person' })

/**
 * The optional half of a person, in one place.
 *
 * Everything except the name is optional, and `cleared` in `vault-shared.ts` is what makes an
 * emptied field actually empty rather than a stored `''` — a note wiped in the
 * form has to leave the record, or the Vault goes on rendering a blank line
 * under the name forever.
 */
const personDetails = {
  role: s.optional(s.string({ label: 'Role' })),
  affiliation: s.optional(s.string({ label: 'Affiliation' })),
  email: s.optional(s.string({ label: 'Email' })),
  phone: s.optional(s.string({ label: 'Phone' })),
  note: s.optional(s.string({ label: 'Note', multiline: true })),
}

/**
 * What you want this referee to say about each application. See `RefereeBrief`.
 *
 * The whole list, every time, like `applicationIds`: the editor holds every
 * brief for the person at once, and an absolute list cannot half-apply.
 * Briefs for applications the person is not filed under are dropped rather
 * than refused, because the list and the filing can arrive in one save and an
 * unfiled application's brief has nowhere to be shown.
 */
const briefs = s.optional(
  s.array(
    s.object({
      applicationId: s.id('application', { label: 'Application' }),
      highlights: s.optional(
        s.array(s.string({ max: MAX_BRIEF_HIGHLIGHT_TEXT, label: 'Highlight' }), {
          max: MAX_BRIEF_HIGHLIGHTS,
          label: 'Highlights',
        }),
      ),
      note: s.optional(s.string({ max: MAX_BRIEF_NOTE_TEXT, label: 'Note', multiline: true })),
    }),
    { max: MAX_BRIEFS, label: 'Briefs' },
  ),
)

const contactRole = s.enum(CONTACT_ROLE_VALUES, { label: 'Role' })

export const vaultPersonCreate = defineTool({
  name: 'vault.person.create',
  title: 'Add person',
  summary: 'Remembers someone in the search — a referee, a chair, a recruiter.',
  effect: 'create',
  touches: ['person'],
  input: s.object({
    name: s.string({ min: 1, label: 'Name' }),
    ...personDetails,
    applicationIds,
    /*
     * What they are on each of those jobs, so adding somebody from an
     * application's own page is ONE write — and one undo — rather than a create
     * followed by a role. A role names its application, so it files the person
     * there too: it used to be dropped unless `applicationIds` repeated the id,
     * and a model sending only `roles` was told "Person saved" with no filing
     * and no role (R12).
     */
    roles: s.optional(
      s.array(s.object({ applicationId: s.id('application', { label: 'Application' }), role: contactRole }), {
        max: MAX_BRIEFS,
        label: 'Roles',
        description:
          'What they are on each application. Each one also files the person under that application, so it need not be repeated in applicationIds.',
      }),
    ),
  }),

  run(ctx, input): NodeId {
    const id = ctx.newId('person')
    // Bound before the spread rather than called inside it: under
    // `exactOptionalPropertyTypes` a property whose value is `string |
    // undefined` is not the same type as an absent one, and only the binding
    // narrows it. A blank field has to be ABSENT, not stored as '', or the
    // Vault renders an empty line under the name for ever.
    const role = cleared(input.role)
    const affiliation = cleared(input.affiliation)
    const email = cleared(input.email)
    const phone = cleared(input.phone)
    const note = cleared(input.note)
    ctx.tx.put({
      id,
      type: 'person',
      props: {
        slug: ctx.mintSlug('person', input.name),
        name: input.name.trim(),
        ...(role === undefined ? {} : { role }),
        ...(affiliation === undefined ? {} : { affiliation }),
        ...(email === undefined ? {} : { email }),
        ...(phone === undefined ? {} : { phone }),
        ...(note === undefined ? {} : { note }),
      },
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    fileUnder(ctx, id, input.applicationIds)
    // A role implies its filing (see `roles` above): each one is linked with
    // its role whether or not `applicationIds` named it, replacing the bare
    // edge when it did.
    for (const { applicationId, role } of input.roles ?? []) {
      ctx.tx.unlink(id, 'FILED_UNDER', applicationId)
      ctx.tx.link(id, 'FILED_UNDER', applicationId, { role })
    }
    return id
  },

  describe: (input) => ({ title: 'Person saved', description: input.name.trim() }),
})

export const vaultPersonUpdate = defineTool({
  name: 'vault.person.update',
  title: 'Edit person',
  summary:
    'Saves what you know about them, which jobs they are named on, and their briefs. `applicationIds` replaces the whole filing: an application left out loses this person, and their brief and role for it. To name or un-name them on one job, use vault.person.file or vault.person.unfile.',
  effect: 'update',
  touches: ['person'],
  /*
   * Asked about only when the filing sent would drop a job this person has a
   * brief or a role on. `applicationIds: []` beside a phone number silently
   * deleted every referee brief, ungated (R12); a filing that drops nothing
   * written down is still a plain save.
   */
  confirms: {
    when: (input, memory) => dropsBriefOrRole(input, memory),
    because:
      'Asks first when the filing sent leaves out an application this person has a brief or a role on: those are deleted with it.',
  },
  input: s.object({
    id: personId,
    name: s.optional(s.string({ min: 1, label: 'Name' })),
    ...personDetails,
    applicationIds,
    briefs,
  }),

  run(ctx, input) {
    const person = ctx.require('person', input.id)
    /*
     * The filing this save leaves behind, read from the INPUT when it carries
     * one rather than from `memory` after `fileUnder` — so the answer does not
     * depend on whether a snapshot sees writes made earlier in the same
     * transaction.
     */
    const filed = new Set<string>(
      input.applicationIds === undefined
        ? ctx.memory.many(input.id, 'FILED_UNDER', 'out', 'application').map((a) => a.id)
        : (input.applicationIds ?? []),
    )
    /*
     * Briefs are rewritten when they are given, and pruned when only the filing
     * changed — so unfiling a person from a job also lets go of what they were
     * asked to say about it, instead of keeping it out of sight indefinitely.
     */
    const nextBriefs =
      input.briefs !== undefined
        ? normaliseBriefs(input.briefs, filed)
        : input.applicationIds !== undefined
          ? briefsWithin(person.props.briefs, filed)
          : undefined
    ctx.tx.patch<'person'>(input.id, {
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      ...(input.role === undefined ? {} : { role: cleared(input.role) }),
      ...(input.affiliation === undefined ? {} : { affiliation: cleared(input.affiliation) }),
      ...(input.email === undefined ? {} : { email: cleared(input.email) }),
      ...(input.phone === undefined ? {} : { phone: cleared(input.phone) }),
      ...(input.note === undefined ? {} : { note: cleared(input.note) }),
      // `undefined` deletes the key: an empty list is stored as no list.
      ...(nextBriefs === undefined ? {} : { briefs: nextBriefs.length === 0 ? undefined : nextBriefs }),
    })
    fileUnder(ctx, input.id, input.applicationIds)
  },

  describe: (input, _output, m) => ({
    title: 'Person saved',
    description: m.node(input.id, 'person')?.props.name ?? '',
  }),
})

/**
 * Whether this update's filing leaves out an application the person has a
 * brief or a role on. Absent `applicationIds` leaves the filing alone; `null`
 * and `[]` both empty it.
 */
function dropsBriefOrRole(
  input: { id: NodeId; applicationIds?: readonly NodeId[] | null },
  memory: GraphSnapshot,
): boolean {
  if (input.applicationIds === undefined) return false
  const kept = new Set<string>(input.applicationIds ?? [])
  const person = memory.node(input.id, 'person')
  const briefed = new Set<string>((person?.props.briefs ?? []).map((b) => b.applicationId))
  return memory
    .out(input.id, 'FILED_UNDER')
    .some((e) => !kept.has(e.to) && (briefed.has(e.to) || (e.props as { role?: unknown }).role !== undefined))
}

export const vaultPersonDelete = defineTool({
  name: 'vault.person.delete',
  title: 'Remove person',
  summary: 'Removes them from the Vault. The jobs they were named on are untouched.',
  effect: 'delete',
  touches: ['person'],
  input: s.object({ id: personId }),

  run(ctx, input) {
    ctx.require('person', input.id)
    ctx.tx.del(input.id)
  },

  describe: (input, _output, m) => ({
    title: 'Person removed',
    description: m.node(input.id, 'person')?.props.name ?? '',
    tone: 'danger',
  }),
})

/**
 * Name one person on one application, as its recommender or point of contact.
 *
 * WHY A TOOL OF ITS OWN when `vault.person.update` already files people. That
 * one takes the WHOLE filing, which is right for the Vault's form and wrong for
 * an application's page — and dangerous for a model, which asked to add Anita
 * to the Rice job would have to restate every other job she is on or unfile her
 * from them. This touches one pairing and nothing else.
 *
 * `role` absent keeps whatever role the pairing had (or none, for a new one);
 * `null` clears it. Changing it relinks the edge, because `link` never rewrites
 * the props of an edge that is already there — and inside one transaction the
 * journal still records the original edge as the "before", so undo restores it
 * exactly.
 */
export const vaultPersonFile = defineTool({
  name: 'vault.person.file',
  title: 'Name person on application',
  summary: 'Names a person on one application, as recommender or point of contact.',
  effect: 'update',
  touches: ['person'],
  input: s.object({
    id: personId,
    applicationId: s.id('application', { label: 'Application' }),
    role: s.optional(s.nullable(contactRole)),
  }),

  run(ctx, input) {
    ctx.require('person', input.id)
    ctx.require('application', input.applicationId)
    const edge = ctx.memory.out(input.id, 'FILED_UNDER').find((e) => e.to === input.applicationId)
    if (edge !== undefined && input.role === undefined) return
    const props = input.role === undefined || input.role === null ? {} : { role: input.role }
    if (edge !== undefined) ctx.tx.unlink(input.id, 'FILED_UNDER', input.applicationId)
    ctx.tx.link(input.id, 'FILED_UNDER', input.applicationId, props)
  },

  describe: (input, _output, m) => ({
    title: 'Person named on application',
    description: m.node(input.id, 'person')?.props.name ?? '',
  }),
})

/**
 * Take one person off one application. The person and the application both
 * stay (D15); so do their other jobs. Their brief for this job goes too, as it
 * does when `vault.person.update` unfiles them — a brief nobody can see is not
 * worth keeping.
 */
export const vaultPersonUnfile = defineTool({
  name: 'vault.person.unfile',
  title: 'Take person off application',
  summary: 'Takes a person off one application; their other jobs stay.',
  effect: 'update',
  touches: ['person'],
  input: s.object({
    id: personId,
    applicationId: s.id('application', { label: 'Application' }),
  }),

  run(ctx, input) {
    const person = ctx.require('person', input.id)
    ctx.require('application', input.applicationId)
    // Not named there is a refusal, not a quiet success the verify gate then
    // counts as landed (R11c).
    if (!ctx.memory.out(input.id, 'FILED_UNDER').some((e) => e.to === input.applicationId)) {
      ctx.fail(`${person.props.name} is not named on that application, so there was nothing to take off.`, {
        field: 'applicationId',
        code: 'graph/not-found',
      })
    }
    ctx.tx.unlink(input.id, 'FILED_UNDER', input.applicationId)
    const filed = new Set<string>(
      ctx.memory
        .many(input.id, 'FILED_UNDER', 'out', 'application')
        .map((a) => a.id)
        .filter((id) => id !== input.applicationId),
    )
    if (person.props.briefs?.some((b) => b.applicationId === input.applicationId)) {
      const left = briefsWithin(person.props.briefs, filed)
      ctx.tx.patch<'person'>(input.id, { briefs: left.length === 0 ? undefined : left })
    }
  },

  describe: (input, _output, m) => ({
    title: 'Person taken off application',
    description: m.node(input.id, 'person')?.props.name ?? '',
  }),
})
