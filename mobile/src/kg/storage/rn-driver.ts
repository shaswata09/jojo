import AsyncStorage from '@react-native-async-storage/async-storage'
import { driverFail, emptyRows } from '@jojo/service/storage/driver'
import type { Driver, DriverResult, DurableOp, OpenInfo, Rows, StoreEvent } from '@jojo/service/storage/driver'
import { classify } from '@jojo/service/storage/idb-errors'
import { createMemoryDriver } from '@jojo/service/storage/memory-driver'
import type { MemoryDriver } from '@jojo/service/storage/memory-driver'
import { kgWarn } from '@jojo/service/log'

/**
 * The React Native driver: the memory store, mirrored to AsyncStorage.
 *
 * WHY IT WRAPS `createMemoryDriver` RATHER THAN REIMPLEMENTING IT.
 *
 * Everything hard about a driver is the key ordering, the `ops` generator that
 * must not go backwards across a `clear`, and the exact `DriverResult` shape the
 * write queue's retry logic reads. All three are already correct in the memory
 * driver, all three are covered by `driver-conformance.test.ts`, and a second
 * hand-written copy of them is a second place for the audit log to come back in
 * the wrong order. So this owns one thing only — getting the rows onto the disk
 * and back — and delegates the rest.
 *
 * WHY A WHOLE-STORE JSON BLOB RATHER THAN A ROW PER KEY.
 *
 * AsyncStorage is a key/value store with no transaction across keys. A commit
 * here touches three of the four stores at once (a node, its edges, a journal
 * entry) and the invariant that matters is that they land together or not at
 * all — a graph holding an edge whose node never arrived fails
 * `checkInvariants` on the next boot and drops the reader into recovery. One key
 * holding one JSON document is atomic by construction, which buys that
 * invariant for free at the cost of rewriting rows that did not change.
 *
 * That cost is real and bounded: the seed is ~90 nodes and ~120 edges, and the
 * journal is capped at 200 entries and pruned on open. Serialising all of it is
 * well under a frame, and it happens off the interaction path anyway — the
 * queue is write-behind, so the UI has already moved on. If this ever holds
 * enough records for that to stop being true, the answer is `expo-sqlite` and a
 * row per key, not a cleverer blob.
 *
 * WHAT IT DOES NOT DO.
 *
 * `crossTab: false`, always. There is no second instance of a phone app reading
 * the same store, so there is nothing to hear from — and `repo/boot.ts` reads
 * that flag to decide whether to subscribe to the host's `onResume` instead,
 * which is exactly the compensation this platform wants.
 */

/** One key, one document. Namespaced so it cannot collide with anything else. */
const KEY = 'jojo/kg/rows/v1'

/** Matches the IndexedDB driver's, so a migration lands on the same number. */
const VERSION = 1

type Persisted = { version: number; rows: Rows }

/**
 * Reads what is on disk, and treats anything unreadable as "nothing yet".
 *
 * A parse failure here is indistinguishable from a first run *to this
 * function*, and it deliberately stays that way: `boot` runs `validateRows` and
 * `checkInvariants` over whatever comes back and owns the decision about
 * corrupt data. A driver that tried to be clever about it would be making that
 * call twice, in two places, with less information.
 */
async function load(): Promise<Rows | null> {
  const raw = await AsyncStorage.getItem(KEY)
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as Persisted
    if (!parsed || typeof parsed !== 'object' || !parsed.rows) return null
    return { ...emptyRows(), ...parsed.rows }
  } catch (e) {
    kgWarn('rn-driver: stored rows could not be parsed, starting empty', {
      error: String(e),
    })
    return null
  }
}

