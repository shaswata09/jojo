/**
 * The write path, against real PDFs.
 *
 * `pdf-lib` has no DOM and no Node built-ins, so every one of these builds a
 * document, operates on it and reads the bytes back — the same code path the
 * browser runs, with nothing mocked. A mock here would only assert that the
 * calls were made in the order this file makes them, which is the one thing
 * that was never in doubt.
 *
 * Page ORDER is checked by giving each source a distinct page size rather than
 * by reading text: the sizes come back off the page tree, so the assertion does
 * not depend on a text extractor agreeing with us about what is on the page.
 */
import { describe, expect, it } from 'vitest'
import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  degrees,
} from 'pdf-lib'
import { applyPagePlan, mergePdfs, pageCount, pdfDate, readPdf, writeAnnotations } from './document'
import { movePage, planFor, removePage, rotatePage } from './page-plan'
import type { Annotation } from './annotations'

/** A document whose pages are `sizes` wide, so order is visible afterwards. */
async function build(sizes: readonly number[]): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  for (const width of sizes) document.addPage([width, 500])
  return document.save()
}

const widths = async (bytes: Uint8Array) =>
  (await readPdf(bytes)).getPages().map((page) => Math.round(page.getWidth()))

const rotations = async (bytes: Uint8Array) =>
  (await readPdf(bytes)).getPages().map((page) => page.getRotation().angle)

/**
 * The annotation dictionaries on a page, resolved through their indirect refs.
 *
 * `PDFDict` rather than a typed read for each key: these assertions are
 * deliberately at the level of the bytes, because the whole point of them is
 * that what reaches the file is what another reader will find there.
 */
const annotsOn = async (bytes: Uint8Array, page = 0): Promise<PDFDict[]> => {
  const document = await readPdf(bytes)
  const array = document.getPage(page).node.Annots()
  if (!array) return []
  return array.asArray().map((_, at) => array.lookup(at, PDFDict))
}

const subtypes = async (bytes: Uint8Array, page = 0) =>
  (await annotsOn(bytes, page)).map((dict) => String(dict.get(PDFName.of('Subtype'))))

/** One key of one annotation, as plain numbers. */
const numbers = (dict: PDFDict, key: string) =>
  dict
    .lookup(PDFName.of(key), PDFArray)
    .asArray()
    .map((value) => (value as PDFNumber).asNumber())

const STAMP = { author: 'jojo', at: new Date('2026-09-13T12:00:00Z') }

const highlight = (page: number, note = ''): Annotation => ({
  id: 'h1',
  kind: 'highlight',
  page,
  quads: [[10, 100, 90, 100, 10, 80, 90, 80]],
  colourId: 'yellow',
  text: 'marked words',
  note,
})

describe('merging', () => {
  it('puts every page of every source in, in order', async () => {
    const merged = await mergePdfs([
      { name: 'a.pdf', bytes: await build([100, 110]) },
      { name: 'b.pdf', bytes: await build([200, 210, 220]) },
    ])
    expect(await pageCount(merged)).toBe(5)
    expect(await widths(merged)).toEqual([100, 110, 200, 210, 220])
  })

  it('takes only the pages asked for, in the order asked for', async () => {
    const merged = await mergePdfs([
      { name: 'a.pdf', bytes: await build([100, 110, 120]), pages: [2, 0] },
      { name: 'b.pdf', bytes: await build([200, 210]), pages: [1] },
    ])
    expect(await widths(merged)).toEqual([120, 100, 210])
  })

  it('repeats a page that was asked for twice', async () => {
    const merged = await mergePdfs([
      { name: 'a.pdf', bytes: await build([100, 110]), pages: [0, 0, 1] },
    ])
    expect(await widths(merged)).toEqual([100, 100, 110])
  })

  it('names the file and its real length when a page is out of range', async () => {
    await expect(
      mergePdfs([{ name: 'cv.pdf', bytes: await build([100, 110]), pages: [5] }]),
    ).rejects.toThrow('cv.pdf has 2 pages, so page 6 is not in it.')
  })

  it('refuses to make a document out of nothing', async () => {
    await expect(mergePdfs([])).rejects.toThrow('Choose at least one PDF to merge.')
    await expect(
      mergePdfs([{ name: 'a.pdf', bytes: await build([100]), pages: [] }]),
    ).rejects.toThrow('That selection has no pages in it.')
  })

  it('carries a source’s own page rotation across', async () => {
    const source = await PDFDocument.create()
    source.addPage([100, 500]).setRotation(degrees(90))
    const merged = await mergePdfs([{ name: 'a.pdf', bytes: await source.save() }])
    expect(await rotations(merged)).toEqual([90])
  })

  it('keeps a source’s annotations', async () => {
    const marked = await writeAnnotations(await build([100]), [highlight(0)], STAMP)
    const merged = await mergePdfs([{ name: 'a.pdf', bytes: marked }])
    expect(await subtypes(merged)).toEqual(['/Highlight'])
  })
})

