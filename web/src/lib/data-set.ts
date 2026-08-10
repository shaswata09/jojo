/**
 * Which set of records the store holds, applied as ONE wholesale write.
 *
 * There are two ways to put the demo fixtures into a store and two ways to take
 * them out, and until now the app used a different one in each direction:
 * `boot()` seeds through `driver.seedIfPristine` on a first run, while Settings
 * went through the `memory.reset` / `memory.clear` tools, which walk the graph
 * and emit a delete op per node. Both reach the same screen. Only one of them
 * reaches the same DATABASE — a tool's deletes are enqueued behind the write
 * queue and are only as complete as the type list at the top of `tools/memory.ts`,
 * so "cleared" meant "every record type we remembered to name is gone", which is
 * not the sentence Settings makes and not the one the first-run fork makes
 * either. `repo.replaceAll` clears every object store inside one transaction
 * (`idb-driver.ts:659`), so this file can promise the wipe rather than approximate
 * it.
 *
 * It also writes the meta row, and that is the half the tools cannot do at all.
 * A tool commit runs through `land()`, which flips `dataSet` to 'user' on the
 * first write (`repository.ts:213`) — correct for a user typing, wrong for the
 * user pressing *Start empty*, because it records "these are your records" about
 * a store that has none. `dataSet: 'empty'` with `seededAt: null` is the thing
 * D24's meta row exists to carry across a reload: the difference between a store
 * that is empty because the user asked and a store that is empty because it has
 * never run.
 *
 * `createdAt` and `schemaVersion` are carried over from the meta row that is
 * already there rather than minted fresh. Choosing a data set does not create a
 * new store — Diagnostics reads `createdAt` as "when did jojo start holding my
 * records", and resetting it on every *Load demo data* would make that field
 * mean "when did you last press a button in Settings".
 */

import type { StoreMeta } from '@/kg/repo/meta'
import type { GraphRows, Repository } from '@/kg/repo/repository'
import { seedToGraph } from '@/kg/repo/seed'
import type { Instant } from '@/kg/core/model'
import type { Result } from '@/kg/core/result'
import { kgWarn } from '@/kg/log'

/** What the user is choosing between. `'user'` is a state, not a choice. */
export type DataSetChoice = 'demo' | 'empty'

/** The rows a choice compiles to. Empty is empty — no keywords, no profile node. */
export function graphFor(choice: DataSetChoice, at: Instant): GraphRows {
  if (choice === 'empty') return { nodes: [], edges: [] }

  const graph = seedToGraph(at)
  // Reported rather than swallowed, for the reason `seed.ts` gives: a fixture key
  // that resolves to nothing is a keyword the user can neither see nor remove,
  // and the console is the only place this app can say so. `boot()` surfaces the
  // same list through Diagnostics; a reseed from Settings has no equivalent seam,
  // so this at least does not go quiet.
  if (graph.unresolved.length > 0) {
    kgWarn(`the demo data has ${graph.unresolved.length} reference(s) that resolve to nothing`, {
      unresolved: graph.unresolved,
    })
  }
  return { nodes: graph.nodes, edges: graph.edges }
}

/** The meta row that records the choice, on top of the one already on disk. */
export function metaFor(current: StoreMeta, choice: DataSetChoice, at: Instant): StoreMeta {
  return {
    ...current,
    dataSet: choice,
    lastOpenedAt: at,
    // Never a timestamp for 'empty'. `seededAt` is what a later reader would use
    // to decide the fixtures are already in there, and a store the user asked to
    // be empty must not be able to answer yes to that question.
    seededAt: choice === 'demo' ? at : null,
  }
}

/**
 * Replaces every record with the chosen set, and says so in the meta row.
 *
 * Returns the repository's own `Result` rather than throwing: the caller is a
 * dialog with a button in it, and a rejected IndexedDB transaction has to become
 * a sentence on screen rather than an unhandled rejection in a console the user
 * does not have open. Not undoable, by construction — `replaceAll` clears the
 * journal, because every before-image in it describes a record that no longer
 * exists.
 */
export function applyDataSet(
  repo: Repository,
  choice: DataSetChoice,
  at: Instant,
): Promise<Result<void>> {
  return repo.replaceAll(graphFor(choice, at), metaFor(repo.meta, choice, at))
}
