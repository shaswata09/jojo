/**
 * L2 — open -> migrate -> read -> validate -> build snapshot -> seed.
 *
 * Two entry points, and the difference between them is durability rather than
 * behaviour. `boot()` is the real one: it opens IndexedDB, runs the migrations,
 * validates every row it reads and hands back a repository whose writes survive
 * the tab closing. `bootInMemory()` is the same graph with nothing behind it, and
 * it is what runs when storage is unavailable — the app must still work in a
 * private-browsing window; it just cannot promise anything, and says so through
 * `Session.durable`.
 *
 * `runBoot` below chooses between two continuations, and each is its own file
 * because each answers a different question later. `firstRun` is here, next to
 * the D24 rule it exists to obey. The store-already-exists path is
 * `boot-ready.ts` — the trust boundary, where a stored row becomes a checked
 * record. What both of them hand back is `boot-live.ts`, which is everything
 * that goes on happening after boot returns.
 *
 *
 * FIRST RUN IS THE ABSENCE OF THE META ROW (D24)
 *
 * Not "the node store is empty". The two agree exactly once — on a fresh install
 * — and disagree on the case that matters: a user who used Settings → Records →
 * Empty has an empty node store and a meta row saying `dataSet: 'empty'`,
 * `seededAt: null`. Treating that as a first run reseeds the demo fixtures on
 * every single reload, which makes the Empty button impossible to actually use
 * and silently buries whatever the user was about to type. `readMeta` returns
 * `null` for absent and `'corrupt'` for present-but-unreadable precisely so this
 * function cannot collapse the two.
 *
 * A corrupt database NEVER auto-reseeds. Reseeding to make the app look healthy
 * is the single worst outcome available here — it turns a recoverable problem
 * into a permanent one, and it does it while looking like a successful boot.
 * The corrupt arm carries the rows it managed to read so the recovery panel can
 * offer *Download what we could read* before anything else.
 *
 *
 * THE INTEGRITY CHECK RUNS HERE, NOT IN THE SEED COMPILER
 *
 * R-2's question is whether the UUID migration left an edge pointing at an id
 * nobody minted, and that is a question about the graph as assembled — which is
 * the thing this function is holding. A failure is logged and the app still
 * starts: a seed bug must be loud in the console, not a white screen for a user
 * whose own records are fine.
 */

import { checkInvariants } from '../core/validate'
import type { Diagnostic } from '../core/validate'
import type { Instant, StoredEdge, StoredNode } from '../core/model'
import { MutableSnapshot } from '../core/snapshot'
import { kgLog, kgWarn } from '../log'
import { emptyRows } from '../storage/driver'
import type { Driver, Rows } from '../storage/driver'
import { createMemoryDriver } from '../storage/memory-driver'
import type { StoredRow } from '../storage/schema'
import { live } from './boot-live'
import { ready } from './boot-ready'
import { freshMeta, metaRow, readMeta } from './meta'
import type { StoreMeta } from './meta'
import { createRepository } from './repository'
import type { Repository } from './repository'
import { seedToGraph } from './seed'

export type Session = {
  repo: Repository
  meta: StoreMeta
  /** Integrity failures in the graph as assembled. Settings' Diagnostics panel. */
  problems: readonly string[]
  /**
   * Records that were read and NOT shown, with the reason.
   *
   * Never empty-and-ignored: local-first means a silently skipped node is lost
   * work with no server backup and no undo, so every one of these is counted in
   * Diagnostics and logged with its id.
   */
  skipped: readonly Diagnostic[]
  /** False when the graph lives only in RAM. The banner has to say so. */
  durable: boolean
  /** Drops the cross-tab subscriptions, stops the write queue, closes the driver. */
  dispose(): void
}

export type BootResult =
  | { outcome: 'ready'; session: Session }
  | { outcome: 'first-run'; session: Session }
  /**
   * Carries a working session anyway.
   *
   * §3.5's gate renders a panel instead of the app for this phase, and §5's
   * demoable for this wave says a private-browsing window "shows an honest
   * banner and still runs". Both are reachable from here — the session is the
   * in-memory one — and which to do is the UI's call, not this layer's. What
   * this layer must not do is force the harsher of the two by having nothing to
   * hand over.
   */
  | { outcome: 'unavailable'; reason: 'blocked' | 'unsupported'; detail: string; session: Session }
  | { outcome: 'corrupt'; detail: string; rescued: Rows | null }

export type BootOptions = {
  /** Injected. No module in kg/ reads a clock of its own (D26). */
  now: () => Instant
  /** 'demo' loads the fixtures; 'empty' starts with nothing. First run only. */
  dataSet?: 'demo' | 'empty'
}

