import AsyncStorage from '@react-native-async-storage/async-storage'
import { driverFail, emptyRows } from '@jojo/service/storage/driver'
import type {
  Driver,
  DriverFailure,
  DriverResult,
  DurableOp,
  OpenInfo,
  Rows,
  StoreEvent,
} from '@jojo/service/storage/driver'
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
 * THAT COST IS REAL, AND THE NUMBER THAT USED TO BE HERE HAS EXPIRED. It said
 * serialising the whole document is "well under a frame" — true of the ~90-node
 * seed it was written against, and false by about a thousand records. Measured
 * by booting this driver on the real seed and replicating the resulting rows,
 * with AsyncStorage stubbed to a Map so the figures are JS time only, per
 * single-node commit, median of nine:
 *
 *     87 nodes (the seed)      56 KB written    0.6 ms
 *     957 nodes               626 KB written    4.9 ms
 *     9,483 nodes           6,235 KB written   54.3 ms
 *
 * — before the bridge and before the native write. The half that stays true is
 * the second half: it is off the interaction path, because the queue is
 * write-behind and the UI has already moved on. What is no longer true is that
 * the size does not matter. `readAll` clones every row in all four stores, and
 * a commit costs the whole store however small the edit — which is also why
 * coalescing helps here far more than it does on IndexedDB: a batch of sixty
 * costs what a batch of two does.
 *
 * There is a hard edge as well as a slope, and it is Android-only. AsyncStorage
 * there is capped at 6 MB by the library's own default, which the table above
 * crosses at roughly 9,300 records. `android/gradle.properties` raises the cap
 * and carries the rest of that measurement; iOS has no equivalent ceiling.
 *
 * The escape hatch is unchanged and is now dated by numbers rather than by a
 * guess: if this holds enough records for the slope to matter, the answer is
 * SQLite and a row per key, not a cleverer blob — through whichever binding this
 * app takes then. This line named `expo-sqlite` until the ejection, which is a
 * package the app can no longer install.
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
 * What was on disk: nothing, rows, or a document that would not read.
 *
 * THE THIRD ARM IS THE POINT, and it used to be folded into the first.
 *
 * `load` returned `Rows | null` and answered `null` for both "the key is
 * absent" and "the key holds bytes that are not a store". Measured end to end
 * on the real `boot`: write a store through this driver, truncate the document
 * on disk the way a killed write does, boot again — `open()` reported
 * `from: 0`, `readMeta` saw no meta row, `firstRun` ran, and `seedIfPristine`
 * found a memory store that was empty because the parse had failed rather than
 * because the phone was new. The demo fixtures went over the top: 92 nodes
 * written where the user's records had been, and the truncated document — which
 * still held most of their rows as text and could have been rescued by hand —
 * gone with it. There is no server; that was the only copy.
 *
 * So the two cases are told apart HERE, because this is the only place that can
 * tell them apart: by the time `boot` is looking at rows, an unparseable
 * document and a fresh install are both an empty array. `open` turns this arm
 * into `storage/corrupt`, which `boot` already routes to the recovery outcome
 * whose whole rule is "do not touch what is there" — that path existed and this
 * driver was the one caller that could never reach it.
 */
type Loaded =
  | { kind: 'absent' }
  | { kind: 'rows'; rows: Rows }
  | { kind: 'unreadable'; detail: string }

