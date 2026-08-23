/**
 * A backup that can actually be restored, and the reader that validates one.
 *
 * ## Why the existing export is not this
 *
 * `use-admin.ts`'s `exportJSON` serialises PROJECTIONS — `applications`,
 * `timeline`, `links` and the rest. Those are denormalised views built by
 * walking the graph, so they are excellent to read and impossible to restore
 * from: an application's stage, its keywords and its files appear there as
 * flattened fields with no record of which nodes and which edges produced them.
 * Rebuilding a graph from them means guessing, and a guess that is wrong makes
 * a restore that silently loses relationships.
 *
 * A backup therefore carries the RAW rows — `GraphSnapshot.nodes()` and
 * `.edges()`, described in `snapshot.ts` as "Everything, for persistence, export
 * and the boot integrity check" — and the document bytes beside them. The
 * projections are kept too, because a person opening the file should be able to
 * read what is in it, and because that is what every backup written before this
 * one looked like.
 *
 * ## Why base64, and why it is implemented here
 *
 * One file. A person who has a backup has all of it — a JSON file plus a folder
 * of loose PDFs is two things to keep together and one thing to lose. The cost
 * is a third more bytes and holding the encoded string in memory, which for a
 * job search's documents is tens of megabytes at the outside.
 *
 * `btoa`/`atob` are DOM, and `Buffer` is Node; `check-platform.mjs` bans both
 * from `core`. So the codec is written out longhand below. That also makes it
 * testable in the ordinary test process, which matters more than it sounds:
 * a codec that corrupts one byte in a million produces a PDF that opens on the
 * machine that wrote it and fails on the one that restores it.
 */

import type { StoredEdge, StoredNode } from './model'

/** Distinguishes a jojo backup from any other JSON someone might open. */
export const BACKUP_FORMAT = 'jojo.backup'

/**
 * Bumped only when an older reader could MISREAD a newer file. Adding a field a
 * reader ignores is not that; changing what an existing field means is.
 */
export const BACKUP_VERSION = 1

/** One stored document, path and bytes. `data` is base64. */
export type BackupDocument = {
  /** Folder-relative POSIX path, exactly as the `FileStore` holds it. */
  path: string
  /** Decoded length. Carried so a truncated file is caught before it is trusted. */
  bytes: number
  data: string
}

export type Backup = {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: string
  graph: {
    nodes: readonly StoredNode[]
    edges: readonly StoredEdge[]
  }
  documents: readonly BackupDocument[]
  /**
   * The human-readable half, and the shape every previous backup had.
   *
   * Never read back on restore — the graph above is the source of truth, and
   * restoring from both would mean deciding which wins. It is here so the file
   * opens into something a person recognises.
   */
  readable?: unknown
}

/* --- base64, longhand ------------------------------------------------------ */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Reverse table, built once. -1 marks a byte that is not base64 at all. */
const REVERSE = /* @__PURE__ */ (() => {
  const table = new Int8Array(256).fill(-1)
  for (let i = 0; i < ALPHABET.length; i += 1) table[ALPHABET.charCodeAt(i)] = i
  return table
})()

/**
 * The table lookup, with the bounds check that makes it safe.
 *
 * `REVERSE` has 256 entries and a JavaScript string does not: one character of
 * Korean, Greek, or an emoji's surrogate half indexes PAST the end. A typed
 * array returns `undefined` there rather than throwing, `undefined < 0` is
 * false, and `undefined << 18` is 0 — so the decoder waved the character through
 * and emitted a zero byte for it.
 *
 * Measured before the fix: `fromBase64('SGVs' + '\u1112\u1112\u1112\u1112')`
 * returned `[72,101,108,0,0,0]` instead of null. That is the worst shape a codec
 * failure can take — not a throw, not a refusal, but plausible bytes invented
 * for input it did not understand, written into a restored document.
 *
 * The test that was supposed to catch it used `'!!!!'` and `'===='`, which are
 * all below 256 and all correctly refused. A guard is only as good as the range
 * its cases cover.
 */
const sextet = (text: string, at: number): number => {
  const code = text.charCodeAt(at)
  return code < 256 ? REVERSE[code]! : -1
}

export function toBase64(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  // Three bytes in, four characters out. The tail is handled after the loop
  // rather than inside it, because a branch per triple on a multi-megabyte
  // document is the difference between a backup that feels instant and one that
  // stalls the tab.
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!
    out +=
      ALPHABET[(n >> 18) & 63]! +
      ALPHABET[(n >> 12) & 63]! +
      ALPHABET[(n >> 6) & 63]! +
      ALPHABET[n & 63]!
  }
  const left = bytes.length - i
  if (left === 1) {
    const n = bytes[i]! << 16
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + '=='
  } else if (left === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8)
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + '='
  }
  return out
}

/** Returns null for anything that is not valid base64, rather than guessing. */
export function fromBase64(text: string): Uint8Array | null {
  // Whitespace is legal in the wild — a JSON pretty-printer or an editor can
  // wrap a long string — and stripping it is not the same as ignoring garbage.
  const clean = text.replace(/[\n\r\t ]/g, '')
  if (clean.length % 4 !== 0) return null

  // Padding belongs at the very end and nowhere else. Without this check
  // `YQ=A` decoded to three bytes instead of being refused — measured — because
  // the `=` was read as "this slot is zero" wherever it appeared. A decoder that
  // invents bytes for malformed input is worse than one that throws: the bytes
  // it invents land in a restored document.
  const firstPad = clean.indexOf('=')
  if (firstPad !== -1) {
    const tail = clean.slice(firstPad)
    // Only `=` or `==`, and only as the last one or two characters.
    if (tail !== '=' && tail !== '==') return null
  }

  let padding = 0
  if (clean.endsWith('==')) padding = 2
  else if (clean.endsWith('=')) padding = 1

  const out = new Uint8Array((clean.length / 4) * 3 - padding)
  let at = 0
  for (let i = 0; i < clean.length; i += 4) {
    const a = sextet(clean, i)
    const b = sextet(clean, i + 1)
    const c = clean[i + 2] === '=' ? 0 : sextet(clean, i + 2)
    const d = clean[i + 3] === '=' ? 0 : sextet(clean, i + 3)
    if (a < 0 || b < 0 || c < 0 || d < 0) return null
    const n = (a << 18) | (b << 12) | (c << 6) | d
    if (at < out.length) out[at++] = (n >> 16) & 255
    if (at < out.length) out[at++] = (n >> 8) & 255
    if (at < out.length) out[at++] = n & 255
  }
  return out
}

