/**
 * Q268 — the formatting on a timeline item's, a person's and an offer's note,
 * as the rest of the service treats it: kept out of the rows every screen and
 * every model prompt reads, and undone together with the text it is laid over.
 * The same three rules an application's note and a file's note already follow.
 */
import { describe, expect, it } from 'vitest'
import type { NodeId } from '../core/model'
import { runsOf } from '../core/note-format'
import { MutableSnapshot } from '../core/snapshot'
import { render } from '../agent/records'
import { createRepository } from '../repo/repository'
import { createToolRuntime } from '../tools/runtime'
import { createProjections } from './projections'

const NOW = '2026-10-12T09:00:00.000Z'

function world() {
  const driver = {
    open: async () => ({ ok: true as const, value: { version: 1, from: 0, migrated: [], crossTab: false } }),
    readAll: async () => ({ ok: true as const, value: { nodes: [], edges: [], meta: [], ops: [] } }),
    commit: async () => ({ ok: true as const, value: undefined }),
    replace: async () => ({ ok: true as const, value: undefined }),
    seedIfPristine: async () => ({ ok: true as const, value: true }),
    destroy: async () => ({ ok: true as const, value: undefined }),
    onRemoteCommit: () => () => {},
    onBlocking: () => () => {},
    close: () => {},
  }
  let tick = 0
  const now = () => new Date(Date.parse(NOW) + tick++ * 1000).toISOString()
  const repo = createRepository({
    driver: driver as unknown as Parameters<typeof createRepository>[0]['driver'],
    snapshot: new MutableSnapshot(),
    meta: { schemaVersion: 1, createdAt: NOW, lastOpenedAt: NOW, dataSet: 'user', seededAt: null, handoverAt: null },
    now,
  })
  const runtime = createToolRuntime({ repo, now })
  const run = (name: string, input: unknown) => {
    const out = runtime.run(name as never, input as never)
    if (!out.ok) throw new Error(out.errors.map((e) => e.message).join('; '))
    return out
  }
  return { repo, run }
}

const formatted = (w: ReturnType<typeof world>) => {
  const item = w.run('timeline.item.create', {
    title: 'Chase',
    date: '2026-10-20',
    kind: 'follow-up',
    note: 'Ask about it',
    noteFormat: '0-3:b::',
  }).output as NodeId
  const person = w.run('vault.person.create', { name: 'Anita', note: 'Ask about it', noteFormat: '0-3:b::' })
    .output as NodeId
  const app = w.run('application.create', { org: 'Rice', role: 'AP', roleTag: 'Faculty', stage: 'interview' })
    .output as NodeId
  w.run('application.update', {
    id: app,
    stage: 'offer',
    offer: { respondBy: '2026-11-01', note: 'Ask about it' },
    offerNoteFormat: '0-3:b::',
  })
  return { item, person, app }
}

describe('the rows screens and models read (Q268)', () => {
  it('leave the spans on the node, as a file’s and an application’s do', () => {
    const w = world()
    const { item, person } = formatted(w)
    const g = w.repo.getSnapshot()
    const p = createProjections('2026-10-12')
    expect(p.timeline(g).find((i) => i.id === item)).not.toHaveProperty('noteFormat')
    expect(p.people(g).find((x) => x.id === person)).not.toHaveProperty('noteFormat')
  })

  it('are not shown to a model', () => {
    const w = world()
    const { item, person, app } = formatted(w)
    const g = w.repo.getSnapshot()
    expect(render(g.node(item)!, g)).not.toHaveProperty('noteFormat')
    expect(render(g.node(person)!, g)).not.toHaveProperty('noteFormat')
    expect(render(g.node(app)!, g)).not.toHaveProperty('offerNoteFormat')
  })
})

describe('Undo (Q268)', () => {
  it('treats a note and its formatting as one, so a later edit to the text pins both', () => {
    for (const [tool, extra] of [
      ['timeline.item.create', { title: 'Chase', date: '2026-10-20', kind: 'follow-up' }],
      ['vault.person.create', { name: 'Anita' }],
    ] as const) {
      const w = world()
      const id = w.run(tool, { ...extra, note: 'Ask about' }).output as NodeId
      const update = tool === 'timeline.item.create' ? 'timeline.item.update' : 'vault.person.update'
      const bolded = w.run(update, { id, note: 'Ask about', noteFormat: '0-3:b::' })
      // The phone, later, adds to the text alone; the bold stays on "Ask".
      w.run(update, { id, note: 'Ask about it' })

      expect(bolded.undo?.()).toBe('nothing')
      const props = w.repo.getSnapshot().node(id)?.props as { note: string; noteFormat?: never }
      expect(runsOf(props.note, props.noteFormat).filter((r) => r.bold).map((r) => r.text)).toEqual(['Ask'])
    }
  })
})
