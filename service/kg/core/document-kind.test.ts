/**
 * Working out which kind of document about the person this is.
 *
 * The kind only changes the guidance in the prompt, so getting it wrong is a
 * worse answer rather than a broken one. The tests that matter are the two
 * where the wrong answer is expensive: reading a statement as a list, which
 * returns three entries out of thirty, and reading a cover letter as anything
 * other than a cover letter, which files the employer's qualifications as the
 * person's.
 */

import { describe, expect, it } from 'vitest'
import { documentKindOf, DOCUMENT_LABEL, PROFILE_DOCUMENTS } from './document-kind'

describe('from the name', () => {
  it('recognises the four documents people actually name', () => {
    expect(documentKindOf('CV-2026-academic.pdf', '')).toBe('cv')
    expect(documentKindOf('Research-statement-v4.doc', '')).toBe('research-statement')
    expect(documentKindOf('Teaching-statement-v2.doc', '')).toBe('teaching-statement')
    expect(documentKindOf('Cover letter — Rice.pdf', '')).toBe('cover-letter')
  })

  it('reads the underscores and spaces people actually type', () => {
    expect(documentKindOf('research_statement.pdf', '')).toBe('research-statement')
    expect(documentKindOf('Teaching Philosophy.pdf', '')).toBe('teaching-statement')
    expect(documentKindOf('covering letter.docx', '')).toBe('cover-letter')
    expect(documentKindOf('curriculum vitae.pdf', '')).toBe('cv')
    expect(documentKindOf('résumé.pdf', '')).toBe('cv')
  })

  it('lets the statement win when a name says both', () => {
    /*
     * Order in the table, and it is not arbitrary. "Teaching statement — CV
     * appendix.pdf" contains both words and is a statement; read as a CV it
     * gets list guidance and returns almost nothing.
     */
    expect(documentKindOf('Teaching statement — CV appendix.pdf', '')).toBe('teaching-statement')
    expect(documentKindOf('Research statement (from CV pack).pdf', '')).toBe('research-statement')
  })

  it('does not guess which kind a bare “Statement.pdf” is', () => {
    // `other` still gets prose guidance. Claiming it is research would be a
    // guess, and the guidance for the wrong statement is worse than general
    // guidance for an unknown one.
    expect(documentKindOf('Statement.pdf', '')).toBe('other')
  })
})

describe('from the opening, when the name says nothing', () => {
  it('knows a letter by who it is addressed to', () => {
    /*
     * The distinction that matters most. A cover letter and a research
     * statement both open with "I", and only one of them is mostly about
     * somebody else.
     */
    expect(documentKindOf('doc1.pdf', 'Dear Professor Hall,\n\nI am writing to apply…')).toBe(
      'cover-letter',
    )
    expect(documentKindOf('doc1.pdf', 'To whom it may concern,\n\nI wish to apply…')).toBe(
      'cover-letter',
    )
  })

  it('knows a research statement from how it opens', () => {
    expect(documentKindOf('doc2.pdf', 'My research programme sits at the intersection of…')).toBe(
      'research-statement',
    )
  })

  it('knows a teaching statement from how it opens', () => {
    expect(documentKindOf('doc3.pdf', 'My teaching philosophy begins with the idea that…')).toBe(
      'teaching-statement',
    )
  })

  it('does not find a research statement inside a teaching one', () => {
    // Only the opening is scanned. Scanning the whole text finds "my research"
    // in almost every teaching statement an academic writes.
    // The research sentence is deliberately past the 2,000-character window:
    // an academic's teaching statement almost always mentions their research
    // somewhere, and "somewhere" must not decide what the document is.
    const teaching = [
      'My teaching philosophy begins in the laboratory.',
      ...Array.from({ length: 120 }, () => 'Students learn by doing, and by being asked why.'),
      'My research programme informs what I teach.',
    ].join('\n')
    expect(teaching.indexOf('My research programme')).toBeGreaterThan(2_000)
    expect(documentKindOf('doc4.pdf', teaching)).toBe('teaching-statement')
  })

  it('does not let a phrase deep in a long document decide what it is', () => {
    /*
     * What the window is still for once the earliest match wins. A document
     * that announces nothing in its first two thousand characters is a document
     * that does not announce itself — and thirty pages down, almost any long
     * academic document contains "in the classroom" somewhere. Without the
     * window that stray sentence turns a CV into a teaching statement.
     */
    const quiet = ['Jane Doe.', ...Array.from({ length: 120 }, () => 'A neutral sentence about nothing in particular.')].join(
      '\n',
    )
    const late = `${quiet}\nWork I have done in the classroom.`
    expect(late.indexOf('in the classroom')).toBeGreaterThan(2_000)
    expect(documentKindOf('doc6.pdf', late)).toBe('other')
  })

  it('falls back to other rather than guessing', () => {
    expect(documentKindOf('doc5.pdf', 'Some prose that announces nothing about itself.')).toBe(
      'other',
    )
  })
})

describe('the labels', () => {
  it('names every kind, because the prompt prints it', () => {
    for (const kind of PROFILE_DOCUMENTS) expect(DOCUMENT_LABEL[kind].length).toBeGreaterThan(0)
  })
})
