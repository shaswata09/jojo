import { zipSync, type Zippable } from 'fflate'
import { encodeName } from '@jojo/service/core/blob-path'
import type { ISODate } from '@jojo/service/core/model'

/**
 * Every stored document in one ZIP, for "Download every document".
 *
 * That button used to start one download per document, 250ms apart, because a
 * browser that sees a burst of programmatic downloads blocks all but the first.
 * The gap made it slower without making it reliable: the user still got a
 * folder of loose files, a permission prompt in some browsers, and a toast that
 * could only guess at how many had been blocked. One archive is one download —
 * nothing to block, nothing to count, and the CVs arrive together.
 *
 * Pure, and kept apart from the panel, so the decisions that can be wrong — the
 * names inside the archive and the bytes behind them — run under vitest. The
 * click, the Blob URL and the toast stay in `DocumentsPanel`.
 */

/** One document on its way into the archive. */
export type ArchiveEntry = {
  name: string
  bytes: Uint8Array
  /** `File.lastModified`. Optional: the archive gets a time either way. */
  modified?: number
}

/**
 * Kinds whose bytes are already compressed, stored rather than deflated.
 *
 * A PDF, an Office document or an image is compressed inside already, so
 * deflating it again buys nothing and costs main-thread time on every byte —
 * `zipSync` runs on the click. Stored, an entry costs a copy and a checksum.
 * Everything else (`.txt`, `.md`, a saved page) is text, deflates well, and is
 * small enough that compressing it is free.
 */
const ALREADY_COMPRESSED = new Set([
  'pdf',
  'docx',
  'xlsx',
  'pptx',
  'odt',
  'ods',
  'odp',
  'pages',
  'key',
  'numbers',
  'epub',
  'zip',
  'gz',
  '7z',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'heic',
  'avif',
  'mp3',
  'mp4',
  'm4a',
  'mov',
])

/** `report.final.pdf` → `{ stem: 'report.final', ext: '.pdf' }`; a dotfile has no extension. */
function split(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? { stem: name, ext: '' } : { stem: name.slice(0, dot), ext: name.slice(dot) }
}

/**
 * The name each document gets inside the archive, one per input, in order.
 *
 * Through `encodeName` first — the app's one filename policy, the same function
 * that names these documents in storage and on the phone's disk — so no entry
 * carries a path separator. That is what keeps an archive entry a file rather
 * than a path: `../x` cannot climb out of the folder it is unzipped into.
 *
 * Then made unique, because two documents may well share a name (two `CV.pdf`s
 * filed months apart) and a ZIP keyed on names would keep only the last one —
 * a document silently missing from the very download meant to save it. The
 * comparison ignores case, since macOS and Windows unzip `CV.pdf` and `cv.pdf`
 * onto the same file. The second becomes `CV (2).pdf`, counted past any name
 * that is already taken, including a real `CV (2).pdf`.
 */
export function uniqueEntryNames(names: readonly string[]): string[] {
  const taken = new Set<string>()
  return names.map((raw) => {
    const name = encodeName(raw).trim() || 'document'
    let candidate = name
    if (taken.has(candidate.toLowerCase())) {
      const { stem, ext } = split(name)
      let n = 2
      while (taken.has(`${stem} (${n})${ext}`.toLowerCase())) n += 1
      candidate = `${stem} (${n})${ext}`
    }
    taken.add(candidate.toLowerCase())
    return candidate
  })
}

/**
 * ZIP stores times as MS-DOS fields, and `fflate` throws for any LOCAL year
 * outside 1980–2099 rather than clamping. `File.lastModified` is 0 for a file
 * whose time the browser could not read — and 1970 would have thrown the whole
 * archive away over one document's metadata. A day inside each end, so no time
 * zone can push a boundary instant into the neighbouring year.
 */
const DOS_EPOCH = Date.UTC(1980, 0, 2)
const DOS_END = Date.UTC(2099, 11, 30)

/**
 * The archive itself. Entries keep the order given, and every name must
 * already be unique — pass them through `uniqueEntryNames`; a duplicate here
 * would overwrite, which is exactly the loss that function exists to prevent.
 */
export function buildArchive(entries: readonly ArchiveEntry[]): Uint8Array<ArrayBuffer> {
  const files: Zippable = {}
  for (const entry of entries) {
    const ext = split(entry.name).ext.slice(1).toLowerCase()
    const level = ALREADY_COMPRESSED.has(ext) ? 0 : 6
    const modified = entry.modified
    const dated = modified !== undefined && modified >= DOS_EPOCH && modified <= DOS_END
    files[entry.name] = [entry.bytes, dated ? { level, mtime: modified } : { level }]
  }
  return zipSync(files)
}

/** `jojo-documents-2026-10-03.zip` — dated, so a second download does not land on the first. */
export function archiveName(day: ISODate): string {
  return `jojo-documents-${day}.zip`
}
