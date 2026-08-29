/**
 * The `Driver` contract as a HARNESS, not as a suite.
 *
 * `driver.ts` opens with "Never throws. Every method returns a Result", and
 * until this contract existed nothing anywhere asserted it. Each driver had its
 * own tests, each written against its own implementation, so two could — and
 * did — disagree about the same input: a row the structured clone algorithm
 * refuses came back from `idb-driver` as `storage/corrupt` and came OUT of
 * `memory-driver` as a thrown DataCloneError. That divergence is invisible in a
 * per-driver suite by construction, and it is the enabling condition for the
 * write queue wedging on a rejection it never expected (`commitGuarded` in
 * `kg/repo/queue.ts` is the other half of the answer).
 *
 * So the rule for this file: it may not name a driver. Everything below is
 * written against the `Driver` interface, and adding a driver is a call to
 * `describeDriverConformance` from wherever that driver lives. A test that only
 * one driver can pass belongs in that driver's own file.
 *
 * WHY IT IS A FUNCTION AND NOT A `SUBJECTS` ARRAY.
 *
 * It was an array, twice — once in the web app over `memory` and `idb`, once in
 * the phone's copy over `memory` and `rn`. An array only reaches drivers that
 * can be imported from where the array is, and the three drivers cannot be: the
 * IndexedDB one needs `fake-indexeddb`, the React Native one needs an
 * AsyncStorage mock, and neither may be a dependency of this package. So the
 * list was split by platform, and the split is what let the phone's copy run a
 * one-generation-old contract against the one file in the repo that nothing else
 * covers. Inverting it — the contract here, the subject at each call site — is
 * what makes "every shipped driver" true by construction rather than by three
 * lists agreeing.
 *
 * NOT named `*.test.ts`, deliberately. Vitest collects by that suffix and this
 * file declares no subject of its own, so a collected copy would be an empty
 * file in every run. `driver-conformance.test.ts` beside it supplies the one
 * subject that needs no platform.
 *
 * WHAT EACH SUBJECT OWES. `crossTab`, `durable` and `refusable` are declared per
 * subject, and each selects a case. `durable` is the older two's newer sibling
 * and the package's own subject cannot set it — `memory-driver` has no store to
 * reopen — so the case it selects runs only where a real one is built:
 * `web/src/kg/storage/idb-conformance.test.ts` and `mobile/src/kg/storage/
 * rn-conformance.test.ts`. A durable driver whose subject omits it is running a
 * contract that cannot tell whether it writes to disk at all.
 *
 * `refusable` is the newest, and it exists because the same sentence turned out
 * to be true of failure: a driver whose subject omits it runs a contract that
 * cannot tell an ACCEPTED write from a PERSISTED one. Everything else here
 * provokes failure with a row `structuredClone` refuses, which the driver
 * catches before the store is touched — so a driver that applied the rows to a
 * mirror first and wrote the mirror to disk second passed the whole file while
 * a refused `replace` was destroying the user's records on the next edit.
 */

import { describe, expect, it } from 'vitest'
import { emptyRows } from './driver'
import type { Driver, DriverResult, DurableOp, Rows, StoreEvent } from './driver'
import type { StoredRow } from './schema'

/**
 * A driver, plus the shove that stands in for another tab.
 *
 * A driver cannot make a remote commit happen to itself: a remote commit is by
 * definition somebody else's write, and how it arrives is the one part of the
 * `Driver` contract that is not on the interface. Declaring it in the subject
 * rather than in a test body is what keeps the bodies written against `Driver`
 * alone, which is this file's rule — the call site is where a driver may be
 * named.
 *
 * `onBlocking` gets no equivalent, and deliberately. Provoking it means a second
 * connection upgrading the schema, which is a version number and a migration
 * list — the memory driver has neither. Its unsubscribe is pinned in each
 * driver's own file instead, which is what the rule above says to do with a test
 * only one driver can pass.
 */