describe('applying a page plan', () => {
  it('leaves an untouched plan as it found it', async () => {
    const out = await applyPagePlan(await build([100, 110, 120]), planFor(3))
    expect(await widths(out)).toEqual([100, 110, 120])
  })

  it('drops a deleted page and keeps the others pointing at their own', async () => {
    const out = await applyPagePlan(await build([100, 110, 120]), removePage(planFor(3), 1))
    expect(await widths(out)).toEqual([100, 120])
  })

  it('reorders', async () => {
    const out = await applyPagePlan(await build([100, 110, 120]), movePage(planFor(3), 2, 0))
    expect(await widths(out)).toEqual([120, 100, 110])
  })

  it('turns the page it was told to and no other', async () => {
    const out = await applyPagePlan(await build([100, 110]), rotatePage(planFor(2), 1, 90))
    expect(await rotations(out)).toEqual([0, 90])
  })

  it('adds to a rotation the page already had, rather than replacing it', async () => {
    /*
     * A scan that arrives sideways carries /Rotate 90 of its own. Treating the
     * plan's value as absolute would straighten it the moment any other page
     * moved — an edit to a page nobody touched.
     */
    const source = await PDFDocument.create()
    source.addPage([100, 500]).setRotation(degrees(90))
    const bytes = await source.save()
    expect(await rotations(await applyPagePlan(bytes, planFor(1)))).toEqual([90])
    expect(await rotations(await applyPagePlan(bytes, rotatePage(planFor(1), 0, 90)))).toEqual([
      180,
    ])
  })

  it('wraps past a full turn instead of writing 450', async () => {
    const source = await PDFDocument.create()
    source.addPage([100, 500]).setRotation(degrees(270))
    const out = await applyPagePlan(await source.save(), rotatePage(planFor(1), 0, 180))
    expect(await rotations(out)).toEqual([90])
  })

  it('refuses to empty a document', async () => {
    await expect(applyPagePlan(await build([100]), [])).rejects.toThrow(
      'A document must keep at least one page.',
    )
  })

  it('refuses a plan naming a page the document does not have', async () => {
    await expect(applyPagePlan(await build([100]), [{ source: 4, rotation: 0 }])).rejects.toThrow(
      'This document has 1 pages; the plan asks for page 5.',
    )
  })
})

