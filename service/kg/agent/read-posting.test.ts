/**
 * Reading a posting, without a model and without a network.
 *
 * Everything here is the half that can be wrong on purpose: a model that fences
 * its JSON, invents a role tag the form cannot show, writes "N/A" into a field
 * the prompt told it to omit, or is handed an error page and extracts an
 * employer from it anyway. Those are not hypothetical — the JS-only board and
 * the 403 were both found by pointing the real reader at real job boards.
 */

import { describe, expect, it } from 'vitest'
import { POSTING_BUDGET, askForPosting, postingDocument, postingMessages, readPosting } from './read-posting'

const reply = (o: unknown) => JSON.stringify(o)

describe('the prompt', () => {
  it('names every allowed role tag and source, so the model can match exactly', () => {
    const [system] = postingMessages('https://example.test/job', 'text', '2026-09-14')
    expect(system?.content).toContain('Assistant Professor')
    expect(system?.content).toContain('ML Engineer')
    expect(system?.content).toContain('Careers page')
  })

  it('carries the URL as well as the text', () => {
    const [, user] = postingMessages('https://boards.test/acme/4', 'Come work here', '2026-09-14')
    expect(user?.content).toContain('https://boards.test/acme/4')
    expect(user?.content).toContain('Come work here')
  })

  it('trims a long page to the budget rather than sending all of it', () => {
    const huge = 'x'.repeat(POSTING_BUDGET * 3)
    const [, user] = postingMessages('https://example.test', huge, '2026-09-14')
    // The URL and the labels ride along, so this is a bound rather than equality.
    expect((user?.content ?? '').length).toBeLessThan(POSTING_BUDGET + 200)
  })
})

describe('reading the reply', () => {
  it('takes the fields it recognises', () => {
    const read = readPosting(
      reply({
        org: 'Rice University',
        role: 'Assistant Professor of Statistics',
        roleTag: 'Assistant Professor',
        location: 'Houston, TX',
        comp: '$110k–$130k',
        deadline: '2026-11-15',
        source: 'Careers page',
      }),
    )
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.draft.org).toBe('Rice University')
    expect(read.draft.roleTag).toBe('Assistant Professor')
    expect(read.draft.deadline).toBe('2026-11-15')
    expect(read.missing).toEqual([])
  })

  it('digs the object out of a fence and a preamble', () => {
    const read = readPosting(
      'Here is the JSON you asked for:\n```json\n{"org":"Acme","role":"Engineer"}\n```\nHope that helps!',
    )
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.draft.org).toBe('Acme')
  })

  it('drops a role tag the form cannot show rather than near-matching it', () => {
    // 'Assistant professor' differs from `ROLES` only in case, which is exactly
    // the answer a model gives and exactly the one that must not be accepted:
    // the segmented control compares by value and would render nothing selected.
    const read = readPosting(reply({ org: 'Rice', roleTag: 'Assistant professor' }))
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.draft.roleTag).toBeUndefined()
    expect(read.missing).toContain('roleTag')
  })

  it('drops a deadline that is not a date', () => {
    // 'Open until filled' is the commonest real answer, and the form's date
    // input would silently refuse it.
    const read = readPosting(reply({ org: 'Rice', deadline: 'Open until filled' }))
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.draft.deadline).toBeUndefined()
  })

  it('treats the filler words the prompt banned as absent', () => {
    const read = readPosting(
      reply({ org: 'Rice', role: 'Postdoc', comp: 'N/A', location: 'unknown' }),
    )
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.draft.comp).toBeUndefined()
    expect(read.draft.location).toBeUndefined()
    expect(read.missing).toContain('comp')
  })

  it('drops a source that is not one of the four', () => {
    const read = readPosting(reply({ org: 'Rice', source: 'LinkedIn' }))
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.draft.source).toBeUndefined()
  })

  it('refuses a page the model says is not a posting', () => {
    const read = readPosting(reply({ notAPosting: true }))
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.reason).toContain('does not read as a job posting')
  })

  it('refuses a reply with neither an employer nor a role', () => {
    // The shape a model returns for an error page when it will not admit it is
    // one: every field omitted, which must not open a form full of blanks.
    const read = readPosting(reply({ location: 'Houston, TX' }))
    expect(read.ok).toBe(false)
  })

  it('refuses a reply that is not JSON at all', () => {
    const read = readPosting('I could not read that page, sorry.')
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.reason).toContain('did not answer with JSON')
  })

  it('survives a brace inside a string value', () => {
    // The brace scan has to respect strings, or a role containing one truncates
    // the object and the whole read fails on a page that was fine.
    const read = readPosting(reply({ org: 'Acme', role: 'Engineer {Level 3}' }))
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.draft.role).toBe('Engineer {Level 3}')
  })

  it('never sets a stage', () => {
    // A posting cannot know whether you have applied, and a draft that arrives
    // pre-staged would file a job you have not sent as one you have.
    const read = readPosting(reply({ org: 'Rice', role: 'Postdoc', stage: 'submitted' }))
    expect(read.ok).toBe(true)
    if (read.ok) expect('stage' in read.draft).toBe(false)
  })
})

