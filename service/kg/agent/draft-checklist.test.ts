/**
 * Reading a drafted checklist out of a model reply.
 *
 * The tests that matter here are about what the reader REFUSES and what it
 * keeps anyway. A small local model answering "checklist" writes Markdown
 * inside its JSON, puts the array under a name it invented, repeats what it was
 * shown, and runs out of tokens halfway — none of which is a reason to throw
 * away the six good steps that did arrive.
 */

import { describe, expect, it } from 'vitest'
import { CHECKLIST_HEAD, CHECKLIST_TAIL, checklistMessages, readChecklist } from './draft-checklist'
import { DRAFT_CHECKLIST_ITEMS, MAX_CHECKLIST_TEXT } from '../core/model'
import type { ChecklistBrief } from './draft-checklist'

const reply = (payload: unknown) => JSON.stringify(payload)
const NONE: readonly { text: string }[] = []

const BRIEF: ChecklistBrief = {
  org: 'Rice University',
  role: 'Assistant Professor',
  postingName: 'rice-statistics.html',
  posting: 'Applications close 1 November. Send three letters through Interfolio.',
  requirements: ['PhD in Statistics'],
  guidance: ['No teaching statement on file'],
  existing: [],
  filed: ['CV-2026.pdf'],
  dated: ['Deadline · 1 November'],
}

describe('what comes back', () => {
  it('reads a plain list', () => {
    const out = readChecklist(
      reply({ items: [{ text: 'Order a transcript' }, { text: 'Ask three referees' }] }),
      NONE,
    )
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.items).toEqual(['Order a transcript', 'Ask three referees'])
  })

  it('takes a bare string entry', () => {
    const out = readChecklist(reply({ items: ['Order a transcript'] }), NONE)
    expect(out.ok && out.items).toEqual(['Order a transcript'])
  })

  it('finds the array under any of the names a model picks', () => {
    for (const key of ['items', 'checklist', 'tasks', 'steps']) {
      const out = readChecklist(reply({ [key]: ['Order a transcript'] }), NONE)
      expect(out.ok, key).toBe(true)
    }
  })

  it('descends one level when the model wrapped it', () => {
    // Gemma's shape. Refusing the whole read for a wrapper is a model call
    // thrown away over punctuation.
    const out = readChecklist(reply({ checklist: { items: ['Order a transcript'] } }), NONE)
    expect(out.ok && out.items).toEqual(['Order a transcript'])
  })
})

describe('the Markdown a model writes inside its JSON', () => {
  it('strips a bullet or a checkbox from the text', () => {
    const out = readChecklist(
      reply({ items: ['- [ ] Order a transcript', '1. Ask three referees', '* Register'] }),
      NONE,
    )
    expect(out.ok && out.items).toEqual(['Order a transcript', 'Ask three referees', 'Register'])
  })

  it('does NOT read a ticked checkbox as done — the model cannot know that', () => {
    /*
     * The reader has no way to tick anything and no tool it could tick with.
     * This test exists because stripping `[x]` and then honouring it is exactly
     * the "fix" a later maintainer reaches for, and it would hand a model the
     * one thing it must never write.
     */
    const out = readChecklist(reply({ items: ['- [x] Order a transcript'] }), NONE)
    expect(out.ok && out.items).toEqual(['Order a transcript'])
  })
})

describe('what it leaves out', () => {
  it('drops a step already on the person’s list, and says so in their terms', () => {
    const out = readChecklist(reply({ items: ['order a transcript.', 'Ask referees'] }), [
      { text: 'Order a transcript' },
    ])
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.items).toEqual(['Ask referees'])
    expect(out.skipped[0]).toMatch(/already on your list/)
    expect(out.dropped).toBe(1)
  })

  it('drops a repeat within the same reply, with a different sentence', () => {
    const out = readChecklist(reply({ items: ['Ask referees', 'ask referees'] }), NONE)
    expect(out.ok && out.items).toHaveLength(1)
    if (out.ok) expect(out.skipped[0]).toMatch(/said it twice/)
  })

  it('drops a paragraph, keeping the rest', () => {
    const out = readChecklist(
      reply({ items: ['x'.repeat(MAX_CHECKLIST_TEXT + 1), 'Order a transcript'] }),
      NONE,
    )
    expect(out.ok && out.items).toEqual(['Order a transcript'])
    if (out.ok) expect(out.skipped[0]).toMatch(/is a paragraph/)
  })

  it('stops at the limit and says how many it left', () => {
    const many = Array.from({ length: DRAFT_CHECKLIST_ITEMS + 4 }, (_, i) => `Step ${String(i)}`)
    const out = readChecklist(reply({ items: many }), NONE)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.items).toHaveLength(DRAFT_CHECKLIST_ITEMS)
    expect(out.dropped).toBe(4)
    expect(out.skipped.some((s) => s.includes('4 more'))).toBe(true)
  })

  it('counts what was LOST, which is not the number of notes', () => {
    // The two disagree in both directions, and a panel printing `skipped.length`
    // shipped that bug once already in `read-requirements.ts`.
    const many = Array.from({ length: DRAFT_CHECKLIST_ITEMS + 4 }, (_, i) => `Step ${String(i)}`)
    const out = readChecklist(reply({ items: many }), NONE)
    expect(out.ok && out.dropped).toBe(4)
    expect(out.ok && out.skipped).toHaveLength(1)
  })
})

