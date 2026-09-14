/**
 * Every operation that writes PDF bytes, in one place.
 *
 * `pdf-lib` is pure JavaScript with no DOM and no Node built-ins, so everything
 * in this file runs under vitest exactly as it runs in the browser. That is why
 * the write path is covered by real tests that build a document, operate on it
 * and read it back, rather than by mocks — see `document.test.ts`. The half
 * that genuinely needs a browser is drawing pixels, and that lives in
 * `render.ts`.
 *
 * Nothing here mutates its input. Every function takes bytes and returns new
 * bytes, because the source of those bytes is a file in someone's vault and an
 * in-place edit of a document that is also open in a viewer is how a person
 * loses the only copy of something.
 */
import { PDFDocument, PDFHexString, PDFName, PDFNumber, degrees } from 'pdf-lib'
import type { PDFPage, PDFRef } from 'pdf-lib'
import { boundsOf, noteRect } from './geometry'
import { hexToPdfRgb, colourById } from './annotations'
import type { Annotation } from './annotations'
import type { PagePlan } from './page-plan'

/**
 * Reads bytes into a document, or fails with something worth showing.
 *
 * `ignoreEncryption` because a great many PDFs a person is handed — anything
 * out of a government portal or a university HR system — carry an owner
 * password that permits reading and forbids editing. The bytes decode fine;
 * refusing them would make the tool useless for exactly the documents it is
 * for. It does not defeat a USER password: a document that needs one to open
 * still throws, and the message below is what a person sees.
 */
export async function readPdf(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    throw new Error(
      /password/i.test(detail)
        ? 'That PDF needs a password to open, so it cannot be edited here.'
        : `That file could not be read as a PDF. ${detail}`,
      { cause },
    )
  }
}

export async function pageCount(bytes: Uint8Array): Promise<number> {
  return (await readPdf(bytes)).getPageCount()
}

export type MergeSource = {
  readonly name: string
  readonly bytes: Uint8Array
  /** 0-based, in order, repeats allowed. Every page when absent. See `parsePageRange`. */
  readonly pages?: readonly number[]
}

/**
 * Several documents into one, taking the chosen pages of each in the order given.
 *
 * `copyPages` and not `addPage(page)`: a page belongs to the document that
 * holds its fonts and images, and adding one straight across produces a file
 * whose pages reference objects that are not in it — which opens blank in some
 * viewers and not at all in others. Copying pulls the whole dependency graph.
 *
 * One call per source, rather than one per page, because each call re-walks
 * that graph: a 40-page source copied page-by-page embeds its fonts 40 times.
 */
export async function mergePdfs(sources: readonly MergeSource[]): Promise<Uint8Array> {
  if (sources.length === 0) throw new Error('Choose at least one PDF to merge.')
  const merged = await PDFDocument.create()
  for (const source of sources) {
    const document = await readPdf(source.bytes)
    const total = document.getPageCount()
    const wanted = source.pages ?? document.getPageIndices()
    for (const index of wanted) {
      if (!Number.isInteger(index) || index < 0 || index >= total) {
        throw new Error(
          `${source.name} has ${total} page${total === 1 ? '' : 's'}, so page ${index + 1} is not in it.`,
        )
      }
    }
    if (wanted.length === 0) continue
    const copied = await merged.copyPages(document, [...wanted])
    for (const page of copied) merged.addPage(page)
  }
  if (merged.getPageCount() === 0) throw new Error('That selection has no pages in it.')
  return merged.save()
}

/**
 * Rewrites a document to match a plan: pages kept, reordered and turned.
 *
 * The plan's rotation is a DELTA on what the page already carries. A scan that
 * arrives sideways has `/Rotate 90` of its own, and treating the plan's value
 * as absolute would silently straighten it the moment any other page was
 * moved — an edit nobody asked for, to a page nobody touched.
 */
export async function applyPagePlan(bytes: Uint8Array, plan: PagePlan): Promise<Uint8Array> {
  if (plan.length === 0) throw new Error('A document must keep at least one page.')
  const source = await readPdf(bytes)
  const total = source.getPageCount()
  for (const page of plan) {
    if (page.source < 0 || page.source >= total) {
      throw new Error(
        `This document has ${total} pages; the plan asks for page ${page.source + 1}.`,
      )
    }
  }
  const output = await PDFDocument.create()
  const copied = await output.copyPages(
    source,
    plan.map((page) => page.source),
  )
  copied.forEach((page, at) => {
    const turn = plan[at]?.rotation ?? 0
    if (turn !== 0) page.setRotation(degrees((page.getRotation().angle + turn) % 360))
    output.addPage(page)
  })
  return output.save()
}

