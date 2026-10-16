/**
 * L3 — the sticky notes on the dashboard's board.
 *
 * Deliberately the smallest record in the app: text and a colour, filed under
 * nothing. A sticky is for what the person wants in front of them for a few
 * days and has not decided is anything more — once one has a date it becomes a
 * reminder (`timeline.item.create`), and once it is reusable wording it belongs
 * in a snippet. Both moves happen in the UI, as a fresh write of the right
 * shape, rather than as fields bolted on here.
 */

import type { NodeId } from '../core/model'
import { DEFAULT_STICKY_TONE, LABEL_TONE_VALUES, MAX_STICKY_TEXT } from '../core/model'
import { s } from '../core/schema'
import { defineTool } from './tool'

const stickyId = s.id('stickyNote', { label: 'Sticky note' })
const text = s.string({ min: 1, max: MAX_STICKY_TEXT, label: 'Note', multiline: true })
const tone = s.enum(LABEL_TONE_VALUES, { label: 'Colour' })

/** A note's first few words, for the toast and the slug. */
const gist = (note: string) => {
  const line = note.trim().replace(/\s+/g, ' ')
  return line.length > 48 ? `${line.slice(0, 47)}…` : line
}

export const stickyNoteCreate = defineTool({
  name: 'sticky.note.create',
  title: 'Add sticky note',
  summary: 'Puts a short note to self on the dashboard’s board.',
  effect: 'create',
  touches: ['stickyNote'],
  input: s.object({ text, tone: s.optional(tone) }),

  run(ctx, input): NodeId {
    const id = ctx.newId('stickyNote')
    ctx.tx.put({
      id,
      type: 'stickyNote',
      props: {
        slug: ctx.mintSlug('stickyNote', gist(input.text)),
        text: input.text.trim(),
        tone: input.tone ?? DEFAULT_STICKY_TONE,
      },
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    return id
  },

  describe: (input) => ({ title: 'Note added', description: gist(input.text) }),
})

export const stickyNoteUpdate = defineTool({
  name: 'sticky.note.update',
  title: 'Edit sticky note',
  summary: 'Saves a sticky note’s text or colour.',
  effect: 'update',
  touches: ['stickyNote'],
  input: s.object({ id: stickyId, text: s.optional(text), tone: s.optional(tone) }),

  run(ctx, input) {
    ctx.require('stickyNote', input.id)
    ctx.tx.patch<'stickyNote'>(input.id, {
      ...(input.text === undefined ? {} : { text: input.text.trim() }),
      ...(input.tone === undefined ? {} : { tone: input.tone }),
    })
  },

  describe: (input, _output, m) => ({
    title: 'Note saved',
    description: gist(m.node(input.id, 'stickyNote')?.props.text ?? ''),
  }),
})

export const stickyNoteDelete = defineTool({
  name: 'sticky.note.delete',
  title: 'Remove sticky note',
  summary: 'Takes a sticky note off the board.',
  effect: 'delete',
  touches: ['stickyNote'],
  input: s.object({ id: stickyId }),

  run(ctx, input) {
    ctx.require('stickyNote', input.id)
    ctx.tx.del(input.id)
  },

  describe: (input, _output, m) => ({
    title: 'Note removed',
    description: gist(m.node(input.id, 'stickyNote')?.props.text ?? ''),
    tone: 'danger',
  }),
})
