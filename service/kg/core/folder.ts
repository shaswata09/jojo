/**
 * L1 — the folder's rules, as pure functions.
 *
 * Naming, collision, drift classification, orphan pairing and the rebuild plan.
 * Everything here is a total function over plain data: no handles, no promises,
 * no DOM. `core` may import nothing outside `core` and compiles with
 * `"lib": ["ES2023"]` and `"types": []`, so a `FileSystemDirectoryHandle` in
 * this file is a compile error rather than a review comment.
 *
 * That constraint is the point rather than an obstacle. D20 forbids mounting
 * components in tests, so anything that lives in a React hook is verifiable only
 * by hand in a browser. Pulling every decision the folder feature makes down
 * into this module is what buys it a real test suite — the hook above it is left
 * with wiring, which is the part hand-verification is actually good at.
 *
 * The entry and record shapes are declared here rather than imported from
 * `storage/file-store.ts` for the same layering reason. They are structural, so
 * a `FileEntry` satisfies `FolderEntry` without either side knowing about the
 * other, and the duplication is four fields wide.
 */

/** Structurally satisfied by `storage/file-store.ts`'s `FileEntry`. */
export type FolderEntry = {
  readonly path: string
  readonly bytes: number
  readonly mtime: number
}

/** The four byte-facts a file record carries. Structurally a `FileProps`. */
export type FileLink = {
  readonly path?: string | undefined
  readonly bytes?: number | undefined
  readonly mtime?: number | undefined
  readonly hash?: string | undefined
}

/**
 * What a row knows about its bytes, right now, in this session.
 *
 * Session state, never in `props`. A file's `path` is durable; whether the bytes
 * behind it were reachable ninety seconds ago is not, and writing that to the
 * graph would mean a commit — and a mirror write — every time a window regained
 * focus.
 *
 * `unknown` is the one that matters most and is easiest to get wrong. It means
 * "not checked", and it must never render as `missing`: a user who has not
 * granted permission this session has lost nothing, and telling them a document
 * is missing when jojo simply has not looked is the kind of true-sounding lie
 * that costs trust permanently.
 */
export type FileState =
  /** Path present, confirmed by a real I/O call this session. */
  | 'stored'
  /** Bytes queued or being written. */
  | 'pending'
  /** The byte write was refused. The record has no path — see the ordering rule. */
  | 'failed'
  /** Path present, the folder is reachable, this entry is not in it. */
  | 'missing'
  /** Found, but `bytes` or `mtime` disagree with the record. */
  | 'changed'
  /** No path. Nothing is wrong; this is every record that predates the folder. */
  | 'record-only'
  /** No folder, permission lapsed, or simply not listed yet this session. */
  | 'unknown'

/** Characters no filesystem should be asked to take, plus the C0 range. */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[/\\:*?"<>|\u0000-\u001f\u007f]/g

/**
 * 200 bytes, not 200 characters.
 *
 * The limits that bite are byte limits — 255 on ext4 and APFS, and lower once a
 * sync client wraps the name. A CJK filename is three bytes a character, so a
 * character-counted truncation passes every test written in English and then
 * fails on the first user who names a CV in Japanese.
 */
const MAX_NAME_BYTES = 200

/**
 * Exported for the tests, which cannot use `TextEncoder` to check their own
 * expectations: `core` compiles with `"lib": ["ES2023"]` and `"types": []`, so
 * the DOM global is a compile error here — as it should be, since a React
 * Native adapter gets a different one. Hand-rolled for the same reason.
 */
export const utf8Length = (s: string): number => {
  let n = 0
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4
  }
  return n
}

/** Splits on the LAST dot, so `CV.final.pdf` keeps `.pdf` and not `.final.pdf`. */
function splitExtension(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.')
  // A leading dot is not an extension — `.gitignore` is a whole name. And a
  // trailing dot leaves an empty extension, which is worse than none.
  if (dot <= 0 || dot === name.length - 1) return { stem: name, ext: '' }
  return { stem: name.slice(0, dot), ext: name.slice(dot) }
}

