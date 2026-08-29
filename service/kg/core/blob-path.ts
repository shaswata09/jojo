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
 * ## The three decisions inside it
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
 *
 * A BYTE BUDGET on the name half, because both halves share one segment and a
 * segment has a hard limit of 255 bytes on every filesystem jojo lands on. A
 * 124-character CJK name is 364 bytes and its segment 407, and the phone's
 * restore turns that into a failed write and a record with no document. See
 * `MAX_SEGMENT_BYTES`.
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
 * The longest ONE PATH SEGMENT may be, in BYTES.
 *
 * 255 is the per-name cap on ext4, APFS, HFS+ and NTFS, and Chromium's OPFS
 * enforces the same on the names it will accept. It is counted in BYTES on all
 * of them but NTFS, and bytes is the number that bites: CJK is three bytes per
 * character in UTF-8, so a 124-character name (`契約書` x40 + `.pdf`) is 364
 * bytes, and 407 once the record id and the separator go in front of it.
 * Measured — that is where this constant came from, not from a spec.
 *
 * What an over-long segment costs is not a warning. The phone's restore
 * concatenates the segment into a real filesystem write, so the write fails
 * with ENAMETOOLONG and that one document lands as a record with no bytes: the
 * same shape as a document that never came across at all, out of a transfer
 * that otherwise entirely worked.
 */
const MAX_SEGMENT_BYTES = 255

/**
 * How much of a segment the id half is allowed to want.
 *
 * jojo's own ids are `file:` plus a UUIDv7 — 41 bytes — so 64 is that with room
 * for a longer prefix later.
 *
 * A RESERVATION rather than a measurement of the id in hand, because
 * `encodeName` is called twice in places that do not hold the id: `nameOfPath`
 * below, and the phone's restore, which rebuilds this same segment out of a
 * backup path (`mobile/src/lib/restore-documents.ts`). One reservation both
 * sides agree on keeps the name the phone writes byte-identical to the name the
 * backup carries. An id-aware budget on one side only would have the two
 * disagree, and then the file on the phone no longer matches the path that
 * named it — which is a lost document dressed up as a present one.
 */
const RESERVED_ID_BYTES = 64

/** What is left for the name half once the id and the separator are paid for. */
const MAX_NAME_BYTES = MAX_SEGMENT_BYTES - RESERVED_ID_BYTES - BLOB_SEP.length

/**
 * The longest trailing `.xyz` still treated as an extension worth preserving.
 *
 * `.numbers` is 8 and `.markdown` is 9; 16 covers those and still refuses to
 * read the tail of `report.2026-final-revision-b` as an extension and drag it to
 * the front of the cut.
 */
const MAX_EXT_BYTES = 16

/**
 * UTF-8 length, without a `TextEncoder`.
 *
 * Same reason as `core/utf8.ts` and `core/capture.ts`: the global is banned in
 * this layer, and Hermes does not ship one anyway — the first sign would be a
 * phone throwing at the end of a restore. Counting code points is exact for the
 * question and needs nothing.
 */
const byteLength = (text: string): number => {
  let bytes = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
  }
  return bytes
}

/**
 * The first `budget` bytes of `text`, cut only where a character ends.
 *
 * Iterated by code point rather than sliced: `slice` counts UTF-16 units and
 * halves an emoji into a lone surrogate, and a byte-wise cut halves a CJK
 * character into a sequence no decoder will take. Either one hands the OS a
 * name it may refuse outright, which is the failure this file is here to
 * prevent rather than to relocate.
 */
const cutToBytes = (text: string, budget: number): string => {
  let out = ''
  let bytes = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    const size = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
    if (bytes + size > budget) break
    out += ch
    bytes += size
  }
  return out
}

/**
 * `name` shortened to `budget` bytes with its extension still on the end.
 *
 * THE EXTENSION SURVIVES THE CUT because it is the only part of a filename a
 * platform reads as meaning. `nameOfPath` feeds `mimeOfFile` in the web Vault
 * and the phone's `file://` uri goes to the OS viewer; a document truncated to
 * `契約書契約書…契約` opens in nothing on either, while the same document ending
 * `.pdf` opens correctly and merely reads short.
 *
 * TRUNCATION CANNOT MERGE TWO DOCUMENTS, and that is worth stating because a
 * truncation that did would be worse than the long name it fixed. Uniqueness in
 * this format lives entirely in the id half, which is never cut: two records
 * with names sharing a 189-byte prefix still differ in the segment before the
 * separator. Two names under ONE id are one record's document, which the store
 * already treats as a single slot — it overwrote before this function existed.
 * That is why there is no hash suffix here: it would buy nothing and would put
 * eight bytes of noise into every long name a person reads.
 */
const trimName = (name: string, budget: number): string => {
  if (budget <= 0) return ''
  if (byteLength(name) <= budget) return name
  const dot = name.lastIndexOf('.')
  // `dot > 0`, not `>= 0`: in `.gitignore` the dot opens a HIDDEN FILE rather
  // than an extension, and treating the whole name as one to preserve would keep
  // the tail and drop the stem — the opposite of what the person named.
  const ext = dot > 0 ? name.slice(dot) : ''
  const extBytes = byteLength(ext)
  if (extBytes > 0 && extBytes <= MAX_EXT_BYTES && extBytes < budget) {
    return cutToBytes(name.slice(0, dot), budget - extBytes) + ext
  }
  return cutToBytes(name, budget)
}

/**
 * Filenames are user data and go into a key, so the separator has to survive —
 * and so does the guarantee that a segment stays a segment, and that the segment
 * is one a filesystem will accept.
 *
 * Folding `__` is about parsing: it keeps `idOfPath` splitting where it should.
 * Replacing the rest is about safety. This value is concatenated into a real
 * filesystem path by the phone's restore, so a name of `../../databases/x`
 * would climb out of the directory it was written to.
 *
 * Trimming is about the write SUCCEEDING: see `MAX_SEGMENT_BYTES`. It is done
 * last, so the cut is measured on the characters that will actually be written
 * rather than on the ones that were about to be replaced, and it is idempotent —
 * the phone runs this a second time over a name that already came through it.
 *
 * DOTS, SPACES AND HYPHENS ARE LEFT ALONE DELIBERATELY. `..` can only climb
 * when a separator follows it, and no separator survives this function — so
 * stripping dots would buy nothing and would rename `..config` for no reason.
 * The other two are ordinary filename characters; a guard that mangles
 * `My CV - final.pdf` has cost the person something real to prevent nothing.
 */
export const encodeName = (name: string) =>
  trimName(
    name.split(BLOB_SEP).join('_').replace(new RegExp(UNSAFE_NAME.source, 'g'), '_'),
    MAX_NAME_BYTES,
  )

/**
 * The trim is applied a SECOND time here, against the id actually in hand.
 *
 * `encodeName` can only budget for a reserved id length, and it must, because
 * its other callers do not have the id. This one does, so a caller that mints
 * ids longer than `RESERVED_ID_BYTES` — a future prefix, or a foreign backup
 * being re-filed — still gets a segment inside the limit rather than a write
 * that fails at restore. For every id jojo mints today the reservation is the
 * smaller number and this call changes nothing, which is what keeps the path
 * here and the path the phone builds identical.
 *
 * An id longer than 253 bytes on its own is past saving and yields an empty
 * name half; the segment is over the limit because the ID is, and nothing this
 * function can do to the name would bring it back under.
 */
export const blobPath = (id: string, name: string) =>
  `${BLOB_DIR}/${id}${BLOB_SEP}${trimName(encodeName(name), MAX_SEGMENT_BYTES - BLOB_SEP.length - byteLength(id))}`

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
