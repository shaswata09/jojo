/**
 * Q263: dropping a PDF on the PDF editor card loads it.
 *
 * Which dropped files count as PDFs, and in what order, is
 * `lib/pdf/dropped-files.test.ts`. The rest is wiring across four components and
 * a hook, none of which can be mounted here (D20), so it is read as source:
 * the whole card is the drop target, a drop becomes a numbered delivery, every
 * panel is handed it, and every panel takes its PDFs through `useDroppedPdfs`,
 * which sorts the drop and hands the PDFs on.
 */

import { describe, expect, it } from 'vitest'
import editorSource from './PdfEditor.tsx?raw'
import mergeSource from './PdfMergePanel.tsx?raw'
import pagesSource from './PdfPagesPanel.tsx?raw'
import annotateSource from './PdfAnnotatePanel.tsx?raw'
import droppedSource from './use-dropped-pdfs.ts?raw'

const strip = (source: string) =>
  source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')

const editor = strip(editorSource)

describe('a PDF dropped on the editor card (Q263)', () => {
  it('lands on the card itself', () => {
    const card = /<Panel\b[\s\S]*?>/.exec(editor)?.[0] ?? ''
    for (const handler of ['onDragEnter', 'onDragOver', 'onDragLeave', 'onDrop']) {
      expect(card).toContain(`${handler}={drop.${handler}}`)
    }
  })

  it('becomes a new delivery every time, so the same files dropped twice still arrive', () => {
    expect(editor).toMatch(/const drop = useFileDrop\(\(list\) => \{\s*deliveries\.current \+= 1\s*setDelivery\(\{ id: deliveries\.current, files: \[\.\.\.list\] \}\)/)
  })

  it('reaches whichever panel is showing', () => {
    expect(editor).toContain('<PdfMergePanel dropped={delivery} />')
    expect(editor).toContain('<PdfPagesPanel dropped={delivery} />')
    expect(editor).toContain('<PdfAnnotatePanel dropped={delivery} />')
  })

  it.each([
    ['merge', mergeSource],
    ['pages', pagesSource],
    ['annotate', annotateSource],
  ])('is opened by the %s panel', (_name, source) => {
    expect(strip(source)).toMatch(/useDroppedPdfs\(\s*dropped,/)
  })

  it('hands the sorted PDFs to the panel, once per delivery', () => {
    const hook = strip(droppedSource)
    expect(hook).toContain('if (!dropped || dropped.id === consumed.current) return')
    expect(hook).toContain('const sorted = sortDroppedPdfs(dropped.files, limit)')
    expect(hook).toContain('if (sorted.pdfs.length > 0) onPdfs(sorted.pdfs)')
  })
})