export type DurableBootOptions = BootOptions & {
  /**
   * Supplied by the composition root, never constructed here.
   *
   * `createIdbDriver()` is one import away and this is where it is obviously
   * wanted, which is exactly why it is not taken: `tsconfig.kg.json` compiles
   * `repo` with no DOM lib at all, so importing the IndexedDB driver puts
   * `indexedDB` and `BroadcastChannel` into a program that has never heard of
   * them, and this file stops compiling for React Native. Same reason the clock
   * is injected (D26) and the same reason `KgProvider` takes a `Host` rather
   * than importing the web one. The web app names its driver in
   * `src/lib/store.tsx`; a native shell names a different one there.
   */
  driver: Driver
  /** Another tab is upgrading and we have closed. The app must ask for a reload. */
  onBlocking?: () => void
  /** A remote change has been adopted; the snapshot is new and undo is cleared. */
  onRemoteChange?: () => void
  /**
   * The tab came back to the foreground. Supplied by the composition root.
   *
   * Subscribed ONLY when the store reports `crossTab: false` — see `live`. On a
   * browser with a working BroadcastChannel this is never called.
   */
  onResume?: (fn: () => void) => () => void
}

const rowOf = (record: StoredNode | StoredEdge): StoredRow => record as unknown as StoredRow

/**
 * The stand-in session a failed open falls back to. Always empty, never seeded.
 *
 * This is the counterpart to the rule at the top of this file, arriving through
 * the door that rule does not guard. A corrupt store never auto-reseeds because
 * showing fixtures over records we could not read turns a recoverable problem
 * into a permanent-looking one — and an open that failed is the same situation
 * with less information, not a different one. `storage/blocked` in particular
 * means there IS a database on disk: an old tab that reloads after a deploy
 * takes this path with the user's real records sitting intact underneath, and
 * seeding demo data here put twelve fabricated applications on screen labelled
 * only "nothing you change is saved". Nowhere did anything say they were not the
 * user's.
 *
 * Empty is the honest reading. It is also the safe one: `StorageBanner` says the
 * store could not be opened, and an empty list under that sentence reads as "we
 * could not load anything", which is exactly what happened.
 */
const bootStandIn = (options: BootOptions): Session =>
  bootInMemory({ now: options.now, dataSet: 'empty' })

/* ------------------------------- in memory -------------------------------- */

export function bootInMemory({ now, dataSet = 'demo' }: BootOptions): Session {
  const at = now()
  const graph = dataSet === 'demo' ? seedToGraph(at) : { nodes: [], edges: [], unresolved: [] }

  const problems = [
    ...graph.unresolved.map((ref) => `Seed reference resolved to nothing: ${ref}`),
    ...checkInvariants(graph.nodes, graph.edges).map((d) => `${d.store} ${d.id}: ${d.message}`),
  ]
  if (problems.length > 0) {
    kgWarn(`the seeded graph failed ${problems.length} integrity check(s)`, { problems })
  }

  const driver = createMemoryDriver({ rows: emptyRows() })
  // Not awaited, and deliberately so: `bootInMemory` is synchronous because the
  // provider that calls it must return a repository on the first render, and a
  // memory driver's open cannot fail. The driver that CAN fail is `boot()`'s,
  // and that one is async — this is not the seam to sneak a promise through.
  void driver.open()

  const meta = freshMeta(at, dataSet)
  const snapshot = MutableSnapshot.from(graph.nodes, graph.edges)
  const repo = createRepository({ driver, snapshot, meta, now })

  return {
    repo,
    // Delegated rather than copied. `dataSet` flips from 'demo' to 'user' on the
    // first write the user makes (`touched` in `meta.ts`), and a Session holding
    // its own
    // copy would go on reporting 'demo' — which is what Settings reads before
    // offering to replace their records with the fixtures.
    get meta() {
      return repo.meta
    },
    problems,
    skipped: [],
    durable: false,
    dispose: () => repo.close(),
  }
}

/* ---------------------------------- boot ---------------------------------- */

/**
 * The in-flight boot, kept for the life of the process.
 *
 * StrictMode mounts the provider twice, and a `boot()` per mount is two
 * connections to the same database, two seed attempts on a fresh install, and —
 * R-11 — an impatient reload during a slow first boot colliding every id through
 * the slug minter into `rice-2`, `rice-3`. Deliberately NOT cleared when it
 * settles: the second mount must get the SAME session, not a fresh one opened
 * against a store the first is already writing to.
 */
let inFlight: Promise<BootResult> | null = null

export function boot(options: DurableBootOptions): Promise<BootResult> {
  inFlight ??= runBoot(options)
  return inFlight
}

