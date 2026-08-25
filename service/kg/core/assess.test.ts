/**
 * Weighing somebody's record against a posting.
 *
 * The tests that matter here are the ones about restraint. An assessment of a
 * person's career is the easiest thing in this app to make sound authoritative
 * and the hardest for them to check, so most of what follows is about the
 * cases where the honest answer is "not measured" or "this is missing".
 */

import { describe, expect, it } from 'vitest'
import { assess, gapAdvice, type Evidence, type Requirement } from './assess'

const need = (text: string, essential = true): Requirement => ({ text, essential })

const cred = (id: string, kind: string, title: string, extra: Partial<Evidence> = {}): Evidence => ({
  id,
  kind,
  title,
  ...extra,
})

const RECORD: Evidence[] = [
  cred('c1', 'education', 'PhD, Computer Science', { where: 'University of Illinois', year: 2021 }),
  cred('c2', 'publication', 'Consistent snapshots without coordination', {
    where: 'OSDI',
    detail: 'distributed systems, storage',
    year: 2023,
  }),
  cred('c3', 'teaching', 'Distributed Systems', { detail: 'graduate course, three years' }),
  cred('c4', 'skill', 'Rust'),
  cred('c5', 'employment', 'Research Engineer', { where: 'Cloudflare', year: 2024 }),
]

describe('refusing to score what it cannot', () => {
  it('returns null rather than zero when the record is empty', () => {
    /*
     * The rule `fitOf` set and the one that matters most here. A person with
     * nothing recorded has not scored badly against this posting — they have
     * not been measured, and telling them 0% is telling them something false
     * about themselves on the screen where they decide whether to apply.
     */
    const out = assess([need('distributed systems')], [])
    expect(out.score).toBeNull()
    expect(out.gaps).toEqual([])
  })

  it('returns null when the posting yielded no requirements', () => {
    expect(assess([], RECORD).score).toBeNull()
  })
})

describe('matching evidence to a requirement', () => {
  it('finds the publication that answers a systems requirement', () => {
    const out = assess([need('distributed systems')], RECORD)
    expect(out.answered[0]?.evidence.map((e) => e.id)).toContain('c2')
  })

  it('reports the record it matched, not just that it matched', () => {
    // A claim about somebody's background that cannot be traced to the line it
    // came from is a claim they cannot check.
    const out = assess([need('teaching experience')], RECORD)
    const evidence = out.answered[0]?.evidence ?? []
    expect(evidence.length).toBeGreaterThan(0)
    expect(evidence[0]).toHaveProperty('id')
    expect(evidence[0]).toHaveProperty('title')
  })

  it('does not match on a coincidental shared word', () => {
    /*
     * "Experience" and "strong" appear in every posting and nearly every CV.
     * A matcher that counted them would report a strong fit for everything,
     * which is the failure that makes a score worthless.
     */
    const out = assess([need('experience with quantum error correction')], RECORD)
    expect(out.answered[0]?.evidence).toEqual([])
  })

  it('lists at most three pieces of evidence per requirement', () => {
    // A screen showing nine is a screen nobody reads, and the fourth-best match
    // never persuades anybody.
    const many = Array.from({ length: 9 }, (_, i) => cred(`x${String(i)}`, 'skill', 'distributed systems'))
    const out = assess([need('distributed systems')], many)
    expect(out.answered[0]?.evidence.length).toBeLessThanOrEqual(3)
  })
})

describe('gaps', () => {
  it('names a requirement nothing answers', () => {
    const out = assess([need('FPGA design')], RECORD)
    expect(out.gaps).toHaveLength(1)
    expect(out.gaps[0]?.requirement.text).toBe('FPGA design')
  })

  it('puts the required ones before the preferred', () => {
    const out = assess([need('FPGA design', false), need('quantum error correction', true)], RECORD)
    expect(out.gaps[0]?.requirement.essential).toBe(true)
  })

  it('leaves room for “you have this, it is not written down”', () => {
    /*
     * The distinction the whole feature depends on. A gap means the RECORD does
     * not answer the requirement — not that the person cannot do the thing. The
     * commonest cause by a wide margin is a CV that never mentioned it, and the
     * copy has to say so or the app is telling somebody they are unqualified on
     * the strength of a document's omissions.
     */
    const advice = gapAdvice({ requirement: need('FPGA design'), evidence: [], strength: 0 })
    expect(advice).toContain('If you have it')
    expect(advice).not.toContain('you lack')
  })

  it('says something different for a preferred gap than a required one', () => {
    const required = gapAdvice({ requirement: need('x', true), evidence: [], strength: 0 })
    const preferred = gapAdvice({ requirement: need('x', false), evidence: [], strength: 0 })
    expect(required).not.toBe(preferred)
    expect(required).toContain('required')
    expect(preferred).toContain('preferred')
  })
})

describe('the score', () => {
  it('weighs a missed essential more heavily than a missed preference', () => {
    /*
     * THE weighting decision. Meeting eight preferences and missing the one
     * required degree is not an 89% fit, and a number that said so would be
     * actively misleading on the screen where somebody decides whether to spend
     * an evening on an application.
     */
    const missedEssential = assess(
      [need('quantum error correction', true), need('Rust', false)],
      RECORD,
    )
    const missedPreference = assess(
      [need('Rust', true), need('quantum error correction', false)],
      RECORD,
    )
    expect(missedEssential.score!).toBeLessThan(missedPreference.score!)
  })

  it('scores a well-answered posting high and an unanswered one low', () => {
    const strong = assess([need('distributed systems'), need('Rust')], RECORD)
    const weak = assess([need('FPGA design'), need('quantum error correction')], RECORD)
    expect(strong.score!).toBeGreaterThan(weak.score!)
    expect(weak.score).toBe(0)
  })

  it('stays inside 0 and 100', () => {
    const out = assess([need('distributed systems'), need('Rust'), need('teaching')], RECORD)
    expect(out.score!).toBeGreaterThanOrEqual(0)
    expect(out.score!).toBeLessThanOrEqual(100)
  })
})

describe('what to lead with', () => {
  it('picks the records that answer the most of what was asked', () => {
    const out = assess([need('distributed systems'), need('storage')], RECORD)
    expect(out.lead[0]?.id).toBe('c2')
  })

  it('is drawn from what matched, not from what is most impressive', () => {
    /*
     * The best paper in somebody's record is not the one to lead with if this
     * employer never asked about that subject. Here the posting is about Rust
     * and teaching; the OSDI paper must not top the list.
     */
    const out = assess([need('Rust'), need('teaching')], RECORD)
    expect(out.lead.map((e) => e.id)).not.toContain('c2')
  })

  it('stops at five, because a tailoring list nobody reads tailors nothing', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      cred(`x${String(i)}`, 'skill', `distributed systems ${String(i)}`),
    )
    const out = assess([need('distributed systems')], many)
    expect(out.lead.length).toBeLessThanOrEqual(5)
  })
})
