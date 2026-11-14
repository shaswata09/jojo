import { describe, expect, it } from 'vitest'
import { FALLBACK, SCRIPTS, scriptById, scriptFor, scriptedExchange } from './scripts'

describe('scriptFor', () => {
  it('picks the script whose cue is in the message, case-insensitively', () => {
    expect(scriptFor('Help with my COVER LETTER').id).toBe('cover-letter')
    expect(scriptFor('a campus visit next week').id).toBe('interview')
  })

  it('breaks ties by the order of SCRIPTS', () => {
    // "posting" cues parse-posting, "tailor" cues tailor-cv, which comes first.
    expect(scriptFor('tailor this posting').id).toBe('tailor-cv')
  })

  it('falls back when nothing matches', () => {
    expect(scriptFor('what is the weather')).toBe(FALLBACK)
  })

  it('answers every quick action with its own script', () => {
    for (const s of SCRIPTS) expect(scriptFor(s.action).id).toBe(s.id)
  })
})

describe('scriptById', () => {
  it('finds a script, or the fallback for an unknown or missing id', () => {
    expect(scriptById('follow-up').title).toBe('Follow-up after no response')
    expect(scriptById('nope')).toBe(FALLBACK)
    expect(scriptById(undefined)).toBe(FALLBACK)
  })
})

describe('scriptedExchange', () => {
  it('numbers the pair from `at` and badges the reply with its script', () => {
    const [you, reply] = scriptedExchange(4, 'Draft a follow-up email')
    expect(you).toEqual({ id: 'm4', role: 'you', text: 'Draft a follow-up email' })
    expect(reply).toMatchObject({ id: 'm5', role: 'assistant', scriptId: 'follow-up' })
    expect(reply.text).toBe(scriptById('follow-up').reply)
  })

  it('badges a fallback reply too', () => {
    expect(scriptedExchange(0, 'hello')[1].scriptId).toBe('fallback')
  })
})
