/**
 * Q268 — every note the person types keeps its formatting.
 *
 * The application note and the snippets already did. This holds the other
 * four — the edit dialog's note, the offer's note, a timeline item's note and
 * a person's note — to the same storage scheme: the text stays a plain string
 * where it always was, and the formatting is a NEW, OPTIONAL list of spans
 * beside it, so
 *
 * - a record saved before this change validates, restores and reads exactly
 *   as it did;
 * - a writer that only knows the text (the phone, the assistant) moves the
 *   existing spans onto the new text rather than leaving them on the wrong
 *   characters — the rule the application note already follows.
 *
 * Against a real repository and the real tool runtime, as `vault.test.ts` is.
 */
import { describe, expect, it } from 'vitest'
import { MutableSnapshot } from '../core/snapshot'
import { applicationFrom } from '../core/project'
import { formatWrite, runsOf } from '../core/note-format'
import type { NodeId, NoteSpan } from '../core/model'
import { validateRows } from '../core/validate'
import { createRepository } from '../repo/repository'
import { createToolRuntime } from './runtime'

type Options = Parameters<typeof createRepository>[0]

const nullDriver = (): Options['driver'] => ({
  open: async () => ({ ok: true, value: { version: 1, from: 0, migrated: [], crossTab: false } }),
  readAll: async () => ({ ok: true, value: { nodes: [], edges: [], meta: [], ops: [] } }),
  commit: async () => ({ ok: true, value: undefined }),
  replace: async () => ({ ok: true, value: undefined }),
  seedIfPristine: async () => ({ ok: true, value: true }),
  destroy: async () => ({ ok: true, value: undefined }),
  onRemoteCommit: () => () => {},
  onBlocking: () => () => {},
  close: () => {},
})

const START = Date.parse('2026-10-12T15:00:00.000Z')

function harness() {
  let tick = 0
  const now = () => new Date(START + tick++ * 1000).toISOString()
  const repo = createRepository({
    driver: nullDriver(),
    snapshot: new MutableSnapshot(),
    meta: {
      schemaVersion: 1,
      createdAt: new Date(START).toISOString(),
      lastOpenedAt: new Date(START).toISOString(),
      dataSet: 'empty',
      seededAt: null,
      handoverAt: null,
    },
    now,
  })
  const runtime = createToolRuntime({ repo, now })
  const run = (name: string, input: unknown) => {
    const result = runtime.run(name as never, input as never)
    if (!result.ok) throw new Error(result.errors.map((e) => e.message).join('; '))
    return result.output as unknown as NodeId
  }
  const props = (id: NodeId) =>
    repo.getSnapshot().node(id)?.props as unknown as Record<string, unknown> & {
      note?: string
      noteFormat?: NoteSpan[]
      offer?: { note: string }
      offerNoteFormat?: NoteSpan[]
    }
  return { repo, run, props }
}

/** The words in bold, read the way a renderer reads them. */
const bold = (text: string | undefined, spans: readonly NoteSpan[] | undefined) =>
  runsOf(text ?? '', spans)
    .filter((r) => r.bold)
    .map((r) => r.text)

const app = (h: ReturnType<typeof harness>, extra: Record<string, unknown> = {}) =>
  h.run('application.create', { org: 'Rice', role: 'Asst Prof', roleTag: 'Academic', stage: 'draft', ...extra })

