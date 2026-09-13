/**
 * The tailoring prompt and the reader for its reply.
 *
 * What is pinned here is not the wording but the CONTRACT: which facts the
 * model is handed, what it is told it may not do, when the document is asked
 * for whole and when in sections, and what the reader keeps, refuses or merely
 * doubts. The live harness (`test/live-tailor.test.ts`) measures the models;
 * this measures the sentences they are sent.
 */

import { describe, expect, it } from 'vitest'
import {
  CUT_OFF,
  modeFor,
  plainSource,
  readTailored,
  tailorMessages,
  TAILOR_BASE_BUDGET,
  TAILOR_POSTING_BUDGET,
  TOO_SHORT,
  WHOLE_LIMIT,
} from './tailor-material'
import type { TailorBrief } from './tailor-material'

const BRIEF: TailorBrief = {
  kind: 'cv',
  org: 'Rice University',
  role: 'Assistant Professor of Computer Science',
  postingName: 'posting.html',
  posting: 'The department invites applications… distributed systems… teaching two courses…',
  requirements: [
    { text: 'PhD in computer science', essential: true },
    { text: 'distributed systems', essential: false },
  ],
  guidance: {
    verdict: 'strong',
    summary: 'Your record answers 2 of 2.',
    tailor: [
      {
        evidence: {
          id: 'b1',
          kind: 'employment',
          title: 'Research Scientist',
          where: 'Databricks',
        },
        answers: 'distributed systems',
      },
    ],
    prepare: [{ requirement: 'grant writing', essential: true, advice: 'Be ready.' }],
  },
  baseName: 'CV.pdf',
  base: '## Summary\nI build distributed systems.\n\n## Publications\nA paper.\n'.repeat(3),
}

const userText = (brief: TailorBrief) => tailorMessages(brief)[1]?.content ?? ''
const systemText = (brief: TailorBrief) => tailorMessages(brief)[0]?.content ?? ''

describe('what the model is told', () => {
  it('hands over the posting, the requirements, the fit, and the document', () => {
    const u = userText(BRIEF)
    expect(u).toContain('Assistant Professor of Computer Science at Rice University')
    expect(u).toContain('[required] PhD in computer science')
    expect(u).toContain('[preferred] distributed systems')
    expect(u).toContain('Research Scientist (Databricks) — answers “distributed systems”')
    expect(u).toContain('grant writing (required)')
    expect(u).toContain('I build distributed systems.')
  })

  it('forbids invention in as many words, and names the four marks', () => {
    const s = systemText(BRIEF)
    expect(s).toMatch(/Never invent/)
    expect(s).toContain('**…**')
    expect(s).toContain('_…_')
    expect(s).toContain('__…__')
    expect(s).toContain('## Heading')
    // No copyable word inside a mark: a 14B model echoed `**text**` literally.
    expect(s).not.toMatch(/\*\*text\*\*/)
    expect(s).toMatch(/no preamble/i)
  })

  it('tells the model gaps are not to be claimed', () => {
    expect(userText(BRIEF)).toMatch(/do NOT claim these/)
  })

  it('says when no fit was measured rather than inventing one', () => {
    expect(userText({ ...BRIEF, guidance: null })).toContain('no background recorded')
  })

  it('asks for the whole document when it is short, and the changed sections when it is long', () => {
    expect(modeFor(WHOLE_LIMIT)).toBe('whole')
    expect(modeFor(WHOLE_LIMIT + 1)).toBe('sections')
    expect(userText(BRIEF)).toContain('Return the ENTIRE document')
    const long = { ...BRIEF, base: 'x'.repeat(WHOLE_LIMIT + 1) }
    expect(userText(long)).toContain('Return ONLY the sections you changed')
    expect(userText(long)).toContain('"Unchanged:"')
  })

  it('cuts a long document and a long posting, and says so', () => {
    const u = userText({
      ...BRIEF,
      base: 'b'.repeat(TAILOR_BASE_BUDGET + 500),
      posting: 'p'.repeat(TAILOR_POSTING_BUDGET + 40),
    })
    expect(u).toContain('The document continues for 500 more characters; not shown')
    expect(u).toContain('The posting continues for 40 more characters; not shown')
    // And not a character more than the budget of either.
    expect(u.split('p'.repeat(TAILOR_POSTING_BUDGET))).toHaveLength(2)
  })

  it('gives kind-specific guidance', () => {
    expect(userText({ ...BRIEF, kind: 'cover-letter' })).toMatch(/one page/)
    expect(userText({ ...BRIEF, kind: 'cv' })).toMatch(/Do not\s+drop entries/)
  })
})

describe('the document as the model sees it', () => {
  it('flattens the source’s own Markdown so every mark in the reply is the model’s', () => {
    // A DOCX through MarkItDown: bold headings, `* ` bullets, an italic venue.
    const src = '**Summary**\n* Led a team\n* Shipped _fast_\nSee snake_case_name and a*b.'
    expect(plainSource(src)).toBe(
      'Summary\n- Led a team\n- Shipped fast\nSee snake_case_name and a*b.',
    )
  })

  it('sends the flattened text, not the original', () => {
    const u = userText({ ...BRIEF, base: '**Bold heading**\n* a bullet' })
    expect(u).toContain('Bold heading\n- a bullet')
    expect(u).not.toContain('**Bold heading**')
  })
})