describe('writing annotations', () => {
  it('writes a highlight a reader will understand', async () => {
    const out = await writeAnnotations(await build([200]), [highlight(0, 'why')], STAMP)
    expect(await subtypes(out)).toEqual(['/Highlight'])
  })

  it('writes the quad points through unchanged', async () => {
    const out = await writeAnnotations(await build([200]), [highlight(0)], STAMP)
    const [dict] = await annotsOn(out)
    expect(dict && numbers(dict, 'QuadPoints')).toEqual([10, 100, 90, 100, 10, 80, 90, 80])
  })

  it('gives the highlight a /Rect that encloses its quads', async () => {
    // A viewer may clip an annotation to its /Rect, so one that is merely near
    // the quads loses whichever line falls outside it.
    const out = await writeAnnotations(await build([200]), [highlight(0)], STAMP)
    const [dict] = await annotsOn(out)
    expect(dict && numbers(dict, 'Rect')).toEqual([10, 80, 90, 100])
  })

  it('writes a colour in PDF components, never bytes', async () => {
    const out = await writeAnnotations(await build([200]), [highlight(0)], STAMP)
    const [dict] = await annotsOn(out)
    for (const component of dict ? numbers(dict, 'C') : []) {
      expect(component).toBeGreaterThanOrEqual(0)
      expect(component).toBeLessThanOrEqual(1)
    }
  })

  it('writes a comment as a Text annotation, closed', async () => {
    const note: Annotation = {
      id: 'n1',
      kind: 'note',
      page: 0,
      at: { x: 50, y: 400 },
      body: 'look',
    }
    const out = await writeAnnotations(await build([200]), [note], STAMP)
    expect(await subtypes(out)).toEqual(['/Text'])
    const [dict] = await annotsOn(out)
    // Open would bury the page under speech bubbles the moment it is opened.
    expect(dict?.lookup(PDFName.of('Open'), PDFBool).asBoolean()).toBe(false)
  })

  it('marks both kinds printable, and tints rather than covers', async () => {
    /*
     * Without /F 4 an annotation is on screen and missing from every printout
     * and flattened copy; without /CA the highlight is opaque and the words
     * underneath it are gone. Neither failure looks like a bug in the editor.
     */
    const sticky: Annotation = {
      id: 'n1',
      kind: 'note',
      page: 0,
      at: { x: 50, y: 400 },
      body: 'x',
    }
    const out = await writeAnnotations(await build([200]), [highlight(0), sticky], STAMP)
    const [mark, bubble] = await annotsOn(out)
    expect(mark?.lookup(PDFName.of('F'), PDFNumber).asNumber()).toBe(4)
    expect(bubble?.lookup(PDFName.of('F'), PDFNumber).asNumber()).toBe(4)
    const alpha = mark?.lookup(PDFName.of('CA'), PDFNumber).asNumber() ?? 1
    expect(alpha).toBeGreaterThan(0)
    expect(alpha).toBeLessThan(1)
  })

  it('stamps the author and the time it was told, not the wall clock', async () => {
    const out = await writeAnnotations(await build([200]), [highlight(0)], STAMP)
    const [dict] = await annotsOn(out)
    expect(dict?.lookup(PDFName.of('T'), PDFHexString).decodeText()).toBe('jojo')
    expect(dict?.lookup(PDFName.of('M'), PDFHexString).decodeText()).toBe('D:20260913120000Z')
  })

  it('puts each annotation on its own page', async () => {
    const out = await writeAnnotations(
      await build([200, 200, 200]),
      [highlight(0), { ...highlight(2), id: 'h2' }],
      STAMP,
    )
    expect(await subtypes(out, 0)).toEqual(['/Highlight'])
    expect(await subtypes(out, 1)).toEqual([])
    expect(await subtypes(out, 2)).toEqual(['/Highlight'])
  })

  it('adds to the annotations a page already had instead of replacing them', async () => {
    /*
     * Every clickable link in a PDF is an annotation. Setting /Annots to a
     * fresh array — the obvious one-liner — turns a linked document into a flat
     * one as a side effect of adding a highlight.
     */
    const first = await writeAnnotations(await build([200]), [highlight(0)], STAMP)
    const second = await writeAnnotations(first, [{ ...highlight(0), id: 'h2' }], STAMP)
    expect(await subtypes(second)).toEqual(['/Highlight', '/Highlight'])
  })

  it('skips a mark whose page has since been deleted, rather than failing the save', async () => {
    const out = await writeAnnotations(await build([200]), [highlight(0), highlight(7)], STAMP)
    expect(await subtypes(out)).toEqual(['/Highlight'])
  })

  it('writes nothing and still returns a readable document', async () => {
    const out = await writeAnnotations(await build([200]), [], STAMP)
    expect(await pageCount(out)).toBe(1)
    expect(await subtypes(out)).toEqual([])
  })

  it('survives a comment that is not ASCII', async () => {
    const note: Annotation = {
      id: 'n1',
      kind: 'note',
      page: 0,
      at: { x: 10, y: 10 },
      body: 'Ingénieur — 日本語 ✓',
    }
    const out = await writeAnnotations(await build([200]), [note], STAMP)
    const [dict] = await annotsOn(out)
    const contents = dict?.lookup(PDFName.of('Contents'), PDFHexString)
    expect(contents?.decodeText()).toBe('Ingénieur — 日本語 ✓')
  })
})

describe('reading a file that is not a PDF', () => {
  it('fails with something worth showing a person', async () => {
    const junk = new Uint8Array([1, 2, 3, 4, 5])
    await expect(readPdf(junk)).rejects.toThrow(/could not be read as a PDF/)
  })
})

describe('the date a PDF writes', () => {
  it('is the format PDF uses, in UTC', () => {
    expect(pdfDate(new Date('2026-09-13T12:34:56Z'))).toBe('D:20260913123456Z')
  })

  it('pads every field', () => {
    expect(pdfDate(new Date('2026-01-02T03:04:05Z'))).toBe('D:20260102030405Z')
  })

  it('is empty for a date that is not one, rather than "D:NaNNaN"', () => {
    expect(pdfDate(new Date('nonsense'))).toBe('')
  })
})