describe('refusals', () => {
  it('refuses a page that is not a posting, in the sibling’s words', () => {
    const out = readChecklist(reply({ notAPosting: true }), NONE)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toMatch(/does not read as a job posting/)
  })

  it('refuses a reply with no JSON in it at all', () => {
    expect(readChecklist('I would suggest you order a transcript.', NONE).ok).toBe(false)
  })

  it('refuses JSON with no list', () => {
    const out = readChecklist(reply({ items: 'later' }), NONE)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toMatch(/without a list/)
  })

  it('refuses when nothing survived, carrying the first reason', () => {
    const out = readChecklist(reply({ items: ['Order a transcript'] }), [
      { text: 'order a transcript' },
    ])
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toMatch(/already on your list/)
  })
})

describe('a reply that stopped mid-answer', () => {
  it('keeps the whole entries that arrived and raises a note', () => {
    // Unlike tailoring, which refuses: half a document is not a document, but
    // half a list is a shorter list of whole steps.
    const cut = '{"items": ["Order a transcript", "Ask three referees", "Regis'
    const out = readChecklist(cut, NONE)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.items).toEqual(['Order a transcript', 'Ask three referees'])
    expect(out.notes.some((n) => n.includes('stopped mid-answer'))).toBe(true)
  })

  it('raises the same note when the transport says it was cut', () => {
    const out = readChecklist(reply({ items: ['Order a transcript'] }), NONE, { cutOff: true })
    expect(out.ok && out.notes.some((n) => n.includes('stopped mid-answer'))).toBe(true)
  })
})

describe('what the model is shown', () => {
  const joined = (b: ChecklistBrief) => checklistMessages(b).map((m) => m.content).join('\n')

  it('carries the existing list, marking what is already done', () => {
    const text = joined({
      ...BRIEF,
      existing: [
        { text: 'Order a transcript', done: true },
        { text: 'Ask referees', done: false },
      ],
    })
    expect(text).toContain('Order a transcript (done)')
    expect(text).toContain('- Ask referees')
    expect(text).toContain('do not repeat any of these')
  })

  it('carries the calendar and the filed materials, so it does not repeat them', () => {
    const text = joined(BRIEF)
    expect(text).toContain('Deadline · 1 November')
    expect(text).toContain('CV-2026.pdf')
  })

  it('keeps both ends of a long posting and says the middle is missing, once', () => {
    const posting = `${'H'.repeat(CHECKLIST_HEAD)}${'M'.repeat(5000)}${'T'.repeat(CHECKLIST_TAIL)}`
    const text = joined({ ...BRIEF, posting })
    expect(text).toContain('H'.repeat(200))
    expect(text).toContain('T'.repeat(200))
    expect(text.match(/characters not shown/g)).toHaveLength(1)
    expect(text).toContain('the END of the page')
  })

  it('says nothing about a cut when the posting fits whole', () => {
    expect(joined(BRIEF)).not.toContain('characters not shown')
  })

  it('never carries a document body — only names', () => {
    // The prompt-size regression guard. A body here is thousands of tokens on
    // every draft, and the queue's only slot for a minute longer.
    const body = 'BODYTEXT'.repeat(3000)
    const text = joined({ ...BRIEF, filed: ['CV-2026.pdf'] })
    expect(text).not.toContain(body)
    expect(text.length).toBeLessThan(CHECKLIST_HEAD + CHECKLIST_TAIL + 4000)
  })
})
