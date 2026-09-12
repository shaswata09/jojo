import type { ConvertResult } from '@jojo/service/agent/markitdown'
import { isArchive, readableHere, textFrom } from '@jojo/service/agent/documents'

/**
 * Text from a stored document, read in this tab, or null if it is not one we
 * read here.
 *
 * The browser's half of the phone's `on-device-reader.ts`, and it did not
 * exist: every document went to MarkItDown, and the first thing that broke was
 * the case the whole fit feature is built on. A page the extension saves has
 * its assets inlined — that is what makes it a keepable copy — so it is a large
 * file, and `markitdown-mcp` refused it with 413 Payload Too Large. A saved
 * posting is HTML, which this app already knows how to read; sending it across
 * the room to be told it is too big was the wrong trip.
 *
 * NULL IS NOT A FAILURE, exactly as on the phone: null means "not mine, use the
 * reader", `{ ok: false }` means it was mine and there was nothing in it — and
 * that ALSO falls through, because a document that extracts to nothing is
 * usually a scan and MarkItDown has OCR.
 *
 * Only the kinds that are text already: a saved page, `.txt`, `.md`. The
 * archive kinds — DOCX, ODT, a deck — need a ZIP opened first, which the phone
 * does with `fflate`; that dependency is not declared for the web yet, and a
 * CV in DOCX went through the reader before this file existed and still does.
 */
export async function readHere(file: File): Promise<ConvertResult | null> {
  const kind = readableHere(file.name)
  if (kind === null || isArchive(kind)) return null
  let text: string
  try {
    text = await file.text()
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
  const markdown = textFrom(kind, new Map([['', text]]))
  if (markdown.trim() === '') {
    return { ok: false, reason: 'Nothing could be read out of that document — it may be a scan.' }
  }
  return { ok: true, markdown }
}
