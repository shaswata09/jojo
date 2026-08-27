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
import { AUDIT_CAP, readJournalRows, trimJournal } from './journal'
import { metaRow, opened } from './meta'
import type { StoreMeta } from './meta'
import { createRepository } from './repository'

/**
 * Edge rows whose ends are not in the store AT ALL — the only rows boot deletes.
 *
 * Read off the RAW rows, before validation, and that is the whole distinction.
 * `validateRows` skips an edge for two unrelated reasons and reports them with
 * the same sentence: the row is malformed, or the record it names is not there.
 * The first is data the user should be told about and must not be touched — a
 * node row that fails today's schema is still their record, and a fix-forward
 * migration can bring it back with its links intact, which deleting the links
 * would make impossible. The second names an id nothing in the store answers to.
 * Node ids are UUIDv7 and are never reissued, so no future boot can make that
 * edge valid; it is a row that fails validation on every launch, is counted into
 * "N records on this device could not be read and are not being shown", and can
 * never stop being counted.
 *
 * They exist because journal replay used to remove a node without naming the
 * edges the snapshot's cascade took with it (`withDisplacedEdges` in
 * `repository.ts` is that fix). That stops NEW ones; every store that already
 * hit it still has the row and still shows the banner, forever, which is why
 * this pass is here rather than only the fix.
 *
 * Logged with their ids rather than dropped quietly (R-1), but not counted into
 * `skipped`: `skipped` means "a record of yours is not on screen", and the thing
 * removed here is one end of a link whose other end went a long time ago.
 */
export function orphanEdgeKeys(rows: Rows): string[] {
  const present = new Set<string>()
  for (const row of rows.nodes) {
    const id = row['id']
    if (typeof id === 'string') present.add(id)
  }

  const orphans: string[] = []
  for (const row of rows.edges) {
    const id = row['id']
    const from = row['from']
    const to = row['to']
    // A row too broken to name its own ends is corrupt, not orphaned. It stays,
    // and it stays counted.
    if (typeof id !== 'string' || typeof from !== 'string' || typeof to !== 'string') continue
    if (!present.has(from) || !present.has(to)) orphans.push(id)
  }
  return orphans
}

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

  // Pruned before the count is reported, so the banner is right on THIS launch
  // rather than on the next one. See `orphanEdgeKeys` for what qualifies.
  const orphans = new Set(orphanEdgeKeys(rows))
  const skipped = validated.skipped.filter(
    (d) => !(d.store === 'edges' && d.id !== null && orphans.has(d.id)),
  )
  if (orphans.size > 0) {
    kgLog(`removed ${orphans.size} link row(s) that pointed at records that are gone`, {
      edges: [...orphans],
    })
  }

  if (skipped.length > 0) {
    kgWarn(`${skipped.length} record(s) could not be read and are not shown`, {
      skipped,
    })
  }

  const problems = checkInvariants(validated.nodes, validated.edges).map(
    (d) => `${d.store} ${d.id}: ${d.message}`,
  )
  if (problems.length > 0) {
    kgWarn(`the stored graph failed ${problems.length} integrity check(s)`, { problems })
  }

  const history = readJournalRows(rows.ops)
  // Capped first, then trimmed. `trimJournal` drops the record images from
  // everything older than the undo window — measured at 95% of the persisted
  // blob with the ring full, which on the phone is rewritten on every commit.
  const kept = trimJournal(history.slice(-AUDIT_CAP))
  const meta = opened(stored, at)

  // One transaction for the two things every open owes the store: the audit
  // trimmed to its cap, and `lastOpenedAt`. Written through the driver rather
  // than the queue because the repository does not exist yet, and in one batch
  // because the `clear` below and the rows that replace it must land together —
  // a half-landed prune is an audit log that cleared and did not come back.
  //
  // NOT because a counter continues from these keys, which is what this used to
  // say. There is no such counter: `opsFor` in `repository.ts` appends with
  // `key: null` and the store's own generator allocates, and its comment there
  // explains at length why a per-repository counter is the bug that destroyed
  // about half of a concurrent burst's journal rows. Do not read this block as
  // evidence that one exists. The explicit keys here are ORDER and nothing more,
  // and they stay below whatever the generator allocates next because `clear()`
  // does not rewind it.
  const chores: DurableOp[] = []
  for (const id of orphans) chores.push({ kind: 'delete', store: 'edges', key: id })
  // Rewritten when the cap dropped entries OR when the trim changed any of
  // them. Comparing identities rather than lengths: `trimJournal` returns the
  // same COUNT and different objects, so a length check would persist the full
  // images forever and the trim would only ever exist in memory.
  //
  // It rests on `readJournalRows` carrying `trimmed` back off disk, which is the
  // only way `trimJournal` can hand an already-trimmed entry back unchanged.
  // While that field was dropped on read, this was true on EVERY open: each
  // launch cleared `ops` and wrote all 200 rows back byte-identical, and said
  // 'pruned the audit log from 200 to 200 entries' while doing it.
  const trimmedSomething = kept.some((entry, i) => entry !== history[history.length - kept.length + i])
  if (kept.length < history.length || trimmedSomething) {
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
    session: live(driver, repo, options, { problems, skipped, crossTab }),
  }
}
