/**
 * The four marks, and the characters that must NOT be read as one.
 *
 * The body of a tailored snippet is somebody's own CV prose with a model's
 * changes marked in it, so every assertion here is about a character that
 * appears in real documents — an underscore in an email address, an asterisk
 * on a footnote — surviving, while the four spellings the prompt asks for are
 * read. Under D20 no renderer is mounted; this is the parser both platforms
 * draw from.
 */

import { describe, expect, it } from 'vitest'
import { hasMarks, parseInline, parseMarks, stripMarks, MARK_LEGEND } from './marks'

const flat = (line: string) =>
  parseInline(line).map(
    (r) => `${r.bold ? 'B' : ''}${r.italic ? 'I' : ''}${r.underline ? 'U' : ''}[${r.text}]`,
  )

describe('the four marks', () => {
  it('reads bold', () => {
    expect(flat('led **distributed systems** work')).toEqual([
      '[led ]',
      'B[distributed systems]',
      '[ work]',
    ])
  })

  it('reads italic in either single spelling', () => {
    expect(flat('a _softer_ line')).toEqual(['[a ]', 'I[softer]', '[ line]'])
    expect(flat('a *softer* line')).toEqual(['[a ]', 'I[softer]', '[ line]'])
  })

  it('reads underline', () => {
    expect(flat('__Publications__ first')).toEqual(['U[Publications]', '[ first]'])
  })

  it('reads headings at three sizes, and no deeper', () => {
    const blocks = parseMarks('# One\n## Two\n### Three\n#### Four')
    expect(blocks.map((b) => (b.kind === 'heading' ? b.level : b.kind))).toEqual([1, 2, 3, 'line'])
  })

  it('nests marks', () => {
    expect(flat('**bold and _both_**')).toEqual(['B[bold and ]', 'BI[both]'])
  })
})

describe('what is text, not a mark', () => {
  it('leaves an underscore inside a word alone', () => {
    // snake_case, and every email address ever pasted from a CV.
    expect(flat('priya_r@example.edu')).toEqual(['[priya_r@example.edu]'])
    expect(flat('use snake_case_names here')).toEqual(['[use snake_case_names here]'])
  })

  it('leaves an asterisk inside a word alone', () => {
    expect(flat('CS*101 and 2*3')).toEqual(['[CS*101 and 2*3]'])
  })

  it('leaves a Markdown bullet and a footnote star alone', () => {
    /*
     * The two asterisks a real document has that are not marks. A bullet's
     * star is followed by a space, so it cannot open emphasis; a footnote star
     * after a word is not followed by anything it could flank. Before this
     * rule, `* item` opened an italic run to the end of the line, and Copy
     * — which strips marks — took the bullet with it.
     */
    expect(flat('* Consistent reads at the edge')).toEqual(['[* Consistent reads at the edge]'])
    expect(flat('Published in Nature* and Science')).toEqual(['[Published in Nature* and Science]'])
    expect(stripMarks('* one\n* two')).toBe('* one\n* two')
  })

  it('does not close a run on a mark that follows a space, and so does not open one', () => {
    /*
     * `a _b _c d`: the second underscore has a space before it, so it is not a
     * closing mark. That much has always been true. What follows from it
     * changed when an opener began to require a closer: with no closer anywhere
     * on the line, the FIRST underscore does not open either, and the whole
     * line is text.
     *
     * That is the better answer, and by this test's own measure. Its complaint
     * was that the wrong reading "swallows a character on Copy" — and the
     * reading it used to assert did exactly that to the first underscore,
     * copying `a b _c d` out of a line the person wrote with two. Now nothing
     * is dropped.
     */
    expect(flat('a _b _c d')).toEqual(['[a _b _c d]'])
    expect(stripMarks('a _b _c d')).toBe('a _b _c d')
    // And a line that really does close still reads as emphasis.
    expect(flat('a _b c_ d')).toEqual(['[a ]', 'I[b c]', '[ d]'])
  })

  it('does not read a hash without a space as a heading', () => {
    // A course code, an issue number, a colour.
    expect(parseMarks('#12 on the list')[0]?.kind).toBe('line')
    expect(parseMarks('#fff')[0]?.kind).toBe('line')
  })

  it('closes an unfinished mark at the end of the line, not the document', () => {
    /*
     * A model that forgets a closing `**` should cost one line of bold. The
     * old behaviour of a naive toggle would carry the state across every line
     * after it — half a CV in bold because of one typo.
     */
    const blocks = parseMarks('**forgot to close\nplain line')
    const second = blocks[1]
    expect(second?.kind === 'line' && second.runs.every((r) => !r.bold)).toBe(true)
  })

  it('keeps a blank line as a blank', () => {
    expect(parseMarks('a\n\nb').map((b) => b.kind)).toEqual(['line', 'blank', 'line'])
  })

  it('never throws on anything', () => {
    for (const s of ['', '*', '_', '**', '__', '***', '#', '# ', '\n\n', '_a_b_c_']) {
      expect(() => parseMarks(s)).not.toThrow()
    }
  })
})

