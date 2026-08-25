/**
 * Reading a CV, and — mostly — refusing to invent one.
 *
 * Almost every case here is about something the parser must NOT do. Extraction
 * from a personal document is the one place in this app where a plausible
 * fabrication lands in somebody's own records and is shown back to them as
 * though they wrote it, so the tests weigh heavily toward omission.
 */

import { describe, expect, it } from 'vitest'
import { CV_BUDGET, cvMessages, readCv } from './read-cv'

const reply = (payload: unknown) => JSON.stringify(payload)

describe('what it accepts', () => {
  it('reads a well-formed entry', () => {
    const out = readCv(
      reply({
        background: [
          {
            kind: 'education',
            title: 'PhD, Computer Science',
            where: 'University of Illinois',
            period: '2016–2021',
            year: 2016,
          },
        ],
      }),
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.background[0]).toEqual({
      kind: 'education',
      title: 'PhD, Computer Science',
      where: 'University of Illinois',
      period: '2016–2021',
      year: 2016,
    })
  })

  it('survives a fenced reply with prose around it', () => {
    // What a small local model actually sends, whatever the prompt said.
    const out = readCv(
      'Here is the JSON:\n```json\n{"background":[{"kind":"skill","title":"Rust"}]}\n```\nHope that helps.',
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.background).toHaveLength(1)
  })

  it('takes a year out of a range, keeping the start', () => {
    // Models return `"2021–2024"` for a field asked to be a single year. The
    // start is the right half: it is when the thing began, which is how CVs
    // order themselves.
    const out = readCv(reply({ background: [{ kind: 'employment', title: 'x', year: '2021–2024' }] }))
    expect(out.ok && out.background[0]?.year).toBe(2021)
  })
})

describe('what it refuses, which is the point', () => {
  it('drops the placeholders the prompt forbade', () => {
    /*
     * "Where: N/A" in somebody's own record is worse than a missing field: it
     * reads as a fact that was checked and found absent.
     */
    const out = readCv(
      reply({
        background: [{ kind: 'skill', title: 'Rust', where: 'N/A', detail: 'unknown', period: '--' }],
      }),
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.background[0]).toEqual({ kind: 'skill', title: 'Rust' })
  })

  it('skips an entry whose kind jojo does not have, and says so', () => {
    const out = readCv(
      reply({
        background: [
          { kind: 'hobby', title: 'Cycling' },
          { kind: 'skill', title: 'Go' },
        ],
      }),
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    // One row lost, not the extraction. Re-reading a CV is a round trip to
    // somebody's GPU; discarding twenty-nine good rows over one bad one pays
    // for the whole thing twice.
    expect(out.background).toHaveLength(1)
    expect(out.skipped[0]).toContain('hobby')
  })

  it('skips an entry with no title rather than filing a blank', () => {
    const out = readCv(reply({ background: [{ kind: 'award', where: 'ACM' }] }))
    expect(out.ok).toBe(false)
  })

  it('rejects a document that is not a CV', () => {
    const out = readCv(reply({ notACv: true }))
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.reason).toContain('does not read as a CV')
  })

  it('refuses a reply that is not JSON at all', () => {
    const out = readCv('I could not find a CV in that document.')
    expect(out.ok).toBe(false)
  })

  it('refuses when nothing usable came back, rather than reporting success on nothing', () => {
    const out = readCv(reply({ background: [] }))
    expect(out.ok).toBe(false)
  })

  it('rejects a year outside a plausible range', () => {
    const out = readCv(reply({ background: [{ kind: 'award', title: 'x', year: 12 }] }))
    expect(out.ok && out.background[0]?.year).toBeUndefined()
  })
})

describe('the prompt', () => {
  it('tells the model when it is reading a fragment', () => {
    /*
     * The tail of a long CV is almost always the publication list. A model
     * handed a truncated document without being told concludes the person has
     * not published, which is the single worst extraction error available here.
     */
    const long = 'x'.repeat(CV_BUDGET + 500)
    const messages = cvMessages('CV.pdf', long)
    expect(messages[1]?.content).toContain('first part of a longer document')
  })

  it('says nothing about truncation when the document fits', () => {
    const messages = cvMessages('CV.pdf', 'short')
    expect(messages[1]?.content).not.toContain('longer document')
  })

  it('names every kind it will accept, so the model is not guessing', () => {
    const system = String(cvMessages('CV.pdf', 'x')[0]?.content)
    for (const kind of ['education', 'employment', 'publication', 'skill', 'teaching', 'award', 'service']) {
      expect(system).toContain(kind)
    }
  })

  it('asks for omission rather than a guess, in as many words', () => {
    // The instruction the whole design rests on. Matched case-insensitively:
    // what matters is that the permission to leave a field out is stated, not
    // where the sentence happens to start.
    const system = String(cvMessages('CV.pdf', 'x')[0]?.content).toLowerCase()
    expect(system).toContain('never guess')
    expect(system).toContain('omit any key you cannot find')
    expect(system).toContain('do not infer')
  })
})
