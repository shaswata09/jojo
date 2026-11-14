/**
 * Undo of a timeline item edit puts back the fields the item did not have.
 *
 * The dialog's Undo used to call `update(id, storedRecordBefore)`. `update`
 * merges, so a key absent before the edit — an all-day item's `startMins` and
 * `durationMins` — was never cleared, and an all-day event came back timed.
 * `ItemForm` now takes the journal's `restore` (`useUndoable`) for an edit,
 * with the keyword write inside the same burst; this asserts the journal half
 * against a real repository with the shapes the dialog sends.
 */

import { describe, expect, it } from 'vitest'
import { MutableSnapshot } from '@jojo/service/core/snapshot'
import { createRepository } from '@jojo/service/repo/repository'
import { createToolRuntime } from '@jojo/service/tools/runtime'
import { undoableWith } from '@jojo/service/react/undo'

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
  return { repo, runtime: createToolRuntime({ repo, now }) }
}

describe('undoing a timeline item edit', () => {
  it('puts an all-day item back to all day, keywords included', () => {
    const h = harness()
    const created = h.runtime.run('timeline.item.create', {
      title: 'Campus visit',
      date: '2026-10-20',
      kind: 'interview',
    })
    if (!created.ok) throw new Error('create failed')
    const id = created.output as string
    const keyword = h.runtime.run('keyword.create', { name: 'Travel' })
    if (!keyword.ok) throw new Error('keyword failed')
    const props = () => h.repo.getSnapshot().node(id as never, 'timelineItem')?.props
    const tags = () =>
      h.repo
        .getSnapshot()
        .in(id as never, 'TAGS')
        .map((e) => e.from)

    const before = { ...props() }
    expect(before.startMins).toBeUndefined()

    const { restore } = undoableWith(h.repo, () => {
      const result = h.runtime.run('timeline.item.update', {
        id,
        startMins: 600,
        durationMins: 45,
        note: 'Bring the portfolio',
      })
      h.runtime.run('keyword.record.set', { record: id, keywords: [keyword.output] })
      return result
    })
    // The edit did land — otherwise the assertions below prove nothing.
    expect(props()?.startMins).toBe(600)
    expect(tags()).toHaveLength(1)

    expect(restore).not.toBeNull()
    restore?.()

    expect(props()?.startMins).toBeUndefined()
    expect(props()?.durationMins).toBeUndefined()
    expect(props()?.note).toBeUndefined()
    expect(props()).toEqual(before)
    expect(tags()).toHaveLength(0)
  })
})