export function createRnDriver(): Driver {
  let memory: MemoryDriver | null = null
  let closed = false

  /**
   * The memory driver, or the reason there isn't one.
   *
   * This threw at first, and the conformance suite caught it on the first run:
   * `close()` is not a courtesy call — the blocking handler fires it while the
   * app is still going, so whatever was already in flight arrives at a driver
   * with no store behind it. The caller is the write queue, which has no
   * `catch`, so a throw here does not degrade the write, it wedges the queue.
   * `driver.ts` opens with "Never throws. Every method returns a Result", and
   * this is what that costs to honour.
   */
  const store = (): MemoryDriver | DriverResult<never> =>
    memory ?? driverFail<never>('storage/unavailable', 'Store is not open')

  const isFailure = (v: MemoryDriver | DriverResult<never>): v is DriverResult<never> => 'ok' in v

  /**
   * Writes the current rows back.
   *
   * Read-then-write rather than tracking a dirty set: `readAll` is a clone of
   * four Maps, the queue has already batched whatever burst produced this, and
   * a dirty set that got the bookkeeping wrong would drop a write silently
   * rather than loudly.
   */
  const persist = async (): Promise<DriverResult<void>> => {
    const s = store()
    if (isFailure(s)) return s
    const rows = await s.readAll()
    if (!rows.ok) return rows
    try {
      const payload: Persisted = { version: VERSION, rows: rows.value }
      await AsyncStorage.setItem(KEY, JSON.stringify(payload))
      return { ok: true, value: undefined }
    } catch (e) {
      // Everything the queue knows how to do about a failed write — retry,
      // back off, raise the banner — keys off this classification.
      return classify<void>(e, 'persist')
    }
  }

  return {
    async open(): Promise<DriverResult<OpenInfo>> {
      if (closed) return driverFail<OpenInfo>('storage/unavailable', 'Store is closed')
      try {
        const rows = await load()
        memory = createMemoryDriver(rows ? { rows } : {})
        const opened = await memory.open()
        if (!opened.ok) return opened
        return {
          ok: true,
          value: {
            version: VERSION,
            from: rows ? VERSION : 0,
            migrated: [],
            // One process, one store. See the note above.
            crossTab: false,
          },
        }
      } catch (e) {
        return classify<OpenInfo>(e, 'open')
      }
    },

    async readAll() {
      const s = store()
      return isFailure(s) ? s : s.readAll()
    },

    async commit(ops: readonly DurableOp[]) {
      const s = store()
      if (isFailure(s)) return s
      const applied = await s.commit(ops)
      if (!applied.ok) return applied
      return persist()
    },

    async replace(rows: Rows) {
      const s = store()
      if (isFailure(s)) return s
      const replaced = await s.replace(rows)
      if (!replaced.ok) return replaced
      return persist()
    },

    async seedIfPristine(rows: Rows) {
      const s = store()
      if (isFailure(s)) return s
      const seeded = await s.seedIfPristine(rows)
      // Only write when the seed actually went in. A `false` here means the
      // store already had records, and rewriting the file for a no-op is how a
      // launch that changed nothing still burns a disk write.
      if (!seeded.ok || !seeded.value) return seeded
      const written = await persist()
      return written.ok ? seeded : written
    },

    async destroy() {
      const s = store()
      // A store nobody is holding open can still be deleted, and that is the
      // reading the contract explicitly allows.
      if (isFailure(s)) {
        try {
          await AsyncStorage.removeItem(KEY)
          return { ok: true as const, value: undefined }
        } catch (e) {
          return classify<void>(e, 'destroy')
        }
      }
      const destroyed = await s.destroy()
      if (!destroyed.ok) return destroyed
      try {
        await AsyncStorage.removeItem(KEY)
        return { ok: true, value: undefined }
      } catch (e) {
        return classify<void>(e, 'destroy')
      }
    },

    // Nothing else is writing this store, so neither of these can ever fire.
    // They return the same unsubscribe shape rather than throwing, because the
    // layer above subscribes unconditionally and a platform with nothing to say
    // should be quiet, not broken.
    onRemoteCommit(_fn: (e: StoreEvent) => void) {
      return () => {}
    },
    onBlocking(_fn: () => void) {
      return () => {}
    },

    close() {
      closed = true
      memory?.close()
      memory = null
    },
  }
}