async function load(): Promise<Loaded> {
  const raw = await AsyncStorage.getItem(KEY)
  if (raw === null) return { kind: 'absent' }
  try {
    const parsed = JSON.parse(raw) as Persisted
    if (!parsed || typeof parsed !== 'object' || !parsed.rows) {
      // Parsed, but it is not a store document. A build that changed the
      // envelope, or a key some other code wrote over. Still "present and
      // unreadable" rather than "absent": overwriting it loses whatever it is.
      return { kind: 'unreadable', detail: 'the stored document has no rows' }
    }
    // The spread makes the declared `Rows` true at runtime, and does nothing
    // else — measured, because an audit read it as a guard and went looking for
    // the case it protects. There is none reachable from here: `parsed` is a
    // cast over whatever was on disk, so a document from a build with three
    // stores would type-check as `Rows` and be one array short without it — but
    // the only consumer is `createMemoryDriver`, which takes `Partial<Rows>`,
    // skips the store it was not given, and answers `readAll` from all four
    // maps regardless. Deleting the spread changes no observable behaviour, so
    // it cannot be pinned by a test, and it is kept because the alternative is a
    // function whose return type is a lie.
    return { kind: 'rows', rows: { ...emptyRows(), ...parsed.rows } }
  } catch (e) {
    kgWarn('rn-driver: the stored document could not be parsed', { error: String(e) })
    return { kind: 'unreadable', detail: String(e) }
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
   * Read-then-write rather than tracking a dirty set: reading the four Maps is
   * cheap, the queue has already batched whatever burst produced this, and a
   * dirty set that got the bookkeeping wrong would drop a write silently rather
   * than loudly.
   *
   * `readAllUncloned` and not `readAll`, which is the whole reason that method
   * exists. The rows are handed straight to `JSON.stringify` and dropped —
   * nothing here keeps a reference and nothing here mutates — so the deep clone
   * `readAll` makes was work thrown away one line after it was done. On a
   * 3,000-application store it was 24.6 ms of a 31.8 ms commit. Anything added
   * to this function that RETAINS a row has to go back to `readAll`.
   */
  const persist = async (): Promise<DriverResult<void>> => {
    const s = store()
    if (isFailure(s)) return s
    try {
      const payload: Persisted = { version: VERSION, rows: s.readAllUncloned() }
      await AsyncStorage.setItem(KEY, JSON.stringify(payload))
      return { ok: true, value: undefined }
    } catch (e) {
      // Everything the queue knows how to do about a failed write — retry,
      // back off, raise the banner — keys off this classification.
      return classify<void>(e, 'persist')
    }
  }

  /**
   * Puts the wrapped store back to `before` after the disk refused the write.
   *
   * WHY THIS EXISTS, AND WHY ONLY ON THE TWO WHOLESALE METHODS.
   *
   * The memory driver is not a cache of the disk here, it is what every read is
   * answered from — `readAll` delegates to it and nothing re-reads AsyncStorage
   * after `open`. So the order `apply, then persist` publishes the new state to
   * every reader BEFORE the disk has agreed to it, and there was no undo.
   *
   * For `commit` that divergence is the design and stays: the queue is
   * write-behind, the UI moved on turns ago, and a retried commit re-serialises
   * the whole store, so the op that failed lands on the retry. A `commit` only
   * ever ADDS to what is already there, so the worst a stale disk costs is the
   * last few edits.
   *
   * `replace` and `seedIfPristine` are the opposite shape: they DISCARD the
   * store and put a different one in its place. Measured on the real
   * restoreBackup path with the disk refusing the write — the transfer payload
   * was live in RAM, the user's records were still the only thing on disk,
   * `restoreBackup` correctly reported "Nothing has been changed", `repo.health`
   * stayed `idle` and the screen still showed the old records. Then the next
   * ordinary edit called `persist()`, which serialises whatever the memory store
   * holds, and wrote the transfer payload over the user's records. The refusal
   * message was true for about one keystroke.
   *
   * The snapshot costs one `readAll` clone per call, which is why it is not on
   * `commit`: these two run on restore, import, wipe and first-run — user-driven,
   * off the interaction path, and each already about to serialise the whole
   * document anyway. A pristine store is nearly empty by definition, so the
   * `seedIfPristine` copy is of almost nothing.
   */
  const rollBack = async (
    s: MemoryDriver,
    before: Rows,
    failure: DriverFailure,
    call: string,
  ): Promise<DriverResult<never>> => {
    const restored = await s.replace(before)
    if (!restored.ok) {
      // `before` came out of `readAll`, so it has already survived one
      // structured clone and cannot be refused for its contents. Reaching here
      // means the store went away underneath us, and the honest report is that
      // RAM and disk now disagree — not the original disk error.
      kgWarn('rn-driver: could not roll the store back after a refused write', {
        call,
        error: restored.error.message,
      })
      return driverFail<never>(
        'storage/corrupt',
        `${call} was refused by the disk and the in-memory store could not be put back`,
      )
    }
    return { ok: false, error: failure }
  }

  return {
    async open(): Promise<DriverResult<OpenInfo>> {
      if (closed) return driverFail<OpenInfo>('storage/unavailable', 'Store is closed')
      try {
        const loaded = await load()
        if (loaded.kind === 'unreadable') {
          // No memory driver is built, deliberately. `boot` closes a driver
          // whose `open` failed, but nothing stops a caller trying a write
          // anyway — and a driver holding an empty store over an unreadable
          // document is one `persist()` away from writing that emptiness onto
          // the only copy. With `memory` still null every method answers
          // `storage/unavailable` and the bytes stay where they are.
          return driverFail<OpenInfo>(
            'storage/corrupt',
            `the stored document could not be read: ${loaded.detail}`,
          )
        }
        const rows = loaded.kind === 'rows' ? loaded.rows : null
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
      const before = await s.readAll()
      if (!before.ok) return before
      const replaced = await s.replace(rows)
      if (!replaced.ok) return replaced
      const written = await persist()
      if (!written.ok) return rollBack(s, before.value, written.error, 'replace')
      return written
    },

    async seedIfPristine(rows: Rows) {
      const s = store()
      if (isFailure(s)) return s
      const before = await s.readAll()
      if (!before.ok) return before
      const seeded = await s.seedIfPristine(rows)
      // Only write when the seed actually went in. A `false` here means the
      // store already had records, and rewriting the file for a no-op is how a
      // launch that changed nothing still burns a disk write.
      if (!seeded.ok || !seeded.value) return seeded
      const written = await persist()
      if (!written.ok) return rollBack(s, before.value, written.error, 'seedIfPristine')
      return seeded
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
