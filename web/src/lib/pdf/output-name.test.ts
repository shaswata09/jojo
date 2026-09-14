import { describe, expect, it } from 'vitest'
import { derivedName, mergedName, safeName } from './output-name'

describe('naming a document derived from another', () => {
  it('puts the reason in brackets before the extension', () => {
    expect(derivedName('cv.pdf', 'annotated')).toBe('cv (annotated).pdf')
    expect(derivedName('Research statement.pdf', 'pages 1-3')).toBe(
      'Research statement (pages 1-3).pdf',
    )
  })

  it('counts instead of repeating the suffix forever', () => {
    // Marking up, saving, and marking up again is the normal way to use this,
    // and the obvious implementation gives `cv (annotated) (annotated).pdf`.
    const once = derivedName('cv.pdf', 'annotated')
    const twice = derivedName(once, 'annotated')
    const thrice = derivedName(twice, 'annotated')
    expect(twice).toBe('cv (annotated) 2.pdf')
    expect(thrice).toBe('cv (annotated) 3.pdf')
  })

  it('does not mistake a different bracket for its own', () => {
    expect(derivedName('cv (final).pdf', 'annotated')).toBe('cv (final) (annotated).pdf')
  })

  it('adds the extension to a name that has none', () => {
    expect(derivedName('cv', 'annotated')).toBe('cv (annotated).pdf')
  })

  it('survives a suffix carrying regex punctuation', () => {
    expect(derivedName('cv.pdf', 'pages 1-3 (a)')).toBe('cv (pages 1-3 (a)).pdf')
  })
})

describe('naming a merge', () => {
  it('names what went into it', () => {
    expect(mergedName(['cv.pdf', 'letter.pdf'])).toBe('cv + letter.pdf')
  })

  it('counts the rest once the name would outgrow its column', () => {
    expect(mergedName(['a.pdf', 'b.pdf', 'c.pdf'])).toBe('a + b + c.pdf')
    expect(mergedName(['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf'])).toBe('a + b + 2 more.pdf')
    expect(mergedName(['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf', 'e.pdf'])).toBe('a + b + 3 more.pdf')
  })

  it('falls back rather than producing a nameless file', () => {
    expect(mergedName([])).toBe('merged.pdf')
    expect(mergedName(['   ', ''])).toBe('merged.pdf')
    expect(mergedName(['only.pdf'])).toBe('only.pdf')
  })
})

describe('making a name safe to write', () => {
  it('folds what no filesystem accepts', () => {
    expect(safeName('a/b\\c:d*e?f"g<h>i|j.pdf')).toBe('a b c d e f g h i j.pdf')
  })

  it('strips control characters rather than writing them into a vault row', () => {
    const bell = String.fromCharCode(7)
    expect(safeName(`cv${bell}.pdf`)).toBe('cv.pdf')
  })

  it('refuses to end in a dot or a space, which Windows will not take', () => {
    expect(safeName('report. .pdf')).toBe('report.pdf')
  })

  it('always lands on a .pdf extension, replacing a wrong one', () => {
    // The output of this tool is a PDF whatever was typed, and
    // `notes.txt.pdf` would be a name nobody asked for.
    expect(safeName('notes.txt')).toBe('notes.pdf')
    expect(safeName('notes.PDF')).toBe('notes.PDF')
    expect(safeName('notes')).toBe('notes.pdf')
  })

  it('does not mistake a dot inside a name for an extension', () => {
    // Splitting at the last dot loses the rest of the name: this one would
    // come out as `v1.pdf`, which is a different document.
    expect(safeName('v1.2 report')).toBe('v1.2 report.pdf')
    expect(derivedName('v1.2 report', 'annotated')).toBe('v1.2 report (annotated).pdf')
    expect(mergedName(['v1.2 report', 'cv.pdf'])).toBe('v1.2 report + cv.pdf')
  })

  it('never returns an empty name', () => {
    expect(safeName('')).toBe('document.pdf')
    expect(safeName('///')).toBe('document.pdf')
  })

  it('caps a name that would not fit anywhere', () => {
    const long = safeName(`${'word '.repeat(80)}.pdf`)
    expect(long.length).toBeLessThanOrEqual(124)
    expect(long.endsWith('.pdf')).toBe(true)
  })
})
