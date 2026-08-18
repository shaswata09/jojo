/**
 * The two claims the persistence UI makes that only the storage layer can settle.
 *
 * Settings' "clear browser storage" says jojo comes back as it would on a new
 * machine, and the recovery panel's "start fresh" says the same thing about a
 * database that could not be read. Both are one call — delete the database —
 * and both depend on a fact that is easy to state and easy to break: first run
 * is the ABSENCE of the meta row, so deleting the database has to take the meta
 * row with it or the next boot reads an empty store, finds a meta row saying
 * `dataSet: 'empty'`, and shows the user a blank app they never asked for.
 *
 * The other direction is the one that matters more, and it is the second test:
 * a user who deliberately emptied their records must NOT be reseeded by a
 * reload. The same code path decides both, which is exactly why they are
 * asserted next to each other.
 *
 * It lives in `src/lib` for the reason `kg-durability.test.ts` does: this is the
 * only place the two halves may meet. `repo` compiles with no DOM lib so it
 * cannot name the IndexedDB driver, and `storage` may not import upward.
 */

import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { boot, resetBoot } from '@jojo/service/repo/boot'
import { createIdbDriver } from '@/kg/storage/idb-driver'
import { createToolRuntime } from '@jojo/service/tools/runtime'

const NOW = '2026-10-12T12:00:00.000Z'
const LATER = '2026-10-13T09:30:00.000Z'

let sequence = 0
const nextName = () => `jojo-recovery-${(sequence += 1)}`

/**
 * One tab. `channel: null` because Node delivers BroadcastChannel messages
 * between contexts in the same process, so two "tabs" here would talk to each
 * other and to every other test file running in parallel.
 */
async function openTab(name: string, now: string) {
  resetBoot()
  const result = await boot({ now: () => now, driver: createIdbDriver({ name, channel: null }) })
  if (result.outcome === 'corrupt') throw new Error(`boot went corrupt: ${result.detail}`)
  return result
}

/** What Settings does after `clearSiteData`, and what *Start fresh* does. */
async function deleteDatabase(name: string) {
  const driver = createIdbDriver({ name, channel: null })
  const destroyed = await driver.destroy()
  driver.close()
  if (!destroyed.ok) throw new Error(destroyed.error.message)
}

describe('deleting the database', () => {
  it('takes the meta row with it, so the demo data legitimately returns', async () => {
    const name = nextName()

    const first = await openTab(name, NOW)
    expect(first.outcome).toBe('first-run')

    // The user empties their records and the choice is written down. Without the
    // delete below, this is what every later boot would honour.
    const runtime = createToolRuntime({ repo: first.session.repo, now: () => NOW })
    const cleared = runtime.run('memory.clear', {})
    expect(cleared.ok).toBe(true)
    expect(first.session.repo.getSnapshot().ofType('application')).toEqual([])
    await first.session.repo.flush()

    // Disposed BEFORE the delete, which is the ordering Settings depends on:
    // `deleteDatabase` against a connection this tab still holds fires `blocked`
    // and queues the delete until the connection closes, so the wipe reports
    // success and the records are still there on the next load.
    first.session.dispose()
    await deleteDatabase(name)

    const second = await openTab(name, LATER)
    expect(second.outcome).toBe('first-run')
    expect(second.session.meta.dataSet).toBe('demo')
    expect(second.session.meta.createdAt).toBe(LATER)
    expect(second.session.repo.getSnapshot().ofType('application').length).toBeGreaterThan(0)
    second.session.dispose()
  })

  it('is the only thing that brings it back — a reload alone does not', async () => {
    const name = nextName()

    const first = await openTab(name, NOW)
    const runtime = createToolRuntime({ repo: first.session.repo, now: () => NOW })
    runtime.run('memory.clear', {})
    await first.session.repo.flush()
    first.session.dispose()

    // D24, from the user's side: an emptied store reopened is still empty. The
    // sentence Settings used to carry — "a reload puts the demo data back and
    // takes your changes with it" — is deleted because of this line.
    const second = await openTab(name, LATER)
    expect(second.outcome).toBe('ready')
    expect(second.session.repo.getSnapshot().ofType('application')).toEqual([])
    second.session.dispose()
  })
})