export type DriverSubject = {
  readonly label: string
  readonly make: () => {
    driver: Driver
    remoteCommit: (event: StoreEvent) => void
    /** Required when `durable` is true: a new Driver over the same store. */
    reopen?: () => Driver
    /**
     * Required when `refusable` is true: make the BACKING STORE refuse writes,
     * and hand back the call that lets them through again.
     *
     * Declared by the subject for the same reason `remoteCommit` is — a driver
     * cannot make its own disk fail, and this file may not name a driver to
     * reach for its mock. What it buys is the only failure mode that separates
     * "the driver refused the rows" from "the driver accepted them and the
     * store did not": every other case here fails INSIDE the driver, on a row
     * it could not clone, so the write never reached the backing store at all.
     * The bug this seam was added for lived entirely in that gap.
     */
    refuseWrites?: () => () => void
  }
  /**
   * Whether anything else can write this driver's store — `OpenInfo.crossTab`,
   * declared ahead of the run because the last case below branches on it and a
   * `describe` cannot await an `open()` to find out.
   *
   * `false` for `rn-driver`, and that is a fact about the platform rather than a
   * gap: there is no second instance of a phone app reading one AsyncStorage, so
   * its `onRemoteCommit` takes the listener and never calls it. Handing such a
   * driver a `remoteCommit` that does nothing and then asserting delivery would
   * fail it for being correct, and handing it one that fakes delivery would
   * assert the mock. It gets the OTHER half of the same contract instead — that
   * the unsubscribe is real and idempotent — which is the half `boot-live.ts`
   * depends on either way.
   */
  readonly crossTab: boolean
  /**
   * A SECOND driver over the same backing store, or absent for a driver with no
   * store to come back to.
   *
   * Declared on the subject rather than discovered, exactly like `crossTab`: the
   * case below is inside an `if` at describe time and a `describe` cannot await
   * a `make()` to find out. It hangs off `make()`'s RESULT because "the same
   * store" is a fact about one store rather than about the driver type — the
   * IndexedDB subject reopens the database its first driver created, the RN
   * subject reopens the AsyncStorage key its first driver wrote.
   *
   * Absent for `memory-driver`, and that is honest rather than a gap: its rows
   * are in RAM behind the closure, so there is no second connection to hand
   * back. Handing it one built from `readAll()` would assert the harness. A
   * driver that claims durability and does not supply this is not covered by the
   * one case in this file that can tell whether it writes anything at all.
   */
  readonly durable?: boolean
  /**
   * Whether this subject can make its backing store refuse a write.
   *
   * Declared ahead of the run like `crossTab` and `durable`, and for the same
   * reason: the case it selects sits inside an `if` at describe time. Absent for
   * `memory-driver`, honestly — a Map does not run out of room, and its `fault`
   * seam refuses BEFORE the store is touched, which is the case already covered
   * above rather than the one below.
   */
  readonly refusable?: boolean
}

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

/**
 * Run the whole contract over one driver.
 *
 * Call it at the top level of a `*.test.ts` that can build the subject. The
 * suite name carries the label, so three call sites in three packages produce
 * three distinguishable `Driver conformance: <label>` blocks.
 */
