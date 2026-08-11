import type { VaultFile } from '@/data/vault'
import { slugify } from '@/lib/ids'

/**
 * Directories, which arrive looking exactly like files and are not.
 *
 * A dropped folder produces a `File` whose `type` is empty and whose `size`
 * is the directory's own inode size, so it filed cleanly as a 192-byte
 * "doc" named after the folder and reported itself added like anything
 * else. Nothing downstream could tell; the row simply described something
 * that is not a document.
 *
 * There is no `isDirectory` on `File`, and the only reliable test — reading
 * a byte, which rejects for a directory — is asynchronous, which this whole
 * path (mint ids, toast, offer Undo) is deliberately not. The synchronous
 * approximation is "no MIME type AND no extension", which is what a dropped
 * folder always looks like and what a document essentially never does.
 *
 * It will also reject an extension-less file someone genuinely meant to add
 * — a `Makefile`, a `LICENSE`. That is the right way round to be wrong: the
 * toast says exactly what happened and they can rename it, whereas a junk
 * row that presents as a 192-byte document is indistinguishable from a real
 * record until someone tries to open it.
 */
const isProbablyDirectory = (file: File) => file.type === '' && !file.name.includes('.')

/**
 * Splits a drop into what can be filed, what was a folder, and what is already
 * here — before a single record is minted.
 *
 * `total` is what arrived, so an empty gesture can be told apart from one that
 * was entirely folders.
 */
export function sortDrop(list: FileList | null, existing: readonly VaultFile[]) {
  const all = Array.from(list ?? [])

  const picked = all.filter((file) => !isProbablyDirectory(file))
  const folders = all.length - picked.length

  /**
   * `addFile` mints the id from the name and reads the store as of the last
   * render, so two files landing in one gesture cannot see each other: both
   * would take the same id, and from then on they are one row with one
   * keyword set that one delete takes out together. Deduped on the id the
   * name would produce rather than on the name itself, because that is the
   * thing that has to be unique — 'CV 2026.pdf' and 'CV-2026.pdf' slugify to
   * the same key.
   */
  const seen = new Set(existing.map((f) => slugify(f.name)))
  const fresh = picked.filter((file) => {
    const key = slugify(file.name)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return {
    total: all.length,
    picked,
    fresh,
    folders,
    skipped: picked.length - fresh.length,
  }
}
