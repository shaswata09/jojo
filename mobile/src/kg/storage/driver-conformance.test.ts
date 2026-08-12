/**
 * The `Driver` contract, run against every shipped driver.
 *
 * `driver.ts` opens with "Never throws. Every method returns a Result", and
 * until this file nothing anywhere asserted it. Both drivers had their own
 * tests, each written against its own implementation, so the two could — and
 * did — disagree about the same input: a row the structured clone algorithm
 * refuses came back from `idb-driver` as `storage/corrupt` and came OUT of
 * `memory-driver` as a thrown DataCloneError. That divergence is invisible in a
 * per-driver suite by construction, and it is the enabling condition for the
 * write queue wedging on a rejection it never expected (`commitGuarded` in
 * `kg/repo/queue.ts` is the other half of the answer).
 *
 * So the rule for this file: it may not name a driver. Everything here is
 * written against the `Driver` interface and run over the list below, and the
 * day an AsyncStorage, SQLite or OPFS driver is added, adding it to that list
 * is the whole of its portability test. A test that only one driver can pass
 * belongs in that driver's own file.
 *
 * ON THIS COPY. The web app runs this over `memory-driver` and `idb-driver`,
 * with `fake-indexeddb/auto` giving the second a real implementation. Neither
 * IndexedDB nor that package exists here, so the IDB subject is replaced by
 * `rn-driver` — which is the case the paragraph above was written for, and the
 * reason this file was worth copying rather than leaving behind. The rule holds
 * unchanged: nothing below names a driver.
 *
 * AsyncStorage is mocked rather than stubbed to a no-op. The driver's whole job
 * is the round trip through it, and a mock that accepted writes without being
 * readable would pass every assertion here while shipping a store that loses
 * everything on close.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyRows } from './driver'
import type { Driver, DriverResult, DurableOp, Rows } from './driver'
import { createMemoryDriver } from './memory-driver'
import { createRnDriver } from './rn-driver'
import type { StoredRow } from './schema'

/** One string per key, which is all AsyncStorage is. */
const disk = new Map<string, string>()

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (k: string) => Promise.resolve(disk.get(k) ?? null),
    setItem: (k: string, v: string) => {
      disk.set(k, v)
      return Promise.resolve()
    },
    removeItem: (k: string) => {
      disk.delete(k)
      return Promise.resolve()
    },
  },
}))

// The RN driver writes to one fixed key, so two subjects in one run would
// otherwise inherit each other's rows.
beforeEach(() => disk.clear())

const SUBJECTS: readonly { label: string; make: () => Driver }[] = [
  { label: 'memory-driver', make: () => createMemoryDriver() },
  { label: 'rn-driver', make: () => createRnDriver() },
]

const node = (id: string): StoredRow => ({ id, type: 'application', props: {} })

const put = (id: string): DurableOp => ({ kind: 'put', store: 'nodes', key: id, value: node(id) })

/** A journal row as the repository enqueues one: no key, the store allocates. */
const journal = (id: string): DurableOp => ({
  kind: 'put',
  store: 'ops',
  key: null,
  value: { id },
})

/**
 * A row no store can take: `structuredClone` refuses a function.
 *
 * `props` is binary-free as an invariant (D27) rather than as a check, so the
 * value that reaches a driver is only ever as clean as the layer above. This is
 * the cheapest representable row that is not, and the drivers have to answer it
 * rather than raise it.
 */
const unstorableRow = { id: 'bad', props: { onSelect: () => 1 } } as unknown as StoredRow

const unstorable: DurableOp = { kind: 'put', store: 'nodes', key: 'bad', value: unstorableRow }

const rowsWith = (...nodes: readonly StoredRow[]): Rows => ({ ...emptyRows(), nodes })

/**
 * What came back, as something an assertion can print.
 *
 * The defect being guarded against is a REJECTION, so the call cannot simply be
 * awaited: an unhandled rejection fails the file with a stack trace instead of
 * naming the method that broke the contract. This turns both outcomes into a
 * one-line string, so a violation reads `expected 'threw DataCloneError: …' to
 * be 'DriverResult'`.
 */
async function shapeOf(call: () => Promise<DriverResult<unknown>>): Promise<string> {
  let outcome: unknown
  try {
    outcome = await call()
  } catch (e) {
    return `threw ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`
  }
  if (typeof outcome !== 'object' || outcome === null || !('ok' in outcome)) {
    return `returned a non-result: ${JSON.stringify(outcome)}`
  }
  return 'DriverResult'
}

const idsOf = (rows: readonly StoredRow[]): string[] => rows.map((row) => String(row['id']))

