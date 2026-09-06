import { strFromU8, unzipSync } from 'fflate'
import ReactNativeBlobUtil from 'react-native-blob-util'
import { MAX_BYTES } from '@jojo/service/agent/markitdown'
import type { ConvertResult } from '@jojo/service/agent/markitdown'
import { isArchive, partsFor, readableHere, textFrom } from '@jojo/service/agent/documents'
import { bytesFromBase64 } from '@/lib/base64'

/**
 * Reading a document on the handset, with nothing configured.
 *
 * ## Why the phone gets its own reader
 *
 * MarkItDown is a Python program on another machine. That is a fine arrangement
 * on a laptop and a poor one on a phone: there is no Python on Android or iOS,
 * there is no extension to install as there is in a desktop browser, and asking
 * somebody to start a server on a computer in another room before their handset
 * will read their own CV describes a remote application rather than a local
 * one. This closes that gap for the formats that can honestly be read in
 * JavaScript.
 *
 * Nothing leaves the device and nothing has to be set up. The reader address in
 * Settings stays exactly as useful as it was — see `markitdown.ts`, which falls
 * through to it for everything this cannot do, PDF most of all.
 *
 * ## Where the work is split
 *
 * The PARSING is in `@jojo/service/agent/documents` — pure string functions with
 * their own tests, no platform anywhere near them. What is here is the two
 * things a phone has and a pure layer does not: a filesystem, and a zip.
 */

/**
 * The largest archive this will open, in bytes.
 *
 * A DOCX is compressed, so the number that matters is not the file on disk but
 * what it becomes in memory: `unzipSync` allocates every entry at once, and a
 * 12 MB archive of scanned images expands to hundreds. `MAX_BYTES` is already
 * the ceiling `markitdown.ts` applies to what it will send, so the same number
 * bounds what this will open — one limit for one question, and a document over
 * it gets the same sentence from either path.
 */
const MAX_ARCHIVE_BYTES = MAX_BYTES

/** `file:///a/b.docx` → `/a/b.docx`. The twin of `markitdown.ts`'s. */
const pathOf = (uri: string) =>
  uri.startsWith('file://') ? decodeURIComponent(uri.slice('file://'.length)) : uri

/**
 * Text from a stored document, or null if this is not one we read here.
 *
 * NULL IS NOT A FAILURE and the distinction matters at the call site: null
 * means "not mine, use the reader you had", and a `{ ok: false }` means the
 * file is one we should have read and could not. Collapsing the two would send
 * every unreadable DOCX to a MarkItDown that is usually not running, and the
 * person would be told to configure a server for a file the phone could open.
 */
export async function readOnDevice(uri: string, name: string): Promise<ConvertResult | null> {
  const kind = readableHere(name)
  if (kind === null) return null

  const path = pathOf(uri)
  try {
    const stat = await ReactNativeBlobUtil.fs.stat(path)
    if (Number(stat.size) > MAX_ARCHIVE_BYTES) {
      return {
        ok: false,
        reason: `That document is ${String(Math.round(Number(stat.size) / 1024 / 1024))} MB and the reader takes up to ${String(MAX_ARCHIVE_BYTES / 1024 / 1024)} MB.`,
      }
    }
  } catch {
    return { ok: false, reason: 'The copy of that document is no longer on this device.' }
  }

  try {
    const parts = isArchive(kind) ? await unzipParts(path, kind) : await readWholeFile(path)
    const markdown = textFrom(kind, parts)
    if (markdown.trim() === '') {
      /*
       * Empty is reported, not returned. A document that extracts to nothing is
       * usually a scan — a PDF's pages photographed into a DOCX — and handing
       * the model an empty string makes it answer "your CV does not mention any
       * publications", which is a false statement about the person's own
       * record. Saying so lets the caller fall through to MarkItDown, which has
       * OCR and may do better.
       */
      return { ok: false, reason: 'Nothing could be read out of that document — it may be a scan.' }
    }
    return { ok: true, markdown }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

/** The parts `documents.ts` asked for, as text. Absent entries are simply left out. */
async function unzipParts(path: string, kind: ReturnType<typeof readableHere> & {}) {
  const base64 = await ReactNativeBlobUtil.fs.readFile(path, 'base64')
  const files = unzipSync(bytesFromBase64(base64))
  const parts = new Map<string, string>()
  for (const wanted of partsFor(kind)) {
    const entry = files[wanted]
    if (entry !== undefined) parts.set(wanted, strFromU8(entry))
  }
  return parts
}

/** The non-archive kinds, under the empty key `textFrom` reads them from. */
async function readWholeFile(path: string) {
  return new Map([['', await ReactNativeBlobUtil.fs.readFile(path, 'utf8')]])
}
