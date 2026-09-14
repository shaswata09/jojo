/**
 * Which writes other tabs are told about.
 *
 * The event is what makes a second tab re-read the store, and re-reading
 * clears that tab's undo and redo stacks — so announcing a write that did not
 * happen is not a spurious notification, it is a person losing the ability to
 * take back what they just did. Both of these are real: the boot-time audit
 * prune rewrites journal rows on every launch, and until it was excluded here
 * opening a second tab wiped the first one's undo and told the person their
 * records had been reloaded.
 */

import { describe, expect, it } from 'vitest'
import { commitEvent, replaceEvent } from './idb-events'
import type { DurableOp } from '@jojo/service/storage/driver'

/** The two fields `commitEvent` reads off a journal row; the rest is not its business. */
const entry = (id: string, at: string) => ({ id, at }) as unknown as DurableOp extends {
  value: infer V
}
  ? V
  : never

/** How the repository appends: the store mints the number. */
const appended = (id: string, at: string): DurableOp => ({
  kind: 'put',
  store: 'ops',
  key: null,
  value: entry(id, at),
})

/** How the boot prune rewrites what is already there: at its own index. */
const rewritten = (index: number, id: string, at: string): DurableOp => ({
  kind: 'put',
  store: 'ops',
  key: index,
  value: entry(id, at),
})

describe('what counts as a write worth telling another tab about', () => {
  it('announces a journal entry the repository appended', () => {
    expect(commitEvent([appended('e1', '2026-09-13T09:00:00.000Z')])).toEqual({
      kind: 'commit',
      at: '2026-09-13T09:00:00.000Z',
      entryId: 'e1',
    })
  })

  it('says nothing about the boot-time audit prune', () => {
    /*
     * THE defect. The prune clears `ops` and writes every kept row back at its
     * own index, which happens on a launch where nothing changed.
     */
    const prune: DurableOp[] = [
      { kind: 'clear', store: 'ops' },
      rewritten(1, 'e1', '2026-09-13T09:00:00.000Z'),
      rewritten(2, 'e2', '2026-09-13T09:01:00.000Z'),
    ]
    expect(commitEvent(prune)).toBeNull()
  })

  it('still announces a real write that travels beside housekeeping', () => {
    // A batch that prunes AND appends is a batch somebody caused.
    const mixed: DurableOp[] = [
      { kind: 'clear', store: 'ops' },
      rewritten(1, 'e1', '2026-09-13T09:00:00.000Z'),
      appended('e2', '2026-09-13T09:02:00.000Z'),
    ]
    expect(commitEvent(mixed)?.entryId).toBe('e2')
  })

  it('says nothing about a batch that touches no journal row at all', () => {
    expect(
      commitEvent([{ kind: 'put', store: 'meta', key: 'store', value: entry('m', 'x') }]),
    ).toBeNull()
  })

  it('reads a wholesale replace off the meta row instead', () => {
    expect(
      replaceEvent({
        nodes: [],
        edges: [],
        ops: [],
        meta: [{ key: 'store', value: { lastOpenedAt: '2026-09-13T10:00:00.000Z' } }],
      } as never)?.at,
    ).toBe('2026-09-13T10:00:00.000Z')
  })
})
