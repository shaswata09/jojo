import { describe, expect, it } from 'vitest'
import { isArchive, partsFor, readableHere, textFrom } from './documents'

/**
 * The XML in these fixtures is copied from what Word, LibreOffice and PowerPoint
 * actually emit, attributes and all — not from a tidied idea of it. That matters
 * more than usual here, because the extractors are regular expressions: an
 * idealised `<w:t>hello</w:t>` would pass against a reader that breaks on the
 * `xml:space="preserve"` every real document carries.
 */

const one = (text: string) => new Map([['', text]])

describe('deciding what can be read on the device', () => {
  it('claims the formats it can actually do', () => {
    expect(readableHere('CV-2026.docx')).toBe('ooxml-word')
    expect(readableHere('Teaching-statement.odt')).toBe('odf')
    expect(readableHere('job-talk.pptx')).toBe('ooxml-slides')
    expect(readableHere('notes.md')).toBe('text')
    expect(readableHere('posting.html')).toBe('html')
    expect(readableHere('letter.rtf')).toBe('rtf')
  })

  /*
   * The gap, asserted rather than left implicit. PDF is the format a CV most
   * often arrives in and the one this module cannot do — glyph codes need font
   * and encoding tables to become characters. Returning null sends it to
   * MarkItDown, which is where every file went before this existed; returning a
   * kind would produce confident nonsense.
   */
  it('sends a PDF and a legacy .doc to MarkItDown instead', () => {
    expect(readableHere('CV-2026.pdf')).toBeNull()
    expect(readableHere('old-cv.doc')).toBeNull()
    expect(readableHere('deck.ppt')).toBeNull()
    expect(readableHere('scan.png')).toBeNull()
  })

  it('is not fooled by case or by a dot in the name', () => {
    expect(readableHere('CV.DOCX')).toBe('ooxml-word')
    expect(readableHere('my.cv.final.docx')).toBe('ooxml-word')
    expect(readableHere('noextension')).toBeNull()
  })

  it('says which kinds arrive as a zip, and what to pull out of one', () => {
    expect(isArchive('ooxml-word')).toBe(true)
    expect(isArchive('text')).toBe(false)
    expect(partsFor('ooxml-word')).toEqual(['word/document.xml'])
    expect(partsFor('odf')).toEqual(['content.xml'])
    expect(partsFor('ooxml-slides')[0]).toBe('ppt/slides/slide1.xml')
  })
})

describe('a Word document', () => {
  const doc = (body: string) =>
    new Map([
      [
        'word/document.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
      ],
    ])

  it('reads text out of the runs Word actually writes', () => {
    const out = textFrom(
      'ooxml-word',
      doc(
        '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Shaswata </w:t></w:r><w:r><w:t>Mitra</w:t></w:r></w:p>',
      ),
    )
    // Two runs, one word: bold splits a run mid-sentence and a reader that took
    // the first would lose the surname.
    expect(out).toBe('Shaswata Mitra')
  })

  it('keeps headings as headings', () => {
    /*
     * The one piece of structure worth carrying. "Publications" as a heading
     * tells the model a section starts; as a bare line it is a sentence, and
     * the papers under it stop being attributable to it.
     */
    const out = textFrom(
      'ooxml-word',
      doc(
        '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Publications</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t>A paper about rice.</w:t></w:r></w:p>',
      ),
    )
    expect(out).toBe('# Publications\nA paper about rice.')
  })

  it('marks list items, so a run of bullets is not one paragraph', () => {
    const out = textFrom(
      'ooxml-word',
      doc(
        '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>Taught CS 101</w:t></w:r></w:p>' +
          '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>Taught CS 102</w:t></w:r></w:p>',
      ),
    )
    expect(out).toBe('- Taught CS 101\n- Taught CS 102')
  })

  it('keeps the tab that separates a role from its dates', () => {
    // Nearly every CV lays a line out this way, and dropping the tab runs the
    // employer into the year: "Rice University2021".
    const out = textFrom(
      'ooxml-word',
      doc('<w:p><w:r><w:t>Rice University</w:t></w:r><w:r><w:tab/><w:t>2021</w:t></w:r></w:p>'),
    )
    expect(out).toBe('Rice University\t2021')
  })

  it('decodes entities rather than handing the model raw XML', () => {
    const out = textFrom(
      'ooxml-word',
      doc('<w:p><w:r><w:t>R&amp;D at AT&amp;T &#8212; 2019</w:t></w:r></w:p>'),
    )
    expect(out).toBe('R&D at AT&T — 2019')
  })

  it('does not double-decode an escaped entity', () => {
    // `&amp;lt;` is a literal "&lt;" in the document. Decoding `&amp;` first
    // and then sweeping again would turn it into "<".
    const out = textFrom('ooxml-word', doc('<w:p><w:r><w:t>&amp;lt;script&amp;gt;</w:t></w:r></w:p>'))
    expect(out).toBe('&lt;script&gt;')
  })

  it('returns nothing rather than throwing on a part that is missing or broken', () => {
    expect(textFrom('ooxml-word', new Map())).toBe('')
    expect(textFrom('ooxml-word', doc('<w:p><w:r><w:t>unclosed'))).toBe('')
  })
})