/** Author and time are injected so a test can pin what lands in the file. */
export type AnnotationStamp = {
  readonly author: string
  /** Written into `/M`. Taken from the caller, never from the wall clock here. */
  readonly at: Date
}

/**
 * Writes marks into a document as real PDF annotations.
 *
 * Real annotation dictionaries, not shapes drawn onto the page. A drawn
 * rectangle cannot be selected, moved, replied to or deleted in any reader, and
 * it covers the text instead of tinting it; a `/Highlight` is understood by
 * Preview, Acrobat, Chrome and Firefox alike, and survives being handed on.
 */
export async function writeAnnotations(
  bytes: Uint8Array,
  annotations: readonly Annotation[],
  stamp: AnnotationStamp,
): Promise<Uint8Array> {
  const document = await readPdf(bytes)
  const pages = document.getPages()
  const when = pdfDate(stamp.at)

  for (const annotation of annotations) {
    const page = pages[annotation.page]
    // A page the annotation no longer has — the organiser deleted it after the
    // mark was made. Dropping it is right; failing the whole save is not.
    if (!page) continue
    const dictionary =
      annotation.kind === 'highlight'
        ? highlightDict(document, annotation, stamp.author, when)
        : noteDict(document, annotation, stamp.author, when)
    appendAnnotation(page, document.context.register(dictionary))
  }
  return document.save()
}

function highlightDict(
  document: PDFDocument,
  annotation: Extract<Annotation, { kind: 'highlight' }>,
  author: string,
  when: string,
) {
  const quads = annotation.quads.flatMap((quad) => [...quad])
  return document.context.obj({
    Type: 'Annot',
    Subtype: 'Highlight',
    Rect: boundsOf(annotation.quads).map((n) => PDFNumber.of(n)),
    QuadPoints: quads.map((n) => PDFNumber.of(n)),
    C: hexToPdfRgb(colourById(annotation.colourId).hex).map((n) => PDFNumber.of(n)),
    // Without an alpha the tint is opaque and the words under it are gone.
    CA: PDFNumber.of(0.4),
    T: PDFHexString.fromText(author),
    Contents: PDFHexString.fromText(annotation.note),
    M: PDFHexString.fromText(when),
    // Bit 3, Print. An annotation without it is on screen and missing from
    // every printout and flattened copy, which is not what a highlight is for.
    F: PDFNumber.of(4),
  })
}

function noteDict(
  document: PDFDocument,
  annotation: Extract<Annotation, { kind: 'note' }>,
  author: string,
  when: string,
) {
  return document.context.obj({
    Type: 'Annot',
    Subtype: 'Text',
    Name: 'Comment',
    Rect: noteRect(annotation.at).map((n) => PDFNumber.of(n)),
    T: PDFHexString.fromText(author),
    Contents: PDFHexString.fromText(annotation.body),
    M: PDFHexString.fromText(when),
    F: PDFNumber.of(4),
    // Closed, so opening the document does not bury the page under speech
    // bubbles. Every reader offers a click to open one.
    Open: false,
  })
}

/**
 * Adds to the page's annotations instead of replacing them.
 *
 * A page usually already has some: every clickable link in a PDF is an
 * annotation, and so is every form field. Setting `/Annots` to a fresh array —
 * the obvious one-liner — deletes all of them, which turns a linked document
 * into a flat one as a side effect of adding a highlight.
 */
function appendAnnotation(page: PDFPage, ref: PDFRef): void {
  const existing = page.node.Annots()
  if (existing) existing.push(ref)
  else page.node.set(PDFName.of('Annots'), page.doc.context.obj([ref]))
}

/**
 * `D:20260913120000Z` — the date format PDF uses, which is its own.
 *
 * UTC, so the file does not carry the time zone of whoever edited it.
 */
export function pdfDate(at: Date): string {
  if (Number.isNaN(at.getTime())) return ''
  const pad = (n: number, width = 2) => String(n).padStart(width, '0')
  return (
    `D:${pad(at.getUTCFullYear(), 4)}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}` +
    `${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}Z`
  )
}