/** Truncates the stem, never the extension — the extension is what picks the icon. */
function truncateToBytes(stem: string, ext: string): string {
  const budget = MAX_NAME_BYTES - utf8Length(ext)
  if (utf8Length(stem) <= budget) return stem + ext
  let out = ''
  let used = 0
  // Iterated by code point rather than by index so a surrogate pair is never
  // cut in half, which would produce a lone surrogate the filesystem rejects.
  for (const ch of stem) {
    const c = ch.codePointAt(0) ?? 0
    const w = c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4
    if (used + w > budget) break
    out += ch
    used += w
  }
  return out + ext
}

/**
 * A user's filename, made safe to write, with as little changed as possible.
 *
 * Deliberately not a slug. The whole premise of the folder is that it is worth
 * opening in Finder, and `cv-rice-oct-2026.pdf` is a worse thing to find there
 * than `CV Rice Oct 2026.pdf`. Spaces, case, accents and parentheses all survive;
 * only what a filesystem or a path parser would choke on is removed.
 */
export function sanitiseFileName(name: string): string {
  const cleaned = name.replace(UNSAFE, '').replace(/^\.+/, '').trim()
  // Windows reserves these as device names regardless of extension, and a
  // folder synced to a Windows machine is a normal thing to want.
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
  const { stem, ext } = splitExtension(cleaned)
  if (cleaned === '' || reserved.test(stem)) {
    return truncateToBytes(cleaned === '' ? 'Untitled' : `${stem}_`, ext)
  }
  // A trailing dot or space is legal on POSIX and silently stripped by Windows,
  // which turns one file into two names that disagree about which it is.
  return truncateToBytes(stem.replace(/[. ]+$/, '') || 'Untitled', ext)
}

/**
 * `Documents/<safe name>`, with ` (2)`, ` (3)` on collision.
 *
 * `taken` is probed from the folder inside the write lock, not remembered — a
 * folder is a shared mutable thing and anything cached about its contents is
 * stale by the time it is used.
 *
 * The suffix goes before the extension, the way every desktop file manager does
 * it, because a folder full of `CV_Rice.pdf (2)` is a folder that no longer
 * opens in a PDF viewer on double-click.
 */
export function documentPath(name: string, taken: ReadonlySet<string>): string {
  const safe = sanitiseFileName(name)
  const first = `${DOCUMENTS}/${safe}`
  if (!taken.has(first)) return first

  const { stem, ext } = splitExtension(safe)
  // Bounded rather than `while (true)`: at a thousand identically-named files
  // something is looping, and a loop that cannot terminate inside a write lock
  // held across tabs is the worst possible place to discover that.
  for (let n = 2; n <= 1000; n += 1) {
    const candidate = `${DOCUMENTS}/${stem} (${n})${ext}`
    if (!taken.has(candidate)) return candidate
  }
  throw new Error(`could not find a free name for ${safe} after 1000 attempts`)
}

const DOCUMENTS = 'Documents'

/**
 * What to show for one row, given what the folder said.
 *
 * `entry` is `undefined` for "the folder was listed and this path was not in
 * it", and `null` for "not listed this session". Those are different answers and
 * collapsing them is exactly how `unknown` starts rendering as `missing`.
 */
export function classifyFile(
  link: FileLink,
  entry: FolderEntry | undefined | null,
  opts: { connected: boolean; pending?: boolean; failed?: boolean },
): FileState {
  if (opts.pending === true) return 'pending'
  if (opts.failed === true) return 'failed'
  // Checked before connectedness on purpose: a record with no path is complete
  // and correct whether or not a folder exists, and calling it `unknown` would
  // put a "not checked" affordance on every row of a store that has no bytes at
  // all — which is every existing user on the day they upgrade.
  if (link.path === undefined) return 'record-only'
  if (!opts.connected) return 'unknown'
  if (entry === null) return 'unknown'
  if (entry === undefined) return 'missing'

  // Size first: it is exact, and `mtime` alone flips for reasons that are not
  // edits — a sync client rewriting timestamps across a whole folder is the
  // measured case, and treating that as 200 changed documents is noise.
  if (link.bytes !== undefined && entry.bytes !== link.bytes) return 'changed'
  if (link.mtime !== undefined && entry.mtime !== link.mtime) return 'changed'
  return 'stored'
}

