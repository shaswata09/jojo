/**
 * Where a document's bytes sit, named so its record can be found again. L1 core.
 *
 * One path segment carrying two things: which record the bytes belong to, and
 * what the person calls the file. `Documents/file_01H8XY__CV.pdf`.
 *
 * ## Why this is in core rather than next to a file store
 *
 * It was in `web/src/lib/vault-blobs.ts`, which is where it started life and
 * where it made sense while OPFS was the only thing that ever wrote one. It is
 * not a storage layout any more. `buildBackup` writes these paths into the
 * backup file, so they cross to whatever reads that file — including a phone
 * over the local network, which has no OPFS and no `VaultBlobs` and still has
 * to work out which record each document belongs to.
 *
 * That makes it a format, and a format with two implementations is a format
 * with two spellings. Parsed here once, by both.
 *
 * ## The two decisions inside it
 *
 * A SEPARATOR rather than a nested directory, because OPFS `list` is
 * non-recursive by contract: `Documents/<id>/<name>` lists as nothing at all,
 * so the index comes back empty on every reload — a silent "your files are
 * gone" that reads exactly like data loss.
 *
 * TWO underscores rather than one, because filenames are user data and go into
 * the same segment. A single underscore is common enough in a filename to split
 * a path at the wrong place; a doubled one is rare, and `encodeName` removes
 * even that by folding any it finds down to a single character.
 */

/** Everything jojo writes lands under one directory, so one `list` finds it. */
export const BLOB_DIR = 'Documents'

/** Separates the record id from the filename inside one path segment. */
export const BLOB_SEP = '__'

/** Filenames are user data and go into a key, so the separator has to survive. */
export const encodeName = (name: string) => name.split(BLOB_SEP).join('_')

export const blobPath = (id: string, name: string) =>
  `${BLOB_DIR}/${id}${BLOB_SEP}${encodeName(name)}`

/**
 * `Documents/file_01H…__CV.pdf` -> `file_01H…`. Null for anything else.
 *
 * Null matters more than it looks. A restore uses it to decide whether a
 * document in the file belongs to a record at all, and a path that cannot be
 * parsed belongs to none — writing it anyway would spend the person's storage
 * on bytes nothing in the app can reach or delete.
 */
export function idOfPath(path: string): string | null {
  if (!path.startsWith(`${BLOB_DIR}/`)) return null
  const rest = path.slice(BLOB_DIR.length + 1)
  const at = rest.indexOf(BLOB_SEP)
  return at <= 0 ? null : rest.slice(0, at)
}

/** The half a person recognises. Falls back to the whole segment. */
export const nameOfPath = (path: string): string => {
  const rest = path.slice(BLOB_DIR.length + 1)
  const at = rest.indexOf(BLOB_SEP)
  return at < 0 ? rest : rest.slice(at + BLOB_SEP.length)
}