describe('the saved document', () => {
  it('escapes markup so a posting cannot inject anything into the viewer', () => {
    // Postings are somebody else's text, rendered in an iframe on web and a
    // WebView on the phone. An unescaped `<script>` in a job ad is the whole
    // reason this wraps rather than storing the markdown raw.
    const html = postingDocument('https://x.test', '<script>alert(1)</script> & <b>hi</b>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&amp;')
  })

  it('escapes the URL it puts in the title', () => {
    const html = postingDocument('https://x.test/?a=1&b=<2>', 'body')
    expect(html).toContain('a=1&amp;b=&lt;2&gt;')
  })

  it('wraps rather than collapsing, so newlines survive the render', () => {
    // The defect this exists for: HTML collapses newlines, so bare markdown
    // arrives as one unbroken paragraph.
    const html = postingDocument('https://x.test', 'line one\nline two')
    expect(html).toContain('white-space:pre-wrap')
    expect(html).toContain('line one\nline two')
  })

  it('carries no script of its own', () => {
    const html = postingDocument('https://x.test', '# Role\n\nDetails')
    expect(html.toLowerCase()).not.toContain('<script')
  })
})

/**
 * The posting reader is told what today is, for the same reason the agent loop
 * is — and here the cost is higher.
 *
 * It asks for `deadline` as `YYYY-MM-DD`, and postings say "applications close
 * 20 September" far more often than they give a year. Without the date the
 * model supplies one from its weights, and the result is a real deadline on a
 * real application, in the wrong year, looking exactly like a right one.
 */
describe('the date in the posting prompt', () => {
  it('reaches the model, and does not replace the instructions', () => {
    const messages = postingMessages('https://example.com/job', 'Closes 20 September.', '2026-09-14')
    const system = messages[0]
    expect(system?.role).toBe('system')
    expect(system?.content).toContain('2026-09-14')
    // Appended, not substituted — the field list is the rest of this prompt.
    expect(system?.content).toContain('deadline')
  })

  it('tells the model which way a bare day and month resolves', () => {
    // "20 September" in December is next September, not one that has passed.
    // A deadline is ahead by definition, and that is the half a date alone does
    // not give you.
    const system = postingMessages('https://example.com/job', 'x', '2026-12-01')[0]
    expect(system?.content).toContain('a deadline')
    expect(system?.content?.toLowerCase()).toContain('next year')
  })
})

/**
 * The retry, which exists because the parse sits AFTER the expensive part.
 *
 * Every test here is about telling three failures apart that the app used to
 * treat as one: a draw that can be flipped again, an answer that is not coming,
 * and a page that is not a posting. Only the first is worth a second call.
 */
describe('askForPosting', () => {
  const good = JSON.stringify({ org: 'Rice University', role: 'Research Scientist' })

  it('takes a second draw when the first did not parse', async () => {
    const replies = ['Sure! Here is what I found on that page.', good]
    let calls = 0
    const read = await askForPosting(async () => replies[calls++] ?? null)
    expect(calls).toBe(2)
    expect(read.ok).toBe(true)
    expect(read.attempts).toBe(2)
  })

  it('does not ask twice when the first draw parsed', async () => {
    let calls = 0
    const read = await askForPosting(async () => {
      calls += 1
      return good
    })
    expect(calls).toBe(1)
    expect(read.attempts).toBe(1)
  })

  it('stops at a page that is not a posting, which a second draw cannot change', async () => {
    // A fact about the PAGE, not about the draw. Retrying makes the person wait
    // to be told the same thing.
    let calls = 0
    const read = await askForPosting(async () => {
      calls += 1
      return JSON.stringify({ notAPosting: true })
    })
    expect(calls).toBe(1)
    expect(read.ok).toBe(false)
  })

  it('stops when the model answers with nothing, twice being no more likely', async () => {
    let calls = 0
    const read = await askForPosting(async () => {
      calls += 1
      return ''
    })
    expect(calls).toBe(1)
    expect(read.ok).toBe(false)
  })

  it('gives up after the second bad draw rather than waiting for a third', async () => {
    let calls = 0
    const read = await askForPosting(async () => {
      calls += 1
      return 'still not JSON'
    })
    expect(calls).toBe(2)
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.reason).toContain('did not answer with JSON')
  })
})