for (const subject of SUBJECTS) {
  describe(`Driver conformance: ${subject.label}`, () => {
    /**
     * Every method answers with a `DriverResult`, on the input designed to make
     * one of them not.
     *
     * The three write methods each carry a row that cannot be cloned. This is
     * the assertion the whole file exists for: `memory-driver` threw here, and
     * a thrown driver method is a write queue that discards its batch, freezes
     * its health at `writing` so neither banner fires, and never settles the
     * flush the tab is closing on.
     */
    it('returns a DriverResult for a row that cannot be stored, rather than throwing', async () => {
      const driver = subject.make()
      await driver.open()

      expect(await shapeOf(() => driver.commit([put('ok'), unstorable]))).toBe('DriverResult')
      expect(await shapeOf(() => driver.replace(rowsWith(node('a'), unstorableRow)))).toBe(
        'DriverResult',
      )
      expect(await shapeOf(() => driver.seedIfPristine(rowsWith(unstorableRow)))).toBe(
        'DriverResult',
      )

      driver.close()
    })

    /**
     * The batch is all of it or none of it, including when a row is refused
     * part-way through.
     *
     * `commit`'s own doc says "All ops in ONE readwrite transaction over all
     * four stores. Atomic." A failing REQUEST aborts its transaction by itself,
     * so that half was always true; a `put` that throws synchronously never
     * creates a request, and the rows issued before it were committed on the way
     * out — a store carrying half a batch that the journal has no entry for, and
     * `commit` reporting failure over it.
     */
    it('leaves nothing behind when a batch fails part-way through', async () => {
      const driver = subject.make()
      await driver.open()

      const written = await driver.commit([put('first'), unstorable, put('third')])
      expect(written.ok).toBe(false)

      const rows = await driver.readAll()
      expect(rows.ok && idsOf(rows.value.nodes)).toEqual([])

      driver.close()
    })

    /**
     * A closed driver still answers.
     *
     * `close()` is not a courtesy call: the `blocking` handler fires it while
     * the app is running, so anything already in flight above it arrives at a
     * driver that no longer has a connection. Whether each method reports
     * success or failure afterwards is the driver's business — `destroy` can
     * legitimately still delete a database nobody is holding open — but none of
     * them may throw, because the caller is a queue with no `catch`.
     */
    it('returns a DriverResult from every method after close(), rather than throwing', async () => {
      const driver = subject.make()
      await driver.open()
      driver.close()

      expect(await shapeOf(() => driver.open())).toBe('DriverResult')
      expect(await shapeOf(() => driver.readAll())).toBe('DriverResult')
      expect(await shapeOf(() => driver.commit([put('after')]))).toBe('DriverResult')
      expect(await shapeOf(() => driver.replace(emptyRows()))).toBe('DriverResult')
      expect(await shapeOf(() => driver.seedIfPristine(emptyRows()))).toBe('DriverResult')
      expect(await shapeOf(() => driver.destroy())).toBe('DriverResult')
    })

    /**
     * R-11, and the reason `seedIfPristine` is a driver method at all.
     *
     * An impatient reload during a slow first boot, or two tabs opened at once
     * on a fresh install, gives two seeders that both read "no meta" and both
     * write: 182 nodes, every record doubled, and no way to tell which of each
     * pair the user then edited. The emptiness test has to happen inside the
     * transaction that does the writing, which is why no caller can assemble
     * this out of `readAll` and `replace` — and why every driver has to answer
     * for it, not just the one the memory-driver header argues about.
     */
    it('seeds a pristine store once and declines the second time', async () => {
      const driver = subject.make()
      await driver.open()

      const first = await driver.seedIfPristine({
        ...rowsWith(node('seeded')),
        meta: [{ key: 'dataSet', value: 'demo' }],
      })
      expect(first).toEqual({ ok: true, value: true })

      const second = await driver.seedIfPristine({
        ...rowsWith(node('doubled')),
        meta: [{ key: 'dataSet', value: 'demo' }],
      })
      // `false` is a normal outcome, not a failure: somebody else got there
      // first and the caller's job is to read what they wrote.
      expect(second).toEqual({ ok: true, value: false })

      const rows = await driver.readAll()
      expect(rows.ok && idsOf(rows.value.nodes)).toEqual(['seeded'])

      driver.close()
    })

    /**
     * Pristine means the `meta` store is empty, not the node store (D24).
     *
     * The other reading reseeds over the user's own data every time they empty
     * their records, which is what makes Settings -> Records -> Empty impossible
     * to actually use.
     */
    it('treats a store with meta but no nodes as already seeded', async () => {
      const driver = subject.make()
      await driver.open()

      await driver.commit([
        { kind: 'put', store: 'meta', key: 'dataSet', value: { key: 'dataSet', value: 'empty' } },
      ])
      expect(await driver.seedIfPristine(rowsWith(node('reseeded')))).toEqual({
        ok: true,
        value: false,
      })

      driver.close()
    })

    /**
     * Ascending key order, because `getAll` returns it and the snapshot reads
     * "id-ascending = creation order" straight out of that.
     *
     * A driver handing back insertion order supplies the right answer for the
     * wrong reason on a store written in order, and a different one the first
     * time a row is rewritten.
     */
    it('reads each store back in ascending key order', async () => {
      const driver = subject.make()
      await driver.open()

      await driver.commit([put('c'), put('a'), put('b')])
      const rows = await driver.readAll()

      expect(rows.ok && idsOf(rows.value.nodes)).toEqual(['a', 'b', 'c'])

      driver.close()
    })

    /**
     * `key: null` means "let the store allocate it", and every allocation is a
     * new row.
     *
     * The alternative this codebase shipped was a per-tab counter: two tabs both
     * believed the next free key was 41, `put` overwrote rather than appended,
     * and roughly half of a concurrent burst's audit entries were destroyed. A
     * driver whose keyless put lands on one slot reintroduces that loss without
     * needing a second tab.
     */
    it('allocates a fresh key for every keyless journal row', async () => {
      const driver = subject.make()
      await driver.open()

      await driver.commit([journal('j1'), journal('j2')])
      await driver.commit([journal('j3')])
      const rows = await driver.readAll()

      expect(rows.ok && idsOf(rows.value.ops)).toEqual(['j1', 'j2', 'j3'])

      driver.close()
    })

    /** Both subscriptions hand back an unsubscribe, and it is safe to run twice. */
    it('returns an unsubscribe from each listener registration', async () => {
      const driver = subject.make()
      await driver.open()

      const offRemote = driver.onRemoteCommit(() => {})
      const offBlocking = driver.onBlocking(() => {})
      offRemote()
      offRemote()
      offBlocking()
      offBlocking()

      driver.close()
    })
  })
}
