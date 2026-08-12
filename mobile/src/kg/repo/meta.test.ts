/**
 * D24, which is one sentence and one bug: first run is the ABSENCE of the meta
 * row, never "the node store is empty".
 *
 * Read the other way, Settings → Records → Empty reseeds the demo data on every
 * reload, which makes the button impossible to actually use — you press it, the
 * records go, you come back tomorrow and they are all there again.
 */

import { describe, expect, it } from 'vitest'
import type { MetaRow } from '../storage/schema'
import {
  META_KEY,
  SCHEMA_VERSION,
  freshMeta,
  isFirstRun,
  metaRow,
  opened,
  readMeta,
  touched,
} from './meta'

const NOW = '2026-10-12T09:00:00.000Z'

describe('first-run detection', () => {
  it('is first run only when the meta row is absent', () => {
    expect(isFirstRun([])).toBe(true)
    expect(isFirstRun([metaRow(freshMeta(NOW, 'demo'))])).toBe(false)
  })

  // The whole point. An emptied store has a meta row and no nodes, and reading
  // "no nodes" as "first run" is what puts the demo data back over the user's
  // deliberate choice.
  it('is NOT first run for a store the user deliberately emptied', () => {
    const meta = freshMeta(NOW, 'empty')

    expect(isFirstRun([metaRow(meta)])).toBe(false)
    expect(meta.seededAt).toBeNull()
    expect(meta.dataSet).toBe('empty')
  })

  /**
   * A row that is present but unreadable is corruption, not a first run.
   *
   * Answering "first run" to it would seed demo data over records that are
   * probably still sitting in the nodes store, recoverable — and R-1 names
   * reseeding to make the app look healthy as the single worst outcome here.
   */
  it('reports a damaged row as corrupt rather than as a first run', () => {
    const cases: MetaRow[] = [
      { key: META_KEY, value: null },
      { key: META_KEY, value: 'demo' },
      { key: META_KEY, value: { schemaVersion: '1' } },
      { key: META_KEY, value: { ...freshMeta(NOW, 'demo'), dataSet: 'sample' } },
      { key: META_KEY, value: { ...freshMeta(NOW, 'demo'), seededAt: 12 } },
    ]

    for (const row of cases) expect(readMeta([row])).toBe('corrupt')
  })

  it('ignores rows that are not the meta row', () => {
    expect(readMeta([{ key: 'something-else', value: { a: 1 } }])).toBeNull()
  })

  it('round-trips a good row', () => {
    const meta = freshMeta(NOW, 'demo')
    expect(readMeta([metaRow(meta)])).toEqual(meta)
    expect(meta.schemaVersion).toBe(SCHEMA_VERSION)
    expect(meta.seededAt).toBe(NOW)
  })
})

describe('lifecycle', () => {
  it('stamps lastOpenedAt without moving createdAt', () => {
    const meta = freshMeta(NOW, 'demo')
    const later = opened(meta, '2026-11-01T08:00:00.000Z')

    expect(later.createdAt).toBe(NOW)
    expect(later.lastOpenedAt).toBe('2026-11-01T08:00:00.000Z')
  })

  /**
   * Demo data stops being demo data the moment it is edited.
   *
   * Left at 'demo', Settings goes on offering to replace the user's records with
   * the fixtures, and describes a store they have been working in all week as
   * sample data.
   */
  it('promotes demo and empty to user on the first write, and then holds still', () => {
    expect(touched(freshMeta(NOW, 'demo')).dataSet).toBe('user')
    expect(touched(freshMeta(NOW, 'empty')).dataSet).toBe('user')

    const user = touched(freshMeta(NOW, 'demo'))
    // Identity, not equality: `commit` calls this on every write and compares by
    // reference to decide whether a meta row needs writing at all.
    expect(touched(user)).toBe(user)
  })

  it('keeps seededAt when the demo data is later edited', () => {
    expect(touched(freshMeta(NOW, 'demo')).seededAt).toBe(NOW)
  })
})
