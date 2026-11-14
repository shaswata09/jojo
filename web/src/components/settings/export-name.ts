/**
 * What the exported backup is called, in one place a test can reach.
 *
 * The name and the label that promised it had drifted apart: the button read
 * "Export jojo-data.json" while `onExport` wrote `jojo-backup-2026-08-20.json`,
 * so the one sentence in Settings that tells a user which file to look for
 * named a file that has never been written. The guide said the same thing twice
 * more, and nothing could catch any of it — D20 rules out mounting the panel,
 * and a filename built inline in a click handler is a rule nothing checks.
 *
 * `jojo-data.json` used to be a second real name in this app — the file a
 * localhost bridge would have mirrored to — and the collision between the two
 * names is exactly how the label came to be wrong. That bridge was designed,
 * built and deleted (`docs/NO-SERVER.md`), so the collision is gone with it and
 * this module is now the only place any backup filename is minted.
 */

/** The stem. Dated at the moment of export, so no button can print the whole name. */
export const EXPORT_PREFIX = 'jojo-backup'

/** What the guide publishes, so the prose and the writer cannot drift apart. */
export const EXPORT_NAME_SHAPE = `${EXPORT_PREFIX}-YYYY-MM-DD.json`

/**
 * Dated because this is a backup rather than a debugging dump: a second export
 * used to overwrite the first in the downloads folder, or land as
 * "jojo-data (1).json", which is not a name anyone can choose between six
 * months later.
 *
 * The person's own day, read through a local `Date` — the same rule `dayOf` in
 * `core/project.ts` states for every other date in the app. This used to slice
 * `toISOString()`, which is the UTC day: a backup taken at 22:19 on Friday the
 * 13th in California was saved as the 14th while the dashboard beside it said
 * Friday 13 November, and two backups either side of 16:00 on one day got
 * different names. A file in a downloads folder is read against the calendar
 * of the person who downloaded it, not Greenwich's.
 */
export function exportFilename(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const day = `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
  return `${EXPORT_PREFIX}-${day}.json`
}

/**
 * What the restore picker will accept, in the module that owns the extension.
 *
 * Here rather than inline on the input for the same reason the filename is: this
 * file is the one place that knows what a jojo backup is called, and a literal
 * beside the control is how the writer and the reader came apart the first time.
 * `export-name.test.ts` enforces that by refusing any `.json` in the panel, and
 * an `accept` string is exactly the kind of near-miss that guard is for.
 */
export const BACKUP_ACCEPT = 'application/json,.json'