describe('a presentation', () => {
  it('reads every slide it was given, in order, and titles them', () => {
    const slide = (t: string) =>
      `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    const out = textFrom(
      'ooxml-slides',
      new Map([
        ['ppt/slides/slide1.xml', slide('Rice, 2026')],
        ['ppt/slides/slide2.xml', slide('Results')],
      ]),
    )
    expect(out).toContain('## slide1')
    expect(out).toContain('Rice, 2026')
    expect(out).toContain('Results')
  })

  it('skips the slides a deck does not have', () => {
    // `partsFor` asks for forty; a six-slide deck returns six. The absent ones
    // must not become empty headings.
    const out = textFrom('ooxml-slides', new Map([['ppt/slides/slide1.xml', '<p:sld/>']]))
    expect(out).toBe('')
  })
})

describe('an OpenDocument file', () => {
  const odf = (body: string) =>
    new Map([
      [
        'content.xml',
        `<office:document-content xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text>${body}</office:text></office:body></office:document-content>`,
      ],
    ])

  it('reads LibreOffice the same way it reads Word', () => {
    const out = textFrom(
      'odf',
      odf(
        '<text:h text:outline-level="1">Publications</text:h>' +
          '<text:p>A paper about<text:s/>rice.</text:p>',
      ),
    )
    // The same document exported from either program should reach the model as
    // the same text — `<text:s/>` is a space, not a tag to drop.
    expect(out).toBe('# Publications\nA paper about rice.')
  })
})

describe('a saved web page', () => {
  it('drops script and style bodies, not just their tags', () => {
    /*
     * The failure that makes a naive tag-stripper useless: remove `<script>`
     * and leave its contents, and the model reads a wall of minified
     * JavaScript as though it were the posting.
     */
    const out = textFrom(
      'html',
      one(
        '<html><head><style>.a{color:red}</style><script>var x=1;alert("hi")</script></head>' +
          '<body><h1>Assistant Professor</h1><p>Apply by June.</p></body></html>',
      ),
    )
    expect(out).not.toContain('alert')
    expect(out).not.toContain('color:red')
    expect(out).toContain('# Assistant Professor')
    expect(out).toContain('Apply by June.')
  })

  it('turns list items into a list', () => {
    const out = textFrom('html', one('<ul><li>PhD required</li><li>Three letters</li></ul>'))
    expect(out).toContain('- PhD required')
    expect(out).toContain('- Three letters')
  })
})

describe('an RTF file', () => {
  it('reads paragraphs and skips the tables a reader may ignore', () => {
    /*
     * `\*\` marks an extension destination the spec explicitly permits a reader
     * to skip — which is where font tables, colour tables and revision history
     * live. Not skipping them puts "Times New Roman" in the middle of the CV.
     */
    const out = textFrom(
      'rtf',
      one(
        '{\\rtf1\\ansi{\\fonttbl{\\f0 Times New Roman;}}{\\*\\generator Riched20 10.0}' +
          '\\f0\\fs24 Shaswata Mitra\\par Rice University\\par}',
      ),
    )
    expect(out).toContain('Shaswata Mitra')
    expect(out).toContain('Rice University')
    expect(out).not.toContain('Riched20')
  })

  it('reads an accented name once rather than twice', () => {
    // `\u233?` is "é" plus an ASCII stand-in for readers that cannot do
    // Unicode. Keeping both writes "é?" into somebody's name.
    expect(textFrom('rtf', one('{\\rtf1 Ren\\u233?e Descartes\\par}'))).toBe('Renée Descartes')
  })

  it('reads a codepage byte', () => {
    expect(textFrom('rtf', one("{\\rtf1 caf\\'e9\\par}"))).toBe('café')
  })
})

describe('plain text', () => {
  it('passes through, tidied', () => {
    expect(textFrom('text', one('  Hello\n\n\n\nWorld  '))).toBe('Hello\n\nWorld')
  })
})
