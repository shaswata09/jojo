/**
 * L3 — the whole-record operations, and the two single-field edits.
 *
 * `delete` and `duplicate` are here rather than beside create/update because
 * neither goes anywhere near the form: they are the two places that decide what
 * an application takes with it. `delete` takes nothing (D15), `duplicate` takes
 * a listed subset and deliberately not the offer. `note.set` and `flag.set` are
 * the two fields a card writes without opening the dialog at all.
 */

import { s } from '../core/schema'
import type { NodeId } from '../core/model'
import { decodeFormat, normaliseFormat, retextFormat } from '../core/note-format'
import { appId } from './application-fields'
import { displayOf, opt, touch } from './support'
import { defineTool } from './tool'

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
        // The formatting goes with the text it belongs to. This copy lists
        // props key by key on purpose — the comment above says why — and the
        // mirror hazard is that it silently LOSES one: without this line the
        // duplicate keeps the words and drops the colours, and no test fails.
        ...opt('noteFormat', source.props.noteFormat),
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
  /*
   * The ONLY tool that may write formatting, and that narrowness is the design.
   *
   * `application.update` and `application.create` take the note's text and
   * nothing else, so three of the four places that could have forgotten to
   * carry spans cannot express them at all. What is left is here, where the
   * note editor sends them, and the remap below for everybody else.
   */
  input: s.object({
    id: appId,
    note: s.string({ label: 'Note', multiline: true }),
    /*
     * ONE STRING, not an array of objects, and the reason is measured: the
     * same spans as a JSON-Schema array cost about 1,100 characters that every
     * model request carries forever — more than two average tools — for a
     * parameter no model should ever produce. See `encodeFormat`.
     */
    format: s.optional(
      s.string({
        label: 'Note formatting',
        description: "Written by the note editor. Leave this out; the note's existing formatting is kept.",
      }),
    ),
  }),

  run(ctx, input) {
    const current = ctx.require('application', input.id)
    const note = input.note.trim()
    /*
     * Given spans, they are canonicalised against the text that is being saved
     * with them. Given none — the phone's plain editor, the edit dialog, the
     * assistant — the existing spans are moved onto the new text instead, so
     * fixing a typo costs the formatting on that word rather than on the note.
     *
     * `tx.patch` deletes a key on `undefined`, so clearing formatting leaves a
     * record byte-identical to one that never had any.
     */
    ctx.tx.patch<'application'>(input.id, {
      note,
      noteFormat:
        input.format === undefined
          ? retextFormat(current.props.note, note, current.props.noteFormat)
          : normaliseFormat(note, decodeFormat(input.format)),
    })
    touch(ctx, input.id, 'Note edited')
  },

  describe: (input, _output, m) => ({
    title: 'Note saved',
    // Which application. `announcement.title` is the journal label, so a row
    // that names no record makes the audit log — the answer to "a record
    // changed by itself" — a list of identical anonymous entries.
    description: displayOf(m, input.id),
  }),
})

/**
 * Was a toggle.
 *
 * By the time an undo fires the flag may have been cleared elsewhere, and
 * toggling again would set it — a fact this codebase already writes down three
 * times — on the Undo of the completion toast in `PriorityActions.tsx`,
 * `RemindersTool.tsx` and `OwedThisWeek.tsx`. The card reads the current value and asks for the one
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
