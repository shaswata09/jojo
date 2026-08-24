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

/**
 * Anything that would make one path segment mean more than one segment.
 *
 * Both separators, because a backup written on one platform is restored on
 * another and a backslash is a separator on exactly one of them. Control
 * characters because a filename carrying one is refused outright by some
 * filesystems, which turns one bad row into a failed restore.
 *
 * NO COLON, and that is not an oversight. jojo's own ids carry one —
 * `file:01a02b14-…` — so a rule that refused a colon would refuse every real
 * document jojo has ever written. It is a hazard on Windows and it is not one
 * here; the name half strips it separately below, where nothing depends on it.
 */
// Matching control characters IS the intent here: see above. The rule is
// advisory for exactly this case.
// eslint-disable-next-line no-control-regex
const UNSAFE_SEGMENT = /[/\\\u0000-\u001f\u007f]/

/**
 * The same, plus the colon, for the half that becomes a FILENAME.
 *
 * The id keeps its colon because it is an id. A filename does not need one and
 * several filesystems will not take it, so it goes here — where refusing it
 * costs a person nothing but a substituted character.
 */
// eslint-disable-next-line no-control-regex
const UNSAFE_NAME = /[/\\:\u0000-\u001f\u007f]/

/**
 * Filenames are user data and go into a key, so the separator has to survive —
 * and so does the guarantee that a segment stays a segment.
 *
 * Folding `__` is about parsing: it keeps `idOfPath` splitting where it should.
 * Replacing the rest is about safety. This value is concatenated into a real
 * filesystem path by the phone's restore, so a name of `../../databases/x`
 * would climb out of the directory it was written to.
 *
 * DOTS, SPACES AND HYPHENS ARE LEFT ALONE DELIBERATELY. `..` can only climb
 * when a separator follows it, and no separator survives this function — so
 * stripping dots would buy nothing and would rename `..config` for no reason.
 * The other two are ordinary filename characters; a guard that mangles
 * `My CV - final.pdf` has cost the person something real to prevent nothing.
 */
export const encodeName = (name: string) =>
  name.split(BLOB_SEP).join('_').replace(new RegExp(UNSAFE_NAME.source, 'g'), '_')


export const blobPath = (id: string, name: string) =>
  `${BLOB_DIR}/${id}${BLOB_SEP}${encodeName(name)}`

/**
 * `Documents/file_01H…__CV.pdf` -> `file_01H…`. Null for anything else.
 *
 * Null matters more than it looks, and it now carries two jobs.
 *
 * A restore uses it to decide whether a document in the file belongs to a
 * record at all, and a path that cannot be parsed belongs to none — writing it
 * anyway would spend the person's storage on bytes nothing in the app can reach
 * or delete.
 *
 * It is ALSO the confinement check. The id half is concatenated into a
 * filesystem path by the phone's restore, so `Documents/../../../x__y` would
 * write outside the directory the restore owns — into `shared_prefs`, into
 * `databases`, into jojo's own store — from a backup file the user imported or
 * one that arrived over a transfer, which has no confirmation step by design.
 * A path that is not a plain id is not a jojo path, so it parses to null and is
 * skipped like any other row that names no record.
 */
export function idOfPath(path: string): string | null {
  if (!path.startsWith(`${BLOB_DIR}/`)) return null
  const rest = path.slice(BLOB_DIR.length + 1)
  const at = rest.indexOf(BLOB_SEP)
  if (at <= 0) return null
  const id = rest.slice(0, at)
  if (UNSAFE_SEGMENT.test(id) || id === '.' || id === '..' || id.includes('..')) return null
  return id
}

/**
 * The half a person recognises, safe to use as a filename.
 *
 * Passed back through `encodeName` rather than returned raw: this is the other
 * half of the path the phone builds, so it climbs out of the restore directory
 * just as readily as the id does. Two callers wanted the display name and one
 * wanted a filename; returning the safe form to both costs a display nothing,
 * because the characters removed are ones a filename could not have carried.
 */
export const nameOfPath = (path: string): string => {
  const rest = path.slice(BLOB_DIR.length + 1)
  const at = rest.indexOf(BLOB_SEP)
  return encodeName(at < 0 ? rest : rest.slice(at + BLOB_SEP.length))
}