describe('a timeline item’s note (Q268)', () => {
  it('saves the formatting sent with it, on create and on edit', () => {
    const h = harness()
    const id = h.run('timeline.item.create', {
      title: 'Chase Rice',
      date: '2026-10-20',
      kind: 'follow-up',
      note: 'Ask about the panel',
      noteFormat: '4-9:b::',
    })
    expect(bold(h.props(id).note, h.props(id).noteFormat)).toEqual(['about'])

    h.run('timeline.item.update', { id, note: 'Ask about the panel', noteFormat: '0-3:b::' })
    expect(bold(h.props(id).note, h.props(id).noteFormat)).toEqual(['Ask'])
  })

  it('moves the formatting when only the text is sent, rather than leaving it on other words', () => {
    const h = harness()
    const id = h.run('timeline.item.create', {
      title: 'Chase Rice',
      date: '2026-10-20',
      kind: 'follow-up',
      note: 'URGENT send by Friday',
      noteFormat: '0-6:b::',
    })
    // The phone and the assistant send text alone.
    h.run('timeline.item.update', { id, note: 'Note: URGENT send by Friday' })
    expect(bold(h.props(id).note, h.props(id).noteFormat)).toEqual(['URGENT'])
  })

  it('clears it on an empty formatting string, and leaves it alone when the note is not sent', () => {
    const h = harness()
    const id = h.run('timeline.item.create', {
      title: 'Chase Rice',
      date: '2026-10-20',
      kind: 'follow-up',
      note: 'Ask about the panel',
      noteFormat: '0-3:b::',
    })
    h.run('timeline.item.update', { id, title: 'Chase Rice again' })
    expect(bold(h.props(id).note, h.props(id).noteFormat)).toEqual(['Ask'])
    h.run('timeline.item.update', { id, note: 'Ask about the panel', noteFormat: '' })
    expect(h.props(id)).not.toHaveProperty('noteFormat')
  })

  it('leaves an item saved before formatting existed exactly as it was', () => {
    const h = harness()
    const id = h.run('timeline.item.create', { title: 'Old', date: '2026-10-20', kind: 'admin', note: 'plain' })
    expect(h.props(id)).not.toHaveProperty('noteFormat')
    h.run('timeline.item.update', { id, note: 'still plain' })
    expect(h.props(id)).not.toHaveProperty('noteFormat')
  })
})

describe('a person’s note (Q268)', () => {
  it('saves the formatting sent with it, on create and on edit', () => {
    const h = harness()
    const id = h.run('vault.person.create', { name: 'Anita', note: 'Owes the letter', noteFormat: '5-8:i::' })
    expect(h.props(id).noteFormat).toEqual([{ start: 5, end: 8, italic: true }])
    h.run('vault.person.update', { id, note: 'Owes the letter', noteFormat: '0-4:b:red:' })
    expect(h.props(id).noteFormat).toEqual([{ start: 0, end: 4, bold: true, colour: 'red' }])
  })

  it('moves the formatting when only the text is sent', () => {
    const h = harness()
    const id = h.run('vault.person.create', { name: 'Anita', note: 'URGENT chase', noteFormat: '0-6:b::' })
    h.run('vault.person.update', { id, note: 'Very URGENT chase' })
    expect(bold(h.props(id).note, h.props(id).noteFormat)).toEqual(['URGENT'])
  })
})

describe('the edit dialog’s note on an application (Q268)', () => {
  it('saves the formatting with the rest of the form, on create and on edit', () => {
    const h = harness()
    const id = app(h, { note: 'Send the CV', noteFormat: '5-8:b::' })
    expect(bold(h.props(id).note, h.props(id).noteFormat)).toEqual(['the'])
    h.run('application.update', { id, note: 'Send the CV', noteFormat: '9-11:b::' })
    expect(bold(h.props(id).note, h.props(id).noteFormat)).toEqual(['CV'])
  })

  it('still moves the formatting for a writer that sends the text alone', () => {
    const h = harness()
    const id = app(h, { note: 'URGENT send', noteFormat: '0-6:b::' })
    h.run('application.update', { id, note: 'Now URGENT send' })
    expect(bold(h.props(id).note, h.props(id).noteFormat)).toEqual(['URGENT'])
  })
})

describe('an offer’s note (Q268)', () => {
  const offered = () => {
    const h = harness()
    const id = app(h)
    // The way the stage dialog writes it: one `application.update`.
    h.run('application.update', {
      id,
      stage: 'offer',
      offer: { respondBy: '2026-11-01', note: 'Ask for more startup' },
      offerNoteFormat: '0-3:b::',
    })
    return { h, id }
  }

  it('saves the formatting with the offer', () => {
    const { h, id } = offered()
    expect(bold(h.props(id).offer?.note, h.props(id).offerNoteFormat)).toEqual(['Ask'])
  })

  it('moves it when the offer is rewritten with text alone', () => {
    const { h, id } = offered()
    h.run('application.update', {
      id,
      offer: { respondBy: '2026-11-03', note: 'Then: Ask for more startup' },
    })
    expect(bold(h.props(id).offer?.note, h.props(id).offerNoteFormat)).toEqual(['Ask'])
    // The assistant's stage move takes no formatting, and follows the same rule.
    h.run('application.stage.advance', {
      id,
      stage: 'offer',
      offer: { respondBy: '2026-11-04', note: 'Now then: Ask for more startup' },
    })
    expect(bold(h.props(id).offer?.note, h.props(id).offerNoteFormat)).toEqual(['Ask'])
  })

  it('goes with the offer, on every path that drops one', () => {
    for (const drop of [
      (h: ReturnType<typeof harness>, id: NodeId) =>
        h.run('application.stage.advance', { id, stage: 'closed', clearOffer: true }),
      (h: ReturnType<typeof harness>, id: NodeId) => h.run('application.offer.clear', { id }),
      (h: ReturnType<typeof harness>, id: NodeId) => h.run('application.update', { id, offer: null }),
    ]) {
      const { h, id } = offered()
      drop(h, id)
      expect(h.props(id)).not.toHaveProperty('offer')
      expect(h.props(id)).not.toHaveProperty('offerNoteFormat')
    }
  })

  it('is not handed to every card: the projection leaves it on the node', () => {
    const { h, id } = offered()
    const g = h.repo.getSnapshot()
    const row = applicationFrom(g.node(id, 'application')!, g, '2026-10-12')
    expect(row).not.toHaveProperty('offerNoteFormat')
    expect(row.offer?.note).toBe('Ask for more startup')
  })
})

