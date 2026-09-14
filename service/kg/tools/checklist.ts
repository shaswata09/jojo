/**
 * An application's checklist. L3 — four writes.
 *
 * ## Every one of these rebuilds the list
 *
 * `tx.patch` copies props SHALLOWLY, so the array staged as the journal's
 * before-image is the same array staged as the after-image. Nothing here may
 * push, splice or assign into the stored list; every change goes through
 * `core/checklist.ts`, which returns new arrays and new item objects and is
 * tested for exactly that. Get this wrong and undo restores what is already
 * there, reports success, and nothing looks broken until somebody needs it.
 *
 * ## Why four, and why `set` rather than `complete` + `reopen`
 *
 * `draft.add` and `item.add` are split because the provenance stamp is what
 * lets the card say "jojo suggested this": one tool with an optional `model`
 * would let anything claim it. `draft.add` is `internal` because its input is
 * an array of objects, which the palette's form cannot draw — honest rather
 * than decorative.
 *
 * Ticking is ONE tool taking an absolute `done`, not a pair and not a toggle.
 * `tools/timeline.ts` argues the toggle case at length for the same control: an
 * instruction to invert whatever it finds races the screen that issued it, so
 * the second of two quick taps undoes the first. `application.flag.set` and
 * `timeline.item.remind.set` are the precedent for the name.
 *
 * ## What the agent may not do
 *
 * Add, never replace, and never write `doneOn`. That is enforced here rather
 * than only in the reader, so the assistant and the MCP link cannot blow away a
 * list somebody has been working through either. A person's ticks are
 * unreachable from a model by construction.
 */

import { addItems, itemsOf, keyOf, removeItem, setItem } from '../core/checklist'
import { MAX_CHECKLIST_ITEMS, MAX_CHECKLIST_TEXT } from '../core/model'
import type { ChecklistItem } from '../core/model'
import { uuidv7 } from '../core/ref'
import { s } from '../core/schema'
import { appId } from './application-fields'
import { displayOf } from './support'
import { defineTool } from './tool'

const itemId = s.string({ min: 1, label: 'Step' })
const stepText = s.string({ min: 1, max: MAX_CHECKLIST_TEXT, label: 'Step' })

/**
 * The list as it is stored, or undefined when the key should leave the props.
 *
 * An application that never had a checklist and one whose last item was just
 * deleted have to be byte-identical on disk, or a backup taken either side of
 * that would differ over nothing. `tx.patch` deletes a key on `undefined`.
 */
const stored = (next: readonly ChecklistItem[]): ChecklistItem[] | undefined =>
  next.length === 0 ? undefined : [...next]

/** Bare uuidv7, not a `NodeId`: these address rows inside one record's props. */
const mintIds = (now: string, count: number): string[] =>
  Array.from({ length: count }, () => uuidv7(Date.parse(now)))

export const checklistDraftAdd = defineTool({
  name: 'application.checklist.draft.add',
  title: 'Add drafted steps',
  summary:
    'Adds steps a model drafted from the posting to an application checklist. Adds only — it never replaces the list and never ticks anything.',
  effect: 'create',
  touches: ['application'],
  /*
   * Off the palette: the input is an array of objects, which `tool-form.ts`
   * cannot draw. NOT `system` — a person pressed Draft and a list appeared, so
   * ⌘Z should take it back. That is `tailor.snippet.create`'s reading rather
   * than `fit.reading.set`'s, and the difference is who asked.
   */
  internal: true,
  input: s.object({
    id: appId,
    items: s.array(s.object({ text: stepText }), {
      max: MAX_CHECKLIST_ITEMS,
      label: 'Steps',
    }),
    model: s.string({ min: 1, label: 'Drafted by' }),
  }),

  run(ctx, input): number {
    const application = ctx.require('application', input.id)
    const held = application.props.checklist
    const texts = input.items.map((i) => i.text)
    const next = addItems(held, texts, mintIds(ctx.now, texts.length), {
      model: input.model,
      at: ctx.now,
    })
    // Nothing new survived the fold — the model repeated a list the person
    // already has. That is an ordinary outcome, not a refusal, and writing
    // anyway would stamp `updatedAt` and take the top of the undo stack.
    if (next === itemsOf(held)) return 0
    ctx.tx.patch<'application'>(input.id, { checklist: stored(next) })
    return next.length - itemsOf(held).length
  },

  describe: (input, added, m) => ({
    title:
      added === 0
        ? 'Already on the checklist'
        : added === 1
          ? '1 step added'
          : `${String(added)} steps added`,
    description: displayOf(m, input.id),
  }),
})

