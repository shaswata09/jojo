/**
 * Export, and the size the clipboard will not tell you it refused.
 *
 * `Clipboard.setString` hands the text to Android's clipboard service over a
 * Binder transaction, and that buffer is a fixed 1 MB shared by every
 * transaction in flight for the process. Past it `setPrimaryClip` throws
 * `TransactionTooLargeException` — and the native module eats it:
 *
 *     public void setString(String text) {
 *       try { ... clipboard.setPrimaryClip(clipdata); }
 *       catch (Exception e) { e.printStackTrace(); }
 *     }
 *
 * (`@react-native-clipboard/clipboard`, `ClipboardModule.java`.) Nothing crosses
 * back to JS. The call returns normally, the clipboard still holds whatever it
 * held before, and the only trace is a stack trace in logcat nobody is reading.
 *
 * That made Settings' Export a lie in the one case where it mattered. It is the
 * only way a backup leaves this phone short of a transfer, the store is
 * provisioned to 50 MB (`android/gradle.properties`), and the confirmation on
 * "Clear every record" tells the person to export first — so a large store gave
 * a green "Copied to the clipboard", an unchanged clipboard, and then an empty
 * app. A crash would have been kinder.
 *
 * ## Why half the buffer, counted in UTF-16
 *
 * The 1 MB is shared, so a transaction sized to fill it alone fails the moment
 * anything else in the process is talking to a system service. And the parcel
 * carries a Java string as UTF-16 — two bytes per code unit, which is exactly
 * what `String.length` counts in JS, ASCII JSON included — so the measure costs
 * nothing and does not have to walk a multi-megabyte string.
 *
 * Deliberately conservative in that direction: refusing an export that would
 * have fitted costs a sentence pointing at Transfer, which moves the same store
 * over the network and has no such limit. Accepting one that does not fit costs
 * the backup, silently, at the moment it is needed.
 */

import { sizeLabel } from '@jojo/service/core/files'
import { byteLengthOf } from '@/lib/text'
import type { ToastOptions } from '@/lib/toast-context'

/** Half of Android's 1 MB Binder buffer, which every transaction shares. */
export const CLIPBOARD_MAX_BYTES = 512 * 1024

/**
 * What the Android clipboard PARCEL weighs, which is not what the export weighs.
 *
 * A Java string is UTF-16, two bytes a unit, and the Binder limit applies to the
 * parcel — so this is the right number to compare against
 * `CLIPBOARD_MAX_BYTES`. It is the WRONG number to show a person: a 1 MB ASCII
 * export reads as "2.0 MB" to anyone who has ever looked at the file. The
 * message below quotes `byteLengthOf` instead, which is the UTF-8 size the rest
 * of the app means by "how big is my store".
 */
export function clipboardBytes(text: string): number {
  return text.length * 2
}

/**
 * Copies the export, or says why it did not — never both, and never neither.
 *
 * The copy function is passed in rather than imported so this can be tested at
 * all: the assertion that matters is that `setString` is NOT reached with a
 * payload the clipboard would drop, and that is only observable from outside.
 */
export function copyExport(
  json: string,
  copy: (text: string) => void,
  /*
   * ANDROID ONLY, and passed in rather than read from `Platform` so this stays
   * testable on both branches.
   *
   * The limit is Binder's, and Binder is Android's. `RNCClipboard.mm` assigns
   * straight to `UIPasteboard.string` with no transaction and no cap, so a
   * blanket guard refused an iPhone a backup it would have taken — and
   * explained why in Android's words. The only route out of this app is not a
   * place to be approximately right.
   */
  capped = true,
): ToastOptions {
  const bytes = clipboardBytes(json)
  if (capped && bytes > CLIPBOARD_MAX_BYTES) {
    // The number is the point. "Too big" leaves somebody pressing the same
    // button again; the size is what tells them this route is closed for their
    // store and the other one is not.
    return {
      title: 'Too big for the clipboard',
      description: `Your records come to ${sizeLabel(byteLengthOf(json))} and Android's clipboard takes about ${sizeLabel(
        CLIPBOARD_MAX_BYTES / 2,
      )} of text. Nothing was copied. Use Transfer instead — it hands the whole store to another device over your own network.`,
      tone: 'danger',
    }
  }

  copy(json)
  return {
    title: 'Copied to the clipboard',
    description: 'The whole store as JSON — paste it into a note or a file to keep it.',
  }
}