describe('reading the reply', () => {
  const DOC = `## Summary\n**I build distributed systems for hiring committees.**\n\n## Publications\nA paper.\n${'More.\n'.repeat(40)}`

  it('keeps a good document and says it is marked', () => {
    const out = readTailored(DOC, BRIEF)
    expect(out.ok && out.body.startsWith('## Summary')).toBe(true)
    expect(out.ok && out.marked).toBe(true)
    expect(out.ok && out.notes).toEqual([])
  })

  it('strips a code fence and a preamble line', () => {
    const wrapped = `Here is your tailored CV:\n\n\`\`\`markdown\n${DOC}\n\`\`\``
    const out = readTailored(wrapped, BRIEF)
    expect(out.ok && out.body.startsWith('## Summary')).toBe(true)
    expect(out.ok && out.body.includes('```')).toBe(false)
  })

  it('strips a preamble that runs straight into the document, and an unclosed fence', () => {
    const noBlank = readTailored(`Here is the tailored CV:\n${DOC}`, BRIEF)
    expect(noBlank.ok && noBlank.body.startsWith('## Summary')).toBe(true)
    const cutFence = '```\n' + DOC
    const out = readTailored(cutFence, BRIEF)
    expect(out.ok && out.body.startsWith('## Summary')).toBe(true)
  })

  it('strips a mark wrapped around the placeholder, and does not count it as a change', () => {
    // What Qwen3 14B actually returned: the literal word from the rule, in
    // front of each passage it had changed, with the passage itself unmarked.
    const echoed = `**text** My research focuses on trustworthy AI.\n_text_ ${'More prose. '.repeat(30)}`
    const out = readTailored(echoed, BRIEF)
    expect(out.ok && out.body.startsWith('My research focuses')).toBe(true)
    expect(out.ok && out.marked).toBe(false)
    expect(out.ok && out.notes.join(' ')).toMatch(/Nothing in it is marked/)
  })

  it('refuses a refusal', () => {
    const declined = `I'm sorry, but I cannot tailor this document because ${'x'.repeat(220)}`
    const out = readTailored(declined, BRIEF)
    expect(out.ok).toBe(false)
    expect(!out.ok && out.reason).toMatch(/declined/)
  })

  it('refuses a reply that is not a document, with a lower bar for a sections reply', () => {
    expect(readTailored('', BRIEF).ok).toBe(false)
    expect(readTailored('x'.repeat(TOO_SHORT.whole - 1), BRIEF).ok).toBe(false)
    // One rewritten summary paragraph is a legitimate sections reply.
    const long = { ...BRIEF, base: 'x'.repeat(WHOLE_LIMIT + 1) }
    const short = readTailored(
      '## Summary\n**Distributed systems researcher for this role.**',
      long,
    )
    expect(short.ok).toBe(true)
  })

  it('keeps an unmarked document that differs from the source, but says nothing was marked', () => {
    // A real rewrite with the marks forgotten: the text is not the source.
    const plain = DOC.replaceAll('**', '')
    const out = readTailored(plain, BRIEF)
    expect(out.ok && out.marked).toBe(false)
    expect(out.ok && out.notes.join(' ')).toMatch(/Nothing in it is marked/)
  })

  it('refuses the source handed back unchanged, and the source repeated', () => {
    /*
     * What a 14B model does a third of the time. Saved, it would sit on the
     * card as a tailored CV over the person's own unchanged CV — worse than
     * an error, because it looks done.
     */
    const base = `## Summary\nI build distributed systems.\n\n## Publications\n${'A paper about things.\n'.repeat(12)}`
    const brief = { ...BRIEF, base }
    const same = readTailored(base, brief)
    expect(same.ok).toBe(false)
    expect(!same.ok && same.reason).toMatch(/unchanged/)
    // Whitespace and the source's own Markdown do not disguise it.
    const reflowed = readTailored(`  ${base.replace(/\n/g, '\n\n')}  `, brief)
    expect(reflowed.ok).toBe(false)
    const twice = readTailored(`${base}\n\n${base}`, brief)
    expect(twice.ok).toBe(false)
    // But a MARKED reply that starts with the source is a tailoring that added
    // at the end, and is kept.
    const appended = readTailored(`${base}\n\n## Note\n**Added for this posting.**`, brief)
    expect(appended.ok).toBe(true)
  })

  it('doubts a whole-document reply that lost most of the document', () => {
    const big = { ...BRIEF, base: 'line\n'.repeat(1000) }
    const out = readTailored(`**short**\n${'ok\n'.repeat(80)}`, big)
    expect(out.ok && out.notes.join(' ')).toMatch(/much shorter/)
  })

  it('doubts a sections reply with no headings', () => {
    const long = { ...BRIEF, base: 'x'.repeat(WHOLE_LIMIT + 1) }
    const out = readTailored(`**changed** ${'text '.repeat(60)}`, long)
    expect(out.ok && out.notes.join(' ')).toMatch(/No section headings/)
  })

  it('has one sentence for a reply the server cut off', () => {
    expect(CUT_OFF).toMatch(/output limit/)
  })
})