describe('formatWrite, the one rule every rich note follows (Q268)', () => {
  const stored: NoteSpan[] = [{ start: 0, end: 6, bold: true }]

  it('keeps formatting sent, moves it under text sent alone, and otherwise writes nothing', () => {
    expect(formatWrite('URGENT x', 'URGENT x', stored, '7-8:i::')?.value).toEqual([
      { start: 7, end: 8, italic: true },
    ])
    expect(formatWrite('URGENT x', 'Now URGENT x', stored, undefined)?.value).toEqual([
      { start: 4, end: 10, bold: true },
    ])
    expect(formatWrite('URGENT x', undefined, stored, undefined)).toBeUndefined()
    expect(formatWrite('URGENT x', 'URGENT x', stored, '')).toEqual({ value: undefined })
  })
})

/*
 * Production data. Records already in IndexedDB and in backups have no format
 * prop at all; they must load as they are. A malformed one in a hand-edited
 * backup costs the formatting on restore, never the record.
 */
describe('stored records and backups (Q268)', () => {
  const row = (type: string, id: string, props: Record<string, unknown>) => ({
    id,
    type,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    props,
  })
  const item = (extra: Record<string, unknown> = {}) =>
    row('timelineItem', 'item:0199aaaa-0000-7000-8000-000000000101', {
      slug: 'chase',
      title: 'Chase',
      note: 'plain',
      date: '2026-10-20',
      kind: 'admin',
      urgency: 'gray',
      remind: false,
      ...extra,
    })
  const person = (extra: Record<string, unknown> = {}) =>
    row('person', 'person:0199aaaa-0000-7000-8000-000000000102', {
      slug: 'anita',
      name: 'Anita',
      note: 'plain',
      ...extra,
    })
  const application = (extra: Record<string, unknown> = {}) =>
    row('application', 'app:0199aaaa-0000-7000-8000-000000000103', {
      slug: 'rice',
      role: 'Asst Prof',
      note: 'plain',
      roleTag: 'Academic',
      stage: 'offer',
      lastAction: 'Offer received',
      lastActionAt: '2026-01-01T00:00:00.000Z',
      offer: { respondBy: '2026-11-01', note: 'Ask for more' },
      ...extra,
    })
  const malformed = [{ start: 'zero', end: 4, bold: true }]

  it('loads a record saved before the format props existed, unchanged', () => {
    const rows = [item(), person(), application()]
    const out = validateRows(rows, [])
    expect(out.skipped).toEqual([])
    expect(out.nodes.map((n) => n.props)).toEqual(rows.map((r) => r.props))
  })

  it('accepts the format props when well formed', () => {
    const spans = [{ start: 0, end: 3, bold: true }]
    const out = validateRows(
      [item({ noteFormat: spans }), person({ noteFormat: spans }), application({ offerNoteFormat: spans })],
      [],
    )
    expect(out.skipped).toEqual([])
    expect(out.nodes).toHaveLength(3)
  })

  it('drops a malformed one on restore and keeps the record', () => {
    const out = validateRows(
      [item({ noteFormat: malformed }), person({ noteFormat: malformed }), application({ offerNoteFormat: malformed })],
      [],
      { salvage: true },
    )
    expect(out.nodes).toHaveLength(3)
    for (const node of out.nodes) {
      expect(node.props).not.toHaveProperty('noteFormat')
      expect(node.props).not.toHaveProperty('offerNoteFormat')
      expect((node.props as { note?: string }).note).toBe('plain')
    }
  })
})
