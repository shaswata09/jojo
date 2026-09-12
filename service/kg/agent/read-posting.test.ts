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
import {
  MAX_KEYWORDS_OFFERED,
  MAX_KEYWORDS_PICKED,
  POSTING_BUDGET,
  askForPosting,
  keywordRoster,
  matchKeywords,
  postingDocument,
  postingMessages,
  postingTextFromHtml,
  readPosting,
} from './read-posting'

/**
 * Keywords as the two apps hand them over: an id, the person's spelling, and
 * how many records already carry it. Ids are spelled the way the store mints
 * them so a test can prove none of them reaches the prompt.
 */
const offer = (name: string, used = 0, id = `kw:${name.toLowerCase().replace(/\W+/g, '-')}`) => ({
  id,
  name,
  used,
})

/** The six the app ships, four of which describe progress rather than a job. */
const SEEDED = [
  offer('Developer', 5),
  offer('Research', 4),
  offer('Read', 9),
  offer('Referral', 2),
  offer('Negotiating', 1),
  offer('Waiting on them', 3),
]

const reply = (o: unknown) => JSON.stringify(o)

describe('the prompt', () => {
  it('names every allowed role tag and source, so the model can match exactly', () => {
    const [system] = postingMessages('https://example.test/job', 'text', '2026-09-14', [])
    expect(system?.content).toContain('Assistant Professor')
    expect(system?.content).toContain('ML Engineer')
    expect(system?.content).toContain('Careers page')
  })

  it('carries the URL as well as the text', () => {
    const [, user] = postingMessages(
      'https://boards.test/acme/4',
      'Come work here',
      '2026-09-14',
      [],
    )
    expect(user?.content).toContain('https://boards.test/acme/4')
    expect(user?.content).toContain('Come work here')
  })

  it('trims a long page to the budget rather than sending all of it', () => {
    const huge = 'x'.repeat(POSTING_BUDGET * 3)
    const [, user] = postingMessages('https://example.test', huge, '2026-09-14', [])
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
    const messages = postingMessages(
      'https://example.com/job',
      'Closes 20 September.',
      '2026-09-14',
      [],
    )
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
    const system = postingMessages('https://example.com/job', 'x', '2026-12-01', [])[0]
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

describe('the page text, from a page the extension captured', () => {
  const page = (body: string) =>
    `<!doctype html><html><head><title>t</title><style>.x{color:red}</style></head><body>${body}</body></html>`

  it('leaves out what is never the posting, and keeps the header', () => {
    const text = postingTextFromHtml(
      page(
        '<nav>Jobs · Sign in</nav><header><h1>Research Engineer</h1><p>Acme · Houston</p></header>' +
          '<style>.y{margin:0}</style><svg><path d="M0 0L10 10"/></svg><script>track()</script>' +
          '<!-- a comment --><p>Apply by 1 October.</p><footer>© Acme 2026</footer>',
      ),
    )
    expect(text).toContain('Research Engineer')
    expect(text).toContain('Acme · Houston')
    expect(text).toContain('Apply by 1 October.')
    for (const gone of [
      'Sign in',
      'color:red',
      'margin',
      'M0 0',
      'track()',
      'a comment',
      '© Acme',
      '<',
    ]) {
      expect(text).not.toContain(gone)
    }
  })

  it('ends a line at every block and keeps a list as a list', () => {
    expect(
      postingTextFromHtml(
        '<h2>Requirements</h2><ul><li>A PhD</li><li>Teaching<br>experience</li></ul><p>Salary</p>',
      ),
    ).toBe('Requirements\n\n- A PhD\n- Teaching\nexperience\n\nSalary')
  })

  it('puts a bullet in front of an item whose content is a block of its own', () => {
    expect(postingTextFromHtml('<ul><li><p>Distributed systems</p></li></ul>')).toBe(
      '- Distributed systems',
    )
  })

  it('decodes an entity once, not twice', () => {
    expect(
      postingTextFromHtml('<p>R&amp;D &amp;lt;team&amp;gt; &#8212; &#x2014;&nbsp;now</p>'),
    ).toBe('R&D &lt;team&gt; — — now')
  })

  it('does not end a tag at a > inside a quoted attribute', () => {
    expect(postingTextFromHtml('<p title="a > b" data-x=\'c > d\'>Deadline 1 Oct</p>')).toBe(
      'Deadline 1 Oct',
    )
  })

  it('reads the main content instead of the page around it, when there is one', () => {
    const text = postingTextFromHtml(
      page(
        `<div>Other jobs you might like: ${'Filler role. '.repeat(20)}</div>` +
          `<main><h1>Systems Engineer</h1><p>${'Build distributed systems. '.repeat(30)}</p></main>`,
      ),
    )
    expect(text.startsWith('Systems Engineer')).toBe(true)
    expect(text).not.toContain('Other jobs you might like')
  })

  it('reads the whole page when main is too thin to be the posting', () => {
    const text = postingTextFromHtml(
      page('<main>Loading…</main><div><h1>Lecturer</h1><p>Teach computer science.</p></div>'),
    )
    expect(text).toContain('Lecturer')
    expect(text).toContain('Teach computer science.')
  })

  it('drops a country picker rather than reading two hundred options as the posting', () => {
    const text = postingTextFromHtml(
      '<p>Location</p><select><option>Afghanistan</option><option>Albania</option></select><p>Remote</p>',
    )
    expect(text).toBe('Location\n\nRemote')
  })

  it('drops a comment whole, even one with a > inside it', () => {
    // The tag strip at the end would take `<!-- a` up to the first `>` and
    // leave ` b -->` behind as text; comments go first for that reason.
    expect(postingTextFromHtml('<p>Apply</p><!-- if a > b show the banner --><p>Now</p>')).toBe(
      'Apply\n\nNow',
    )
  })

  it('keeps the cells of a table row apart', () => {
    expect(postingTextFromHtml('<table><tr><td>Salary</td><td>$100k</td></tr></table>')).toBe(
      'Salary $100k',
    )
  })

  it('collapses runs of space and never leaves more than one blank line', () => {
    const text = postingTextFromHtml('<div>  a   b </div><div></div><div></div><div>c</div>')
    expect(text).toBe('a b\n\nc')
  })
})

/**
 * The person's own keywords, offered to the model and matched back.
 *
 * The feature exists because a prefill that fills six fields and leaves the
 * keywords blank is a form half-filled — and the keywords are the one field
 * whose vocabulary the app already knows. What makes it dangerous is the same
 * thing: four of the six keywords the app ships ('Read', 'Referral',
 * 'Negotiating', 'Waiting on them') describe how the PERSON is getting on, so a
 * model that hands the list back tags the job with where they are up to.
 */
describe('offering the keywords', () => {
  const systemFor = (offered: readonly { id: string; name: string; used: number }[]) =>
    postingMessages('https://boards.test/j/1', 'A job', '2026-09-14', offered)[0]?.content ?? ''

  it('says nothing at all when the person has no keywords', () => {
    const system = systemFor([])
    expect(system).not.toContain('keywords')
    // The escape hatch still sits last, one blank line under the field list —
    // the join is what splitting the prompt could quietly break, and a prompt
    // that changed for the other seven fields would not fail anything else.
    expect(system).toMatch(/\.\n\nIf the text is not a job posting/)
  })

  it('adds the block and changes nothing else about the prompt', () => {
    /*
     * The byte-identity proof, computed rather than a copy of the prompt.
     *
     * Splitting `SYSTEM` in two to make room for the keyword block is the one
     * edit in this feature that can quietly change what the model is told about
     * the OTHER seven fields — a lost blank line, or the escape hatch landing
     * in the middle of the key list. Nothing else here would fail if it did.
     *
     * So: the two prompts must share their head exactly, and share their whole
     * tail exactly, and differ only by an inserted block.
     */
    const hatch = '\n\nIf the text is not a job posting'
    const empty = systemFor([])
    const withKeywords = systemFor(SEEDED)

    const head = empty.slice(0, empty.indexOf(hatch))
    expect(head).not.toBe('')
    // Everything from the escape hatch to the date is the same string.
    expect(empty).toBe(head + withKeywords.slice(withKeywords.indexOf(hatch)))
    // And the keyword block is an addition under the head, not a rewrite of it.
    expect(withKeywords.slice(0, withKeywords.indexOf(hatch)).startsWith(`${head}\n`)).toBe(true)
  })

  it('keeps a name on one line whatever the person typed into it', () => {
    // 1–40 characters with no character class behind them: a pasted name can
    // carry a newline, which would make one keyword read as two.
    const system = systemFor([offer('Machine\nLearning'), offer('Research')])
    expect(system).toContain('\n- Machine Learning\n')
    expect(system).not.toContain('\n- Learning\n')
  })

  it('lists one name per line, so a comma inside a name stays inside it', () => {
    // 'Berlin, remote' is a legal keyword: `keyword.create` takes 1–40
    // characters with no character class. Comma-joined it reads as two names,
    // and the model copies back half a keyword that matches nothing.
    const system = systemFor([offer('Berlin, remote'), offer('Research')])
    expect(system).toContain('\n- Berlin, remote\n')
    expect(system).toContain('\n- Research\n')
  })

  it('never puts an id in the prompt', () => {
    // Ids are minted per store, so an id is a token the model can only echo by
    // luck — and the reply is matched by name, so it would buy nothing.
    expect(systemFor(SEEDED)).not.toContain('kw:')
  })

  it('warns that some keywords are about the person, not about a job', () => {
    // Asserted against a roster that does NOT contain the example, because
    // `toContain('Waiting on them')` over SEEDED is satisfied by SEEDED's own
    // roster line — it passed whether or not the warning was there at all.
    const system = systemFor([offer('Developer'), offer('Research')])
    expect(system).toContain('never what a posting')
    expect(system).toContain('Skip any of theirs')
  })

  it('tells the model that answering with none is the ordinary answer', () => {
    // A model handed a list reads it as a menu it is expected to order from.
    expect(systemFor(SEEDED)).toContain('OMIT the key when none of them fit')
  })

  it('keeps the field list and the escape hatch in that order around it', () => {
    const system = systemFor(SEEDED)
    expect(system.indexOf('source')).toBeLessThan(system.indexOf('Their keywords'))
    expect(system.indexOf('Their keywords')).toBeLessThan(system.indexOf('notAPosting'))
  })
})

describe('which keywords are offered', () => {
  it('shows the most-used first, so a long vocabulary is cut at the tail', () => {
    expect(keywordRoster(SEEDED).map((k) => k.name)).toEqual([
      'Read',
      'Developer',
      'Research',
      'Waiting on them',
      'Referral',
      'Negotiating',
    ])
  })

  it('leaves keywords used equally often in the order they were defined', () => {
    // A stable sort, so the roster reads like the person's own chip row rather
    // than reshuffling on every read.
    const same = [offer('Alpha'), offer('Beta'), offer('Gamma')]
    expect(keywordRoster(same).map((k) => k.name)).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('cuts a vocabulary too long to put in a prompt', () => {
    const many = Array.from({ length: MAX_KEYWORDS_OFFERED + 12 }, (_, i) =>
      offer(`k${String(i)}`, i),
    )
    const roster = keywordRoster(many)
    expect(roster).toHaveLength(MAX_KEYWORDS_OFFERED)
    // The most-used end, not the first defined.
    expect(roster[0]?.name).toBe(`k${String(many.length - 1)}`)
  })

  it('does not reorder the caller array', () => {
    // It is React state on both platforms.
    const mine = [offer('Alpha', 1), offer('Beta', 9)]
    keywordRoster(mine)
    expect(mine.map((k) => k.name)).toEqual(['Alpha', 'Beta'])
  })
})

describe('reading the keywords out of a reply', () => {
  it('takes the names, in the model spelling, without checking them', () => {
    // 'Kubernetes' is nobody's keyword here. It has to survive this half: the
    // check against what exists happens once, in `matchKeywords`, and a name
    // dropped here would be dropped by a rule written twice.
    const read = readPosting(reply({ org: 'Acme', keywords: ['Research', 'Kubernetes'] }))
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.keywordNames).toEqual(['Research', 'Kubernetes'])
  })

  it('strips the bullet the roster puts in front of every name', () => {
    // The prompt says to copy the name EXACTLY and writes it as '- Research'.
    const read = readPosting(reply({ org: 'Acme', keywords: ['- Research', '* Developer'] }))
    if (read.ok) expect(read.keywordNames).toEqual(['Research', 'Developer'])
  })

  it('is an empty list when the key is absent, which is the common answer', () => {
    const read = readPosting(reply({ org: 'Acme', role: 'Engineer' }))
    if (read.ok) expect(read.keywordNames).toEqual([])
  })

  it('drops the non-answers it drops everywhere else, and the duplicates', () => {
    const read = readPosting(
      reply({
        org: 'Acme',
        keywords: ['Research', '  research ', '', 'N/A', 7, null, 'Developer'],
      }),
    )
    // One 'Research' — folded, because a model asked for an array repeats
    // itself in a different case — and the rubbish gone.
    if (read.ok) expect(read.keywordNames).toEqual(['Research', 'Developer'])
  })

  it('ignores a comma-joined string, which is what a small model writes instead', () => {
    const read = readPosting(
      reply({ org: 'Acme', role: 'Engineer', keywords: 'Research, Developer' }),
    )
    expect(read.ok).toBe(true)
    // And the seven fields it did get right are untouched: a bad answer to one
    // key must not cost the person the whole read.
    if (read.ok) {
      expect(read.keywordNames).toEqual([])
      expect(read.draft.org).toBe('Acme')
      expect(read.draft.role).toBe('Engineer')
    }
  })
})

describe('matching names onto the keywords that exist', () => {
  const ids = (names: string[]) => matchKeywords(SEEDED, names)

  it('answers with ids, folded the way the store folds a keyword name', () => {
    // `keyword.create` has always treated 'UT Austin' and 'ut austin' as one
    // word; a near-miss roleTag is dropped instead, because a segmented control
    // compares by value and there is no node behind it.
    expect(ids(['research'])).toEqual(['kw:research'])
    expect(ids(['  WAITING ON THEM '])).toEqual(['kw:waiting-on-them'])
  })

  it('drops a name the person does not have, and creates nothing', () => {
    expect(ids(['Kubernetes'])).toEqual([])
    expect(ids(['Research', 'Kubernetes'])).toEqual(['kw:research'])
  })

  it('does not answer in the order the model happened to say them', () => {
    // Said in one order, returned in the offer's. The picker would otherwise
    // show the same two keywords differently on two reads of the same page.
    expect(ids(['Research', 'Developer'])).toEqual(['kw:developer', 'kw:research'])
    expect(ids(['Developer', 'Research'])).toEqual(['kw:developer', 'kw:research'])
  })

  it('keeps none at all when the model hands back more than a posting could be about', () => {
    /*
     * The echo. Against a six-word vocabulary "four of these apply" is the list
     * being repeated, not the page being read — and four of these six are
     * states of the person's own progress. Keeping the first three would tick
     * three wrong chips with the same confidence as three right ones.
     */
    const echoed = SEEDED.map((k) => k.name)
    expect(ids(echoed)).toEqual([])
    expect(ids(echoed.slice(0, MAX_KEYWORDS_PICKED + 1))).toEqual([])
    // And the cap is a ceiling, not a target: exactly three is kept.
    expect(ids(echoed.slice(0, MAX_KEYWORDS_PICKED))).toHaveLength(MAX_KEYWORDS_PICKED)
  })

  it('counts the cap AFTER matching, so invented names cannot starve real ones', () => {
    // Six names, five of them invented: the one real match survives rather than
    // the answer being thrown away for being long.
    expect(ids(['a', 'b', 'c', 'd', 'e', 'Research'])).toEqual(['kw:research'])
  })

  it('is empty for an empty answer', () => {
    expect(ids([])).toEqual([])
  })

  it('hands back what the read found, through both halves together', () => {
    /*
     * The joined path, which neither half proves on its own.
     *
     * `readPosting` deliberately caps nothing and checks nothing against the
     * store; `matchKeywords` does both. Test them apart and a cap added to the
     * first one — which would let five invented names crowd out the real
     * match behind them — passes everything.
     */
    const read = readPosting(
      reply({ org: 'Acme', keywords: ['a', 'b', 'c', 'd', 'e', '- Research'] }),
    )
    expect(read.ok).toBe(true)
    if (read.ok) expect(matchKeywords(SEEDED, read.keywordNames)).toEqual(['kw:research'])
  })

  it('returns them in the order they were offered, which is the order asked for', () => {
    // Both apps pass `keywordRoster(...)`, so the offer is most-used first and
    // so is the answer. Asserted through the roster rather than through SEEDED,
    // which no caller ever passes.
    const roster = keywordRoster(SEEDED)
    expect(matchKeywords(roster, ['Developer', 'Research'])).toEqual([
      'kw:developer',
      'kw:research',
    ])
    expect(matchKeywords(roster, ['Waiting on them', 'Developer'])).toEqual([
      'kw:developer',
      'kw:waiting-on-them',
    ])
  })
})