/* --- writing --------------------------------------------------------------- */

export type BackupInput = {
  exportedAt: string
  nodes: readonly StoredNode[]
  edges: readonly StoredEdge[]
  documents: readonly { path: string; data: Uint8Array }[]
  readable?: unknown
}

export function buildBackup(input: BackupInput): Backup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: input.exportedAt,
    graph: { nodes: input.nodes, edges: input.edges },
    documents: input.documents.map((d) => ({
      path: d.path,
      bytes: d.data.byteLength,
      data: toBase64(d.data),
    })),
    ...(input.readable === undefined ? {} : { readable: input.readable }),
  }
}

/* --- reading --------------------------------------------------------------- */

export type BackupReadFailure =
  /** Not JSON at all. */
  | { code: 'backup/unreadable'; message: string }
  /** JSON, but not one of ours — a projections-only export, or another app's file. */
  | { code: 'backup/not-a-backup'; message: string }
  /** Ours, but written by a version this build cannot safely read. */
  | { code: 'backup/too-new'; message: string }
  /** Ours and the right version, but damaged. */
  | { code: 'backup/corrupt'; message: string }

export type BackupRead =
  | { ok: true; value: RestorePlan }
  | { ok: false; error: BackupReadFailure }

/** What a restore actually needs: rows to write, and bytes to write beside them. */
export type RestorePlan = {
  exportedAt: string
  nodes: readonly StoredNode[]
  edges: readonly StoredEdge[]
  documents: readonly { path: string; data: Uint8Array }[]
}

const fail = (code: BackupReadFailure['code'], message: string): BackupRead => ({
  ok: false,
  error: { code, message } as BackupReadFailure,
})

/**
 * Parses and VALIDATES a backup.
 *
 * Every branch below refuses rather than repairs. A restore replaces everything
 * the user has, so a file that is 90% readable is not 90% of a restore — it is a
 * way to end up with 90% of your records and no way back to the other 10%. The
 * only safe answers are "this is a whole backup" and "this is not".
 */
export function readBackup(text: string): BackupRead {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    return fail('backup/unreadable', e instanceof Error ? e.message : 'not JSON')
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return fail('backup/not-a-backup', 'not an object')
  }
  const file = parsed as Partial<Backup>

  if (file.format !== BACKUP_FORMAT) {
    // The likeliest wrong file is one of jojo's own older, projections-only
    // exports, so it is worth naming rather than calling it foreign.
    const looksLikeOldExport = 'applications' in (parsed as object) && 'jojo' in (parsed as object)
    return fail(
      'backup/not-a-backup',
      looksLikeOldExport
        ? 'this is an older export that holds only the readable summary, not the data needed to restore'
        : 'this file was not written by jojo',
    )
  }
  if (typeof file.version !== 'number' || file.version > BACKUP_VERSION) {
    return fail('backup/too-new', `written by a newer version of jojo (${String(file.version)})`)
  }
  if (typeof file.graph !== 'object' || file.graph === null) {
    return fail('backup/corrupt', 'no graph in the file')
  }
  const { nodes, edges } = file.graph as { nodes?: unknown; edges?: unknown }
  if (!Array.isArray(nodes) || !Array.isArray(edges)) {
    return fail('backup/corrupt', 'the graph is not a pair of lists')
  }
  if (!Array.isArray(file.documents)) {
    return fail('backup/corrupt', 'no document list in the file')
  }

  const documents: { path: string; data: Uint8Array }[] = []
  for (const entry of file.documents) {
    const doc = entry as Partial<BackupDocument>
    if (typeof doc.path !== 'string' || typeof doc.data !== 'string') {
      return fail('backup/corrupt', 'a document entry is missing its path or its bytes')
    }
    const data = fromBase64(doc.data)
    if (data === null) {
      return fail('backup/corrupt', `the bytes of ${doc.path} are not readable`)
    }
    // The length is checked, not trusted. A file truncated by a failed download
    // decodes cleanly right up to the cut, and without this a restore would
    // write a half PDF over a whole one and report success.
    if (typeof doc.bytes === 'number' && doc.bytes !== data.byteLength) {
      return fail(
        'backup/corrupt',
        `${doc.path} should be ${doc.bytes} bytes but is ${data.byteLength} — the file looks truncated`,
      )
    }
    documents.push({ path: doc.path, data })
  }

  return {
    ok: true,
    value: {
      exportedAt: typeof file.exportedAt === 'string' ? file.exportedAt : '',
      nodes: nodes as readonly StoredNode[],
      edges: edges as readonly StoredEdge[],
      documents,
    },
  }
}

/** A one-line summary for a confirmation dialog: what is about to replace what. */
export function describeBackup(plan: RestorePlan): string {
  const docs = plan.documents.length
  return (
    `${plan.nodes.length} records, ${plan.edges.length} links` +
    (docs === 0 ? ', no documents' : `, ${docs} document${docs === 1 ? '' : 's'}`)
  )
}
