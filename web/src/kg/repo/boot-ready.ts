/**
 * L2 — the path taken when the store already exists: validate it, then open it.
 *
 * THE trust boundary of the whole app lives in this file. Above `validateRows`
 * a stored record is a JSON blob with a primary key; below it, it is a checked
 * record. A row that does not survive the crossing is not shown — which is why
 * `skipped` is counted and logged rather than dropped, and why a record that is
 * unexpectedly missing from a screen is a question that starts here.
 *
 * Reached from `runBoot` when the meta row is present and readable, and from
 * `firstRun` when another tab seeded the store first. Both are in `boot.ts`.
 */

import type { Instant } from '../core/model'
import { MutableSnapshot } from '../core/snapshot'
import { checkInvariants, validateRows } from '../core/validate'
import { kgLog, kgWarn } from '../log'
import type { Driver, DurableOp, Rows } from '../storage/driver'
import type { StoredRow } from '../storage/schema'
import type { BootResult, DurableBootOptions } from './boot'
import { live } from './boot-live'
import { AUDIT_CAP, readJournalRows } from './journal'
import { metaRow, opened } from './meta'
import type { StoreMeta } from './meta'
import { createRepository } from './repository'

export async function ready(
  driver: Driver,
  options: DurableBootOptions,
  rows: Rows,
  stored: StoreMeta,
  at: Instant,
  crossTab: boolean,
): Promise<BootResult> {
  // THE trust boundary. Everything below this line is a checked record; nothing
  // above it was more than a JSON blob with a primary key.
  const validated = validateRows(rows.nodes, rows.edges)
  if (validated.skipped.length > 0) {
    kgWarn(`${validated.skipped.length} record(s) could not be read and are not shown`, {
      skipped: validated.skipped,
    })
  }

  const problems = checkInvariants(validated.nodes, validated.edges).map(
    (d) => `${d.store} ${d.id}: ${d.message}`,
  )
  if (problems.length > 0) {
    kgWarn(`the stored graph failed ${problems.length} integrity check(s)`, { problems })
  }

  const history = readJournalRows(rows.ops)
  const kept = history.slice(-AUDIT_CAP)
  const meta = opened(stored, at)

  // One transaction for the two things every open owes the store: the audit
  // trimmed to its cap, and `lastOpenedAt`. Written through the driver rather
  // than the queue because the repository does not exist yet, and because a
  // prune that only half-landed would leave the ops keys non-contiguous — which
  // is what the repository's sequence counter continues from below.
  const chores: DurableOp[] = []
  if (kept.length < history.length) {
    chores.push({ kind: 'clear', store: 'ops' })
    kept.forEach((entry, index) => {
      chores.push({
        kind: 'put',
        store: 'ops',
        key: index + 1,
        value: entry as unknown as StoredRow,
      })
    })
    kgLog(`pruned the audit log from ${history.length} to ${kept.length} entries`)
  }
  const row = metaRow(meta)
  chores.push({ kind: 'put', store: 'meta', key: row.key, value: row })

  const written = await driver.commit(chores)
  if (!written.ok) {
    // Not fatal, and deliberately so. A store we can read but not write is still
    // a store the user can look at, and the write queue's health is what tells
    // them the rest — escalating to the recovery panel here would hide their
    // records behind a message about a timestamp.
    kgWarn('could not stamp the store on open', { detail: written.error.message })
  }

  const snapshot = MutableSnapshot.from(validated.nodes, validated.edges)
  const repo = createRepository({
    driver,
    snapshot,
    meta,
    now: options.now,
    audit: kept,
  })

  return {
    outcome: 'ready',
    session: live(driver, repo, options, { problems, skipped: validated.skipped, crossTab }),
  }
}