/** A record the folder cannot account for, paired with a possible replacement. */
export type Relink = {
  readonly nodeId: string
  /** Same bytes under a different name — safe to relink with zero writes. */
  readonly candidatePath: string
}

/**
 * Files in `Documents/` no record points at, and the safe relinks among them.
 *
 * A relink is offered **only** on hash equality. Filename matching is what an
 * impatient version of this would do, and it is wrong in the one case it would
 * fire most: a user who renamed `CV.pdf` to `CV_old.pdf` and saved a new
 * `CV.pdf` gets their current CV silently attached to last month's record.
 *
 * Everything else is an orphan, and an orphan's only offered action is "File
 * it". There is deliberately no bulk delete: these are documents jojo did not
 * create, in a folder whose entire premise is that the user owns it.
 */
export function pairFolder(
  records: readonly { id: string; link: FileLink }[],
  entries: readonly FolderEntry[],
  hashOf: (path: string) => string | undefined,
): { orphans: readonly FolderEntry[]; relinks: readonly Relink[] } {
  const claimed = new Set<string>()
  const missing: { id: string; hash: string }[] = []

  for (const r of records) {
    if (r.link.path === undefined) continue
    claimed.add(r.link.path)
    if (!entries.some((e) => e.path === r.link.path) && r.link.hash !== undefined) {
      missing.push({ id: r.id, hash: r.link.hash })
    }
  }

  const unclaimed = entries.filter(
    (e) => !claimed.has(e.path) && e.path.startsWith(`${DOCUMENTS}/`),
  )

  const relinks: Relink[] = []
  const used = new Set<string>()
  for (const m of missing) {
    const hit = unclaimed.find((e) => !used.has(e.path) && hashOf(e.path) === m.hash)
    if (hit === undefined) continue
    used.add(hit.path)
    relinks.push({ nodeId: m.id, candidatePath: hit.path })
  }

  return { orphans: unclaimed.filter((e) => !used.has(e.path)), relinks }
}

/** One file record's worth of facts, recovered from a folder with no graph. */
export type RebuiltFile = {
  readonly name: string
  readonly path: string
  readonly bytes: number
  readonly mtime: number
}

/**
 * Path B: rebuild from `Documents/` alone, when `graph.json` is gone or torn.
 *
 * Returns documents and nothing else. With a flat layout there is nothing to
 * infer, and the temptation to invent organisations from folder names would
 * manufacture records the user never made and cannot tell apart from ones they
 * did. **This returns your documents, not your job search**, and the copy above
 * it has to say so in those words.
 */
export function planRebuild(entries: readonly FolderEntry[]): readonly RebuiltFile[] {
  return (
    entries
      .filter((e) => e.path.startsWith(`${DOCUMENTS}/`) && !e.path.endsWith('.crswap'))
      .map((e) => ({
        name: e.path.slice(DOCUMENTS.length + 1),
        path: e.path,
        bytes: e.bytes,
        mtime: e.mtime,
      }))
      // Plain `<`, not `localeCompare`. The portability audit established that
      // `kg` contains zero `Intl.*` / `toLocale*` / `localeCompare` calls, and
      // that is a property worth keeping rather than a coincidence: Hermes ships
      // without full ICU, so a locale-aware comparison there sorts differently
      // from the same code on web. A restore listing that reorders itself
      // depending on the platform is a difference nobody would think to test for.
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  )
}