/**
 * Forgets the cached boot so the next `boot()` runs for real.
 *
 * Two callers. Tests, which boot a store per case. And the recovery panel's
 * *Try again*, which without this would hand the user back the same cached
 * `corrupt` result forever and look like a button that does nothing. Note that
 * the failed boot closed its driver on the way out, so a retry has to supply a
 * fresh one — which is why the reset is a separate call rather than something
 * `boot()` decides for itself: only the caller knows whether it can.
 */
export function resetBoot(): void {
  inFlight = null
}

async function runBoot(options: DurableBootOptions): Promise<BootResult> {
  const { now, dataSet = 'demo', driver } = options

  const open = await driver.open()
  if (!open.ok) {
    driver.close()
    if (open.error.code === 'storage/corrupt') {
      return { outcome: 'corrupt', detail: open.error.message, rescued: null }
    }
    kgWarn('storage is unavailable; running in memory', { detail: open.error.message })
    return {
      outcome: 'unavailable',
      reason: open.error.code === 'storage/blocked' ? 'blocked' : 'unsupported',
      detail: open.error.message,
      session: bootStandIn(options),
    }
  }
  if (open.value.migrated.length > 0) {
    kgLog(`migrated the database from v${open.value.from} to v${open.value.version}`, {
      steps: open.value.migrated,
    })
  }

  const read = await driver.readAll()
  if (!read.ok) {
    driver.close()
    // Anything that stops us reading the store is reported as corruption rather
    // than as unavailability, because the recovery differs: unavailable means
    // "run without saving", corrupt means "do not touch what is there until the
    // user has been offered a copy of it".
    return { outcome: 'corrupt', detail: read.error.message, rescued: null }
  }

  const stored = readMeta(read.value.meta)
  if (stored === 'corrupt') {
    driver.close()
    return {
      outcome: 'corrupt',
      detail: "the store's own record of itself could not be read",
      rescued: read.value,
    }
  }

  if (stored === null) return firstRun(driver, options, dataSet, open.value.crossTab)
  return ready(driver, options, read.value, stored, now(), open.value.crossTab)
}

/* -------------------------------- first run ------------------------------- */

async function firstRun(
  driver: Driver,
  options: DurableBootOptions,
  dataSet: 'demo' | 'empty',
  crossTab: boolean,
): Promise<BootResult> {
  const at = options.now()
  const graph = dataSet === 'demo' ? seedToGraph(at) : { nodes: [], edges: [], unresolved: [] }
  const meta = freshMeta(at, dataSet)

  const problems = [
    ...graph.unresolved.map((ref) => `Seed reference resolved to nothing: ${ref}`),
    ...checkInvariants(graph.nodes, graph.edges).map((d) => `${d.store} ${d.id}: ${d.message}`),
  ]
  if (problems.length > 0) {
    kgWarn(`the seeded graph failed ${problems.length} integrity check(s)`, { problems })
  }

  // Seed and meta in ONE transaction, conditional on the meta store still being
  // empty inside that transaction. Both halves matter: without the transaction a
  // crash mid-seed leaves records with no meta row, which is a first run again
  // and seeds a second copy over the top; without the condition, two tabs opened
  // together on a fresh install both seed.
  const seeded = await driver.seedIfPristine({
    nodes: graph.nodes.map(rowOf),
    edges: graph.edges.map(rowOf),
    meta: [metaRow(meta)],
    ops: [],
  })

  if (!seeded.ok) {
    driver.close()
    kgWarn('could not write the first-run store; running in memory', {
      detail: seeded.error.message,
    })
    return {
      outcome: 'unavailable',
      reason: seeded.error.code === 'storage/blocked' ? 'blocked' : 'unsupported',
      detail: seeded.error.message,
      session: bootStandIn(options),
    }
  }

  if (!seeded.value) {
    // Somebody else seeded between our read and our write. Theirs is the store
    // now — read it back rather than assuming it matches what we compiled, since
    // every id in it was minted by their process, not ours.
    kgLog('another tab seeded first; reading its store instead')
    const again = await driver.readAll()
    const stored = again.ok ? readMeta(again.value.meta) : 'corrupt'
    if (!again.ok || stored === null || stored === 'corrupt') {
      driver.close()
      return {
        outcome: 'corrupt',
        detail: 'another tab seeded the store and it could not be read back',
        rescued: again.ok ? again.value : null,
      }
    }
    return ready(driver, options, again.value, stored, options.now(), crossTab)
  }

  const snapshot = MutableSnapshot.from(graph.nodes, graph.edges)
  const repo = createRepository({ driver, snapshot, meta, now: options.now })

  return {
    outcome: 'first-run',
    session: live(driver, repo, options, { problems, skipped: [], crossTab }),
  }
}
