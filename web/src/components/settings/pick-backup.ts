/**
 * A file the user chose, as either a plan or a sentence.
 *
 * Extracted from `DataPanel` for the reason `restore-report.ts` was: what can go
 * wrong on this path is a missing `catch` and a sentence, and neither is
 * reachable from a test while it lives inside a click handler — D20 rules out
 * mounting the panel.
 *
 * ## The missing catch
 *
 * `onPickBackup` read the chosen file with a bare `await file.text()`. That
 * promise REJECTS in the field: a `File` from an `<input>` is a snapshot
 * reference to bytes on disk, and reading it after those bytes have moved — the
 * file renamed or deleted between the picker and the read, a network share
 * unmounted, a stick pulled out — fails with `NotReadableError`. The handler is
 * invoked as `void onPickBackup(...)`, so the rejection went past the panel
 * entirely and landed on `main.tsx`'s `unhandledrejection` listener, which
 * writes to the console and to the local crash log.
 *
 * On screen NOTHING happened. No confirmation dialog, no toast, no error — the
 * user pressed Restore, chose their only backup, and jojo did nothing at all,
 * with no way to tell a broken button from a file it had refused. That is the
 * exact silence `useBackup.download` was fixed for on the export half of this
 * same panel, and this half had kept it.
 */

import { readBackup } from '@jojo/service/core/backup'
import type { RestorePlan } from '@jojo/service/core/backup'

export type PickedBackup =
  /** The picker was cancelled. There is nothing to say about it. */
  | { kind: 'none' }
  /** A whole backup, ready to be staged behind the confirmation. */
  | { kind: 'plan'; plan: RestorePlan }
  /** Read, and refused by the validator. The reason is `readBackup`'s own. */
  | { kind: 'refused'; title: string; description: string }
  /**
   * The bytes never arrived. `thrown` is carried out for `reportError`: this is
   * a browser or filesystem failure rather than a bad file, so it is the only
   * one of the three worth a line in the crash log.
   */
  | { kind: 'unreadable'; title: string; description: string; thrown: unknown }

/**
 * Never rejects, whatever the file does. That is the whole point of it.
 *
 * The two failures say different things because they need opposite actions from
 * the reader: a refused file is one to replace, and an unreadable one is very
 * likely the right file still sitting where it always was. They end the same
 * way — nothing has been changed — because the one thing a person needs to know
 * when a restore does not happen is that the records they still have are intact.
 * Nothing on this path writes; `restoreBackup` is only reached past the dialog.
 */
export async function readPickedBackup(list: FileList | null): Promise<PickedBackup> {
  const file = list?.[0]
  if (!file) return { kind: 'none' }

  let text: string
  try {
    text = await file.text()
  } catch (thrown) {
    return {
      kind: 'unreadable',
      title: 'That file could not be read',
      description:
        'Your browser could not read that file — it may have been moved, renamed or disconnected since you chose it. Nothing has been changed; choose it again once it is back.',
      thrown,
    }
  }

  const read = readBackup(text)
  if (!read.ok) {
    return {
      kind: 'refused',
      title: 'That file cannot be restored',
      description: `${read.error.message}. Nothing has been changed.`,
    }
  }
  return { kind: 'plan', plan: read.value }
}
