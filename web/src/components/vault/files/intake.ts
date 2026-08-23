import type { VaultFile } from '@/data/vault'

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
export function sortDrop(
  list: FileList | null,
  existing: readonly VaultFile[],
  /**
   * Whether a record already holds bytes. Absent means "assume they all do",
   * which is how this behaved before documents were stored at all.
   *
   * It exists because "already here" turned out to mean two different things
   * once a record could exist WITHOUT its document — a write refused on quota
   * leaves exactly that. Treating those as duplicates made the failure toast's
   * own instruction, "drop the file in again", impossible to follow: the second
   * drop was filtered out as a duplicate and no write was attempted.
   */
  hasBytes?: (file: VaultFile) => boolean,
) {
  const all = Array.from(list ?? [])

  const picked = all.filter((file) => !isProbablyDirectory(file))
  const folders = all.length - picked.length

  /**
   * "Already here" means the vault already holds a file by this name. Folded
   * for case and surrounding space, because that is how a person reads two
   * filenames as the same document and neither difference is one.
   *
   * It used to be `slugify(name)`, from `lib/ids` — a SECOND copy of
   * `kg/core/ref.slugify` — used to predict the slug `ctx.mintSlug` was about
   * to mint inside a transaction this function cannot see, so that two files
   * dropped in one gesture could not collide on an id. Two things retired that.
   * The runtime dedupes minted slugs against the same transaction now, so a
   * collision is no longer possible; and predicting another layer's key from a
   * copy of its function is a contract that breaks silently the first time
   * either side changes. The consequence is deliberate: 'CV 2026.pdf' and
   * 'CV-2026.pdf' dropped together are now two records rather than one and a
   * "1 already here", which is the honest answer — they are two files.
   */
  const fold = (name: string) => name.trim().toLowerCase()

  // A record with no bytes is not a duplicate, it is an empty shelf: dropping
  // the same file again fills it rather than being refused.
  const byName = new Map<string, VaultFile>()
  const seen = new Set<string>()
  for (const record of existing) {
    const key = fold(record.name)
    if (hasBytes === undefined || hasBytes(record)) seen.add(key)
    else if (!byName.has(key)) byName.set(key, record)
  }

  const fresh: File[] = []
  const refill: { file: File; record: VaultFile }[] = []
  for (const file of picked) {
    const key = fold(file.name)
    if (seen.has(key)) continue
    const empty = byName.get(key)
    if (empty) {
      refill.push({ file, record: empty })
      // Marked seen, so two drops of one name in a single gesture cannot both
      // claim the same empty record and race each other's write — the second
      // falls through to `skipped`, which is what it is.
      //
      // `seen` alone does this. A `byName.delete(key)` stood beside it and
      // removing it changed nothing, because the `seen` check runs first: one
      // guard, so there is no second one to keep in step.
      seen.add(key)
      continue
    }
    fresh.push(file)
    seen.add(key)
  }

  return {
    total: all.length,
    picked,
    fresh,
    /** Existing records that had no document, now given one. */
    refill,
    folders,
    skipped: picked.length - fresh.length - refill.length,
  }
}
