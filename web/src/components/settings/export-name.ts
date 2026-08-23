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
 * The UTC day, which is what this has always written and is carried over
 * unchanged. It is not obviously the right day — the name is read next to the
 * other files in a downloads folder, so an export taken at 9pm on the 20th in
 * UTC+13 calls itself the 21st — but that is a separate decision from the one
 * this file was extracted to fix, and changing it here would have moved a
 * filename while the point was to stop the label from lying about it. Left as
 * an open question rather than settled in passing; `at` is a parameter so the
 * answer is testable when somebody makes it.
 */
export function exportFilename(at: Date): string {
  return `${EXPORT_PREFIX}-${at.toISOString().slice(0, 10)}.json`
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
