import { describe, expect, it } from 'vitest'

/**
 * The accessibility of the offers table, asserted on its source.
 *
 * D20 bans mounting, so this reads the file. That is a fair trade here because
 * every one of these is a static property of the markup rather than a
 * behaviour, and because all four regressed silently: a `<td>` where a `<th>`
 * belongs renders identically, and a colour with no text beside it looks
 * finished to whoever wrote it.
 *
 * Measured before the fix: of the six data tables in the app —
 * ApplicationsTable, ApplicationFrequency, AnswerTable, CodeStructure,
 * Statistics and this one — this was the only one whose rows had no row header,
 * and the only file among them containing no `sr-only` text at all.
 */
const sources = import.meta.glob('/src/components/dashboard/OfferComparison.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const source = sources['/src/components/dashboard/OfferComparison.tsx'] ?? ''

describe('the offers table', () => {
  it('was found', () => {
    expect(source).toContain('export function OfferComparison')
  })

  /**
   * The job is the row's subject. Without `scope="row"` the money column is
   * announced as a bare list of numbers — "A year, 180,000" — on the one screen
   * in the product where the question is *whose* 180,000.
   */
  it('names each row by the job it is about', () => {
    expect(source).toMatch(/<th\s+scope="row"/)
    // And the job cell specifically, not some other cell that happens to have
    // acquired the attribute.
    const jobCell = /<th\s+scope="row"[\s\S]*?<\/th>/.exec(source)?.[0] ?? ''
    expect(jobCell).toContain('displayName(application)')
  })

  /** A table arrived at from a list of tables has no heading beside it. */
  it('says what it is a table of', () => {
    expect(source).toMatch(/<caption className="sr-only">/)
  })

  /**
   * `text-success` was the only signal marking the larger package. Colour alone
   * is not a signal for a screen reader at all, and is a weak one for the
   * readers who cannot separate this green from the default text colour.
   */
  it('says which package is the highest, rather than only colouring it', () => {
    // Asserted on the announcement itself, not on the region around it.
    //
    // The first version of this matched from `best !== undefined && yearly ===
    // best ?` to the next `) : null}` and looked for `sr-only` in between. That
    // anchors on the CLASSNAME ternary — the colour — and the lazy match then
    // runs to whichever `) : null}` comes first. Measured: with the
    // announcement deleted the match simply extended to the annualised block,
    // which carries an `sr-only` of its own, and all six tests still passed.
    // The assertion could not fail for the reason it was written.
    expect(source).toMatch(/<span className="sr-only">[^<]*highest[^<]*<\/span>/)

    // And it is the highest package that triggers it, not something else: the
    // condition appears twice, once to colour and once to say so out loud.
    const singledOut = source.match(/best !== undefined && yearly === best/g) ?? []
    expect(singledOut.length).toBeGreaterThanOrEqual(2)
  })

  /**
   * The em dash means "nothing could be read from this". `title` carries that
   * for a mouse and for nothing else — not a keyboard, not assistive tech — so
   * the sentence has to exist in the accessibility tree too.
   */
  it('explains the empty figure to more than a mouse', () => {
    expect(source).toMatch(/<span aria-hidden>—<\/span>/)
    expect(source).toMatch(/<span className="sr-only">No amount could be read/)
  })

  /** The footnote marker is punctuation; the word behind it is the content. */
  it('spells out the annualised marker', () => {
    expect(source).toMatch(/sr-only">\s*\(annualised\)/)
  })
})
