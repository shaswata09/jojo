/**
 * L2 — StoreMeta, first-run detection, schemaVersion.
 *
 * First run is "the meta row is absent", not "the node store is empty". The
 * difference is load-bearing: a user who deliberately emptied their records would
 * otherwise be reseeded with demo data on every reload, which makes Settings'
 * Empty button impossible to actually use.
 *
 * `dataSet` is what carries that intent across the reload. 'empty' with
 * `seededAt: null` is a decision the user made and the boot path must respect;
 * 'demo' is data the app supplied and may replace; 'user' is the moment neither
 * of those is true any more and reseeding stops being on the table at all.
 */

import { SCHEMA_VERSION } from '../storage/migrations'
import type { Instant, MetaRow } from '../storage/schema'

/**
 * Re-exported from the migration list, which is now where it is derived.
 *
 * It used to be written down here, because Wave 1 had no migrations and a
 * constant with no steps behind it would have read as a promise the storage
 * layer had not made. Now the steps exist, and the version is `max(step.version)`
 * rather than a number anyone maintains — a constant one behind the list is a
 * migration that never runs, on every machine that was already open, silently.
 */
export { SCHEMA_VERSION }

/** The single meta row's primary key. There is exactly one. */
export const META_KEY = 'store'

export type DataSet = 'demo' | 'empty' | 'user'

export type StoreMeta = {
  schemaVersion: number
  createdAt: Instant
  lastOpenedAt: Instant
  /** 'demo' as shipped, 'empty' if the user cleared, 'user' once they write. */
  dataSet: DataSet
  /** null when the user explicitly chose an empty store. */
  seededAt: Instant | null
  /**
   * When this store last took part in a Transfer — sent or received.
   *
   * `null` on a store that has never been in one, which is most of them. It
   * exists so the app can say how far the OTHER device has drifted: Transfer is
   * one-directional and manual, so two devices start disagreeing the moment
   * either is used after a handover, and nothing said so. Divergence you can see
   * is a different thing from divergence you discover.
   *
   * Optional in the reader below rather than required, because every store
   * written before this field existed has no value for it and a boot that
   * called those corrupt would lose people their records over a status line.
   */
  handoverAt: Instant | null
}

const DATA_SETS: readonly DataSet[] = ['demo', 'empty', 'user']

const isDataSet = (v: unknown): v is DataSet =>
  typeof v === 'string' && DATA_SETS.includes(v as DataSet)

export function freshMeta(now: Instant, dataSet: DataSet): StoreMeta {
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    lastOpenedAt: now,
    dataSet,
    // A store the user asked to be empty was never seeded, and saying otherwise
    // would be the one field that could talk boot into replacing their choice.
    seededAt: dataSet === 'demo' ? now : null,
    handoverAt: null,
  }
}

export const metaRow = (meta: StoreMeta): MetaRow => ({ key: META_KEY, value: { ...meta } })

/**
 * The meta row as read off disk, or null.
 *
 * Null means first run and nothing else. A row that is present but unreadable is
 * NOT first run — that is corruption, and answering "first run" to it would
 * reseed demo data over records that are probably still recoverable. It comes
 * back as a failure so the caller reaches the corrupt path instead.
 */
export function readMeta(rows: readonly MetaRow[]): StoreMeta | null | 'corrupt' {
  const row = rows.find((r) => r.key === META_KEY)
  if (!row) return null

  const value: unknown = row.value
  if (typeof value !== 'object' || value === null) return 'corrupt'

  const m = value as Record<string, unknown>
  if (typeof m['schemaVersion'] !== 'number') return 'corrupt'
  if (typeof m['createdAt'] !== 'string') return 'corrupt'
  if (typeof m['lastOpenedAt'] !== 'string') return 'corrupt'
  if (!isDataSet(m['dataSet'])) return 'corrupt'
  if (m['seededAt'] !== null && typeof m['seededAt'] !== 'string') return 'corrupt'

  return {
    schemaVersion: m['schemaVersion'],
    createdAt: m['createdAt'],
    lastOpenedAt: m['lastOpenedAt'],
    dataSet: m['dataSet'],
    seededAt: m['seededAt'] as Instant | null,
    // Absent on every store written before the field existed. Read as "never
    // handed over", which is true of them, rather than as damage.
    handoverAt: typeof m['handoverAt'] === 'string' ? (m['handoverAt'] as Instant) : null,
  }
}

export const isFirstRun = (rows: readonly MetaRow[]): boolean => readMeta(rows) === null

/** Stamped on every open, so Diagnostics can say when the store was last used. */
export const opened = (meta: StoreMeta, now: Instant): StoreMeta => ({
  ...meta,
  lastOpenedAt: now,
})

/**
 * The first write the user makes themselves.
 *
 * Demo data stops being demo data the moment it is edited, and a store still
 * labelled 'demo' is a store Settings would offer to replace without warning.
 * Idempotent, because it is called on every commit.
 */
export const touched = (meta: StoreMeta): StoreMeta =>
  meta.dataSet === 'user' ? meta : { ...meta, dataSet: 'user' }

/**
 * Stamped when a Transfer completes, at either end.
 *
 * Both ends, and that is the point: the sender needs it to know how much it has
 * changed since the copy it handed over, and the receiver needs it to know how
 * old the copy it is holding is. One field, two readings, and `handoverStatus`
 * in `core/handover.ts` turns either into a sentence.
 */
export const handedOver = (meta: StoreMeta, now: Instant): StoreMeta => ({
  ...meta,
  handoverAt: now,
})