export const checklistItemAdd = defineTool({
  name: 'application.checklist.item.add',
  title: 'Add a step',
  summary: 'Adds one step to an application checklist.',
  effect: 'create',
  touches: ['application'],
  input: s.object({ id: appId, text: stepText }),

  run(ctx, input): void {
    const application = ctx.require('application', input.id)
    const held = application.props.checklist
    const text = input.text.trim()

    if (itemsOf(held).length >= MAX_CHECKLIST_ITEMS) {
      ctx.fail(
        `${String(MAX_CHECKLIST_ITEMS)} steps is the most one application holds. Tick off or delete one first.`,
        { field: 'text' },
      )
    }
    /*
     * Checked HERE as well as in the panel, and the duplicate is the reason:
     * the drafting run reads the list when it starts and the model thinks for a
     * minute, so a step the person typed meanwhile is only catchable by the
     * write that happens inside the transaction.
     */
    if (itemsOf(held).some((i) => keyOf(i.text) === keyOf(text))) {
      ctx.fail('That step is already on the list.', { field: 'text' })
    }

    const next = addItems(held, [text], mintIds(ctx.now, 1))
    if (next === itemsOf(held)) return
    ctx.tx.patch<'application'>(input.id, { checklist: stored(next) })
  },

  describe: (input, _output, m) => ({
    title: 'Step added',
    description: `${input.text.trim()} · ${displayOf(m, input.id)}`,
  }),
})

export const checklistItemSet = defineTool({
  name: 'application.checklist.item.set',
  title: 'Change a step',
  summary:
    'Ticks, unticks or rewords one step on an application checklist. `done` is absolute, never a toggle.',
  effect: 'update',
  touches: ['application'],
  input: s.object({
    id: appId,
    itemId,
    text: s.optional(stepText),
    done: s.optional(s.boolean({ label: 'Done' })),
  }),

  run(ctx, input): void {
    const application = ctx.require('application', input.id)
    const held = application.props.checklist
    const next = setItem(
      held,
      input.itemId,
      {
        ...(input.text === undefined ? {} : { text: input.text }),
        ...(input.done === undefined ? {} : { done: input.done }),
      },
      ctx.now,
    )
    // An unknown step, or a change that changes nothing. Both write nothing:
    // a no-op patch stamps `updatedAt` and eats an undo slot.
    if (next === itemsOf(held)) return
    ctx.tx.patch<'application'>(input.id, { checklist: stored(next) })
  },

  describe: (input, _output, m) => {
    const application = m.node(input.id, 'application')
    const item = itemsOf(application?.props.checklist).find((i) => i.id === input.itemId)
    const label = item?.text ?? 'Step'
    if (input.done === true) return { title: 'Step ticked', description: label }
    if (input.done === false) return { title: 'Step reopened', description: label }
    return { title: 'Step reworded', description: label }
  },
})

export const checklistItemRemove = defineTool({
  name: 'application.checklist.item.remove',
  title: 'Delete a step',
  summary: 'Removes one step from an application checklist.',
  effect: 'delete',
  touches: ['application'],
  input: s.object({ id: appId, itemId }),

  run(ctx, input): void {
    const application = ctx.require('application', input.id)
    const held = application.props.checklist
    const next = removeItem(held, input.itemId)
    if (next === itemsOf(held)) return
    ctx.tx.patch<'application'>(input.id, { checklist: stored(next) })
  },

  describe: (input, _output, m) => {
    const application = m.node(input.id, 'application')
    const item = itemsOf(application?.props.checklist).find((i) => i.id === input.itemId)
    return {
      title: 'Step deleted',
      description: item?.text ?? displayOf(m, input.id),
      tone: 'danger' as const,
    }
  },
})