export function describeDriverConformance(subject: DriverSubject): void {

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
      const { driver } = subject.make()
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
      const { driver } = subject.make()
      await driver.open()

      const written = await driver.commit([put('first'), unstorable, put('third')])
      expect(written.ok).toBe(false)

      const rows = await driver.readAll()
      expect(rows.ok && idsOf(rows.value.nodes)).toEqual([])

      driver.close()
    })

    /**
     * A REFUSED WRITE CHANGES NOTHING — and this is the assertion the file was
     * missing, not the one above it.
     *
     * Every case before this one checked the SHAPE of what came back: a
     * `DriverResult` rather than a throw, `ok: false` rather than `ok: true`.
     * None of them asked what the store looked like afterwards, and "leaves
     * nothing behind when a batch fails part-way through" only asks it of an
     * EMPTY store, where "unchanged" and "empty" are the same array. Measured:
     * `rn-driver` reported `ok: false` from a failed `replace` and had already
     * swapped the whole store for the payload, and the entire contract passed.
     *
     * So this one starts from a store with rows in it and asserts the rows are
     * still there, by value, after all three write methods have been refused.
     * `replace` and `seedIfPristine` are the two that matter and neither had a
     * state assertion anywhere: they DISCARD what is there rather than adding to
     * it, so a driver that half-applies one destroys the store rather than
     * lagging behind it.
     */
    it('leaves the store exactly as it was when a write is refused', async () => {
      const { driver } = subject.make()
      await driver.open()

      await driver.commit([put('kept'), journal('entry')])
      const before = await driver.readAll()
      expect(before.ok).toBe(true)
      if (!before.ok) return

      expect((await driver.commit([put('added'), unstorable])).ok).toBe(false)
      expect((await driver.replace(rowsWith(node('imported'), unstorableRow))).ok).toBe(false)
      // The meta store is still empty, so this is not declined for being
      // already-seeded — it gets as far as the row it cannot store.
      expect((await driver.seedIfPristine(rowsWith(unstorableRow))).ok).toBe(false)

      const after = await driver.readAll()
      expect(after.ok && after.value).toEqual(before.value)

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
      const { driver } = subject.make()
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
      const { driver } = subject.make()
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
      const { driver } = subject.make()
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
    /**
     * A row goes in and comes back equal, by value — and an absent key stays
     * absent.
     *
     * Two invariants the layer above already reasons about out loud, neither of
     * which anything asserted.
     *
     * ABSENT IS NOT NULL. `repo/seed.ts` narrows `completedOn` instead of
     * spreading it, and shifts optional dates only where a string is already
     * there, each with a comment saying why: `'completedOn' in props` must
     * answer no for something nobody has completed, and `'firstReplyOn' in
     * props` must answer no for an application nobody has heard back from. Those
     * are claims about the DRIVER made two layers up, and they hold only for as
     * long as every driver keeps the distinction. The one most likely to lose it
     * is the one nobody has written yet — an AsyncStorage or SQLite driver
     * serialising with `JSON.stringify`, which is what the Expo app's driver
     * already is. JSON keeps `null` and keeps absent, so it passes this; a
     * driver that normalises either into the other inverts every `in` check in
     * the graph on the second launch, and the symptom is a reopened reminder
     * reading as completed rather than anything that looks like a storage bug.
     *
     * BY VALUE, NOT BY REFERENCE. `memory-driver` calls `structuredClone` on the
     * way in for exactly this: the caller keeps its object and the repository
     * patches props in place, so a store holding the same array would let a
     * later edit rewrite what is already committed. Free for anything that
     * serialises, easy to lose for anything that does not — which is why it
     * belongs in the contract rather than in the memory driver's own file.
     */
    it('stores a row by value, keeping an absent key absent and a null null', async () => {
      const { driver } = subject.make()
      await driver.open()

      const keywords = ['ml', 'systems']
      const row: StoredRow = {
        id: 'a',
        type: 'application',
        props: { org: 'Rice', completedOn: null, keywords },
      }
      await driver.commit([{ kind: 'put', store: 'nodes', key: 'a', value: row }])

      // After the commit, so a driver that kept the reference is caught.
      keywords.push('mutated')

      const rows = await driver.readAll()
      const props = (rows.ok ? (rows.value.nodes[0]?.['props'] ?? {}) : {}) as Record<
        string,
        unknown
      >

      expect(props).toEqual({ org: 'Rice', completedOn: null, keywords: ['ml', 'systems'] })
      expect('firstReplyOn' in props).toBe(false)

      driver.close()
    })

    it('reads each store back in ascending key order', async () => {
      const { driver } = subject.make()
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
      const { driver } = subject.make()
      await driver.open()

      await driver.commit([journal('j1'), journal('j2')])
      await driver.commit([journal('j3')])
      const rows = await driver.readAll()

      expect(rows.ok && idsOf(rows.value.ops)).toEqual(['j1', 'j2', 'j3'])

      driver.close()
    })

    /**
     * The unsubscribe actually unsubscribes.
     *
     * This case used to register both listeners, call both unsubscribes twice
     * and assert nothing at all — so `onRemoteCommit: () => () => {}` passed it,
     * and the leak it is named after was invisible. `repo/boot-live.ts`
     * resubscribes around a rehydrate; an unsubscribe that does not unsubscribe
     * leaves the old listener behind, so each remote commit costs another
     * flush-and-rehydrate — and each of those clears the undo stack.
     *
     * Called twice on purpose: `close()` runs the same teardown afterwards, so
     * an unsubscribe that only survives one call throws on the way out of a tab.
     */
    /**
     * A row written by one connection comes back to the next one.
     *
     * The hole this closes was structural: not one of the cases above reopens a
     * store, so a driver that accepted every write, answered every read out of
     * an in-memory mirror and never touched the disk passed the entire contract.
     * That is not hypothetical — it was measured on `rn-driver`, which delegates
     * its reads to the `MemoryDriver` it wraps: replacing `AsyncStorage.setItem`
     * with a no-op AND `getItem` with `null` left every test green, on the one
     * thing that file's own header says it owns.
     *
     * `close()` then `open()` on the SAME instance is not the same test and
     * cannot replace this one — a driver is allowed to refuse to reopen after
     * close, and the case above only asserts that it answers with a
     * `DriverResult`. What a durable driver owes is that the STORE outlives the
     * connection, which needs a second connection to ask.
     *
     * Both stores are checked, and `ops` deliberately: a journal row is written
     * with `key: null` and comes back through a generator, so a driver that
     * round-trips `nodes` by id and loses the audit log is a real shape.
     */
    if (subject.durable === true) {
      it('hands the rows back to a second connection to the same store', async () => {
        const made = subject.make()
        const reopen = made.reopen
        if (!reopen) {
          throw new Error(
            `${subject.label} declares durable: true and supplies no reopen(). ` +
              'The contract cannot tell whether it writes anything without one.',
          )
        }

        await made.driver.open()
        await made.driver.commit([put('kept'), journal('entry')])
        made.driver.close()

        const second = reopen()
        const opened = await second.open()
        expect(opened.ok).toBe(true)

        const rows = await second.readAll()
        expect(rows.ok && idsOf(rows.value.nodes)).toEqual(['kept'])
        expect(rows.ok && idsOf(rows.value.ops)).toEqual(['entry'])

        // And the second connection can still write, which a driver that
        // reopened read-only would fail here rather than on a user's phone.
        await second.commit([put('added')])
        const after = await second.readAll()
        expect(after.ok && idsOf(after.value.nodes)).toEqual(['added', 'kept'])

        second.close()
      })
    }

    /**
     * The same question again, asked of a store that refuses the write ITSELF.
     *
     * The case above cannot reach the defect it was written for, and that is
     * worth stating rather than discovering: every failure it provokes happens
     * inside the driver, on a row `structuredClone` refuses, so the driver
     * returns before the backing store is touched at all. A driver that applies
     * the rows first and persists second passes it every time.
     *
     * That ordering is exactly what broke. `rn-driver` answers every read out of
     * an in-RAM mirror and writes the whole mirror to disk afterwards, so a
     * refused disk write left RAM holding the transfer payload while the disk
     * still held the user's records — `replace` correctly reported failure, the
     * screen correctly still showed the old rows, and the next ordinary edit
     * serialised the mirror over the top of them. The refusal was true for one
     * keystroke.
     *
     * Hence the last two assertions, which are not decoration: the write AFTER
     * the disk comes back has to carry the store that survived, not the one that
     * was refused — and where a subject can reopen its store, the disk has to
     * agree, because a mirror that rolled back and a disk that did not is the
     * same bug one launch later.
     */
    if (subject.refusable === true) {
      it('leaves the store exactly as it was when the backing store refuses the write', async () => {
        const made = subject.make()
        const refuseWrites = made.refuseWrites
        if (!refuseWrites) {
          throw new Error(
            `${subject.label} declares refusable: true and supplies no refuseWrites(). ` +
              'The contract cannot tell an accepted write from a persisted one without it.',
          )
        }
        const { driver } = made

        await driver.open()
        await driver.commit([put('kept'), journal('entry')])
        const before = await driver.readAll()
        expect(before.ok).toBe(true)
        if (!before.ok) return

        const allowWrites = refuseWrites()

        expect((await driver.replace(rowsWith(node('imported')))).ok).toBe(false)
        const afterReplace = await driver.readAll()
        expect(afterReplace.ok && afterReplace.value).toEqual(before.value)

        // Reaches the write, because the meta store is still empty: this is a
        // seed that was allowed to proceed and then refused, not one declined.
        expect((await driver.seedIfPristine(rowsWith(node('seeded')))).ok).toBe(false)
        const afterSeed = await driver.readAll()
        expect(afterSeed.ok && afterSeed.value).toEqual(before.value)

        allowWrites()

        expect((await driver.commit([put('later')])).ok).toBe(true)
        const settled = await driver.readAll()
        expect(settled.ok && idsOf(settled.value.nodes)).toEqual(['kept', 'later'])

        driver.close()

        if (made.reopen) {
          const second = made.reopen()
          expect((await second.open()).ok).toBe(true)
          const onDisk = await second.readAll()
          expect(onDisk.ok && idsOf(onDisk.value.nodes)).toEqual(['kept', 'later'])
          second.close()
        }
      })
    }

    if (subject.crossTab) {
      it('stops delivering remote commits once its unsubscribe is called', async () => {
        const { driver, remoteCommit } = subject.make()
        await driver.open()

        const seen: string[] = []
        const off = driver.onRemoteCommit((event) => seen.push(event.entryId))

        remoteCommit({ kind: 'commit', at: '2026-10-12T00:00:00.000Z', entryId: 'before' })
        off()
        off()
        remoteCommit({ kind: 'commit', at: '2026-10-12T00:00:01.000Z', entryId: 'after' })

        expect(seen).toEqual(['before'])

        driver.close()
      })
    } else {
      /**
       * A driver with no second writer still owes the subscription contract.
       *
       * `boot-live.ts` subscribes unconditionally and unsubscribes around a
       * rehydrate, so the two things it needs from a single-instance driver are
       * that `onRemoteCommit` hands back a function and that calling it twice —
       * once by the resubscribe, once by `close()` — does not throw on the way
       * out. Neither is free: the shape it returns is a literal in the driver
       * body and nothing else in the suite calls it.
       */
      it('returns a real, idempotent unsubscribe despite having nothing to deliver', async () => {
        const { driver } = subject.make()
        await driver.open()

        const seen: string[] = []
        const off = driver.onRemoteCommit((event) => seen.push(event.entryId))

        expect(typeof off).toBe('function')
        off()
        off()
        expect(seen).toEqual([])

        driver.close()
      })
    }
  })
}
