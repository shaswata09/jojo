/**
 * Keeping what a model read off a posting. L3.
 *
 * Two writes, and the difference between them is who pressed something.
 *
 * `fit.reading.set` is the panel recording an answer it went and got. Nobody
 * asked for it in so many words — opening an application starts the read — so
 * it is `system: true` and stays off the undo ring, exactly as `pipeline.run.record`
 * does for a timer that fired. Without that flag, ⌘Z after opening a record
 * undoes "the posting was read" instead of whatever the person actually did,
 * and the panel immediately reads it again because the stored reading has gone.
 *
 * `fit.reading.clear` is a person throwing the answer away, so it is `effect:
 * 'delete'` and it IS undoable. The gate classifies destructive work by that
 * field and what this does is destructive as the person experiences it — a
 * verdict they were reading is gone. Calling it an update because a row
 * survives would be arguing with the user about their own screen, which is the
 * argument `pipeline.proposal.sweep` already had and lost.
 *
 * ## Why clearing does not delete
 *
 * It empties the reading and stamps `clearedAt`, and the row stays. The panel
 * reads a posting automatically whenever it finds no reading, so a clear that
 * left nothing behind would start a fresh model call on the next render and put
 * the discarded verdict straight back — the button would look broken while
 * working perfectly. `core/fit-reading.ts` holds the predicate that tells the
 * two states apart; this is the write that produces the second one.
 */

import { MAX_REQUIREMENTS, MAX_REQUIREMENT_TEXT } from '../core/model'
import type { NodeId, PostingReading } from '../core/model'
import { s } from '../core/schema'
import type { GraphSnapshot } from '../core/snapshot'
import { defineTool } from './tool'

const fileId = s.id('file', { label: 'Posting' })

/** The document's name, for a toast that has to say which posting. */
const nameOf = (m: GraphSnapshot, id: NodeId): string => m.node(id, 'file')?.props.name ?? ''

export const fitReadingSet = defineTool({
  name: 'fit.reading.set',
  title: 'Record what a posting asks for',
  summary:
    'Stores the requirement list a model read off a saved posting, so the fit panel does not read the same page again on every visit. Replaces any reading already held for that document.',
  effect: 'update',
  touches: ['file'],
  /*
   * Off the palette and off the undo ring. Both for the same reason: this is
   * the fit panel writing down what it just read, not an edit anybody made.
   * Nobody can usefully type a requirement list into a command palette, and
   * `system` is what keeps ⌘Z pointed at the user's own last action.
   */
  internal: true,
  system: true,
  input: s.object({
    fileId,
    requirements: s.array(
      s.object({
        text: s.string({ min: 1, max: MAX_REQUIREMENT_TEXT, label: 'Requirement' }),
        essential: s.boolean({ label: 'Required' }),
      }),
      { max: MAX_REQUIREMENTS, label: 'What it asks for' },
    ),
    model: s.string({ min: 1, label: 'Read by' }),
    skipped: s.optional(s.number({ min: 0, int: true, label: 'Lines skipped' })),
  }),

  run(ctx, input) {
    ctx.require('file', input.fileId)

    const reading: PostingReading = {
      /*
       * Rebuilt field by field rather than passed through. `s.object` keeps
       * unknown keys on purpose — that is what lets a record written by a newer
       * build survive an older one — and this is a prop, so anything extra a
       * caller sent would sit in the store forever with nothing able to read it.
       */
      requirements: input.requirements.map((r) => ({ text: r.text, essential: r.essential })),
      model: input.model,
      readAt: ctx.now,
      ...(input.skipped === undefined || input.skipped === 0 ? {} : { skipped: input.skipped }),
      // No `clearedAt`. A new reading is the answer to the question a clear
      // was declining, so writing one is how somebody takes the clear back.
    }

    ctx.tx.patch<'file'>(input.fileId, { reading })
  },

  describe: (input, _output, m) => ({
    title: 'Posting read',
    description: nameOf(m, input.fileId),
  }),
})

export const fitReadingClear = defineTool({
  name: 'fit.reading.clear',
  title: 'Clear the fit reading',
  summary:
    'Throws away what was read off a saved posting. The fit panel empties and will not read that page again until it is asked to.',
  effect: 'delete',
  touches: ['file'],
  input: s.object({ fileId }),

  run(ctx, input) {
    const file = ctx.require('file', input.fileId)
    const held = file.props.reading

    /*
     * Idempotent, and ungated. Clearing a document nobody has read is a no-op
     * rather than a refusal — the same rule the pipeline's two housekeeping
     * verbs follow, for the reason given there: withholding a button on an
     * empty queue turns a second press into an error message about nothing.
     *
     * Idempotent means the SECOND clear writes nothing at all, not that it
     * writes the same thing again. It used to restamp `clearedAt`, which put a
     * row in the journal for a press that changed nothing and moved the date
     * the panel reports — "you cleared this today" about a decision taken last
     * week. `clearedAt` is when the person decided, not when they last pressed.
     */
    if (held === undefined || held.clearedAt !== undefined) return

    ctx.tx.patch<'file'>(input.fileId, {
      reading: {
        /*
         * The answer goes; what it WAS does not.
         *
         * `clearedAt` alone would be enough to stop the panel reading again, so
         * keeping the other two is a deliberate choice about the record rather
         * than about the screen: this row is the only remaining evidence that
         * the posting was ever read, and by what. `readAt` is therefore the
         * original — restamping it to now would say the reading happened at the
         * moment it was thrown away, which is the one thing that is certainly
         * untrue — and the two dates together are what make "cleared a week
         * after it was read" answerable at all.
         */
        requirements: [],
        model: held.model,
        readAt: held.readAt,
        clearedAt: ctx.now,
      },
    })
  },

  describe: (input, _output, m) => ({
    title: 'Fit reading cleared',
    description: nameOf(m, input.fileId),
    tone: 'danger',
  }),
})