describe('stripping for the clipboard', () => {
  it('removes every mark and the heading hashes, and keeps the shape', () => {
    const body = '## Summary\n\nI lead **distributed** _systems_ work at __scale__.\n'
    expect(stripMarks(body)).toBe('Summary\n\nI lead distributed systems work at scale.\n')
  })

  it('is the identity on text with nothing to strip', () => {
    const body = 'priya_r@example.edu — CS*101\nline two'
    expect(stripMarks(body)).toBe(body)
  })
})

describe('whether anything was marked', () => {
  it('says so, and only when a real mark is present', () => {
    expect(hasMarks('nothing here')).toBe(false)
    expect(hasMarks('snake_case only')).toBe(false)
    expect(hasMarks('one **changed** word')).toBe(true)
    // A heading alone is structure, not a change.
    expect(hasMarks('## Section')).toBe(false)
  })

  it('has a legend line for each mark', () => {
    expect(Object.keys(MARK_LEGEND).sort()).toEqual(['bold', 'italic', 'underline'])
  })
})

describe('a star that is not emphasis', () => {
  /*
   * A CV is full of stars that mean something other than italic, and the
   * opener used to accept any non-space after it. The corresponding-author
   * mark was the one that cost something real: it opened a run that swallowed
   * the rest of the line, and `stripMarks` then removed the star from the text
   * the person copied out — so the authorship claim left the document.
   */
  it('leaves a corresponding-author mark as text, star and all', () => {
    const line = 'Mitra, S.*, Rao, P. — Consistent reads under partition, OSDI 2024'
    expect(parseInline(line).some((r) => r.italic)).toBe(false)
    expect(stripMarks(line)).toBe(line)
  })

  it('leaves a footnote star before punctuation as text', () => {
    expect(parseInline('Published in Nature*.').some((r) => r.italic)).toBe(false)
    expect(parseInline('Rated 4.5*/5 by students').some((r) => r.italic)).toBe(false)
  })

  it('leaves an unclosed mark as text, so a footnote definition keeps its star', () => {
    /*
     * The line that DEFINES the corresponding-author mark is the other half of
     * the same publications block, and it satisfies every other test: the star
     * is not inside a word and is followed by a letter. It opened a run that
     * reached the end of the line, and `stripMarks` then deleted the star —
     * removing the definition from the text the person pastes into an
     * application. An opener with nothing to close it is not emphasis.
     */
    for (const line of ['*Corresponding author.', '*Equal contribution.', '_Note: revised.']) {
      expect(parseInline(line).some((r) => r.italic), line).toBe(false)
      expect(stripMarks(line), line).toBe(line)
    }
    // Closed, it is emphasis again.
    expect(stripMarks('*Corresponding author.*')).toBe('Corresponding author.')
  })

  it('answers the closer question in one pass, not one scan per opener', () => {
    /*
     * Scanning ahead from every candidate is quadratic, and this is model
     * output so the shape cannot be ruled out upstream: twenty thousand lone
     * stars on one line took four and a half seconds and froze the preview.
     */
    const line = Array.from({ length: 20_000 }, () => '*a ').join('')
    expect(parseInline(line)).toHaveLength(1)
    // The budget is the test's own timeout, so no clock is read here (D26
    // applies to the tests too). Quadratic, this line took ~4.3 seconds.
  }, 1000)

  it('still opens on a real word, which is what the mark is for', () => {
    expect(parseInline('A _reworded_ opening').filter((r) => r.italic).map((r) => r.text)).toEqual([
      'reworded',
    ])
    expect(parseInline('A *softer* claim').filter((r) => r.italic).map((r) => r.text)).toEqual([
      'softer',
    ])
    // A closer stays lenient, or `_C++_` would never close.
    expect(parseInline('_C++_ closes').filter((r) => r.italic).map((r) => r.text)).toEqual(['C++'])
  })
})
