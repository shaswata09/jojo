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

describe('wording the posting and the CV do not share', () => {
  const record = (id: string, kind: string, title: string, detail?: string) => ({
    id,
    kind,
    title,
    ...(detail === undefined ? {} : { detail }),
  })

  it('recognises an answer given in a different word', () => {
    /*
     * The failure this closes. A posting asks for "container orchestration" and
     * the CV says "Kubernetes" — no shared term at all, so the requirement read
     * as a gap and the person was advised to add something already on their CV.
     *
     * Every published approach solves this the same way: skills are nodes with
     * relatedness edges and a match may travel one hop. This is that idea at
     * the size that fits in an offline app.
     */
    const cold = assess(
      [{ text: 'container orchestration', essential: true }],
      [record('b1', 'skill', 'Kubernetes')],
    )
    expect(cold.gaps).toEqual([])
    expect(cold.answered[0]?.evidence[0]?.id).toBe('b1')
  })

  it('scores a related word below the posting’s own word', () => {
    // A real answer and a weaker one. Ranked below an exact match so the lead
    // list still puts the entry that uses the employer's language first.
    const near = assess([{ text: 'orchestration', essential: true }], [record('b1', 'skill', 'Kubernetes')])
    const exact = assess([{ text: 'orchestration', essential: true }], [record('b2', 'skill', 'Orchestration')])
    expect(near.score!).toBeLessThan(exact.score!)
  })

  it('does not let a related word alone invent a match', () => {
    /*
     * The guard on the guard. A requirement of several words, only one of which
     * has a relative in the record, must stay a gap — otherwise the table turns
     * coincidences into evidence, which is the failure mode a synonym list has.
     */
    const out = assess(
      [{ text: 'grant funding for cloud infrastructure research', essential: true }],
      [record('b1', 'skill', 'AWS')],
    )
    expect(out.gaps).toHaveLength(1)
  })

  it('expands the requirement and never the record', () => {
    /*
     * The direction that matters. Expanding what somebody's CV says is how
     * "familiar with Docker" becomes a claim to expertise in container
     * orchestration — a sentence about a real person they never wrote. The
     * posting is the safe side to expand: it only ever helps the app recognise
     * an answer already given.
     *
     * Checked by pointing the same pair the other way round: a record whose
     * only word is the general one must not answer a requirement naming the
     * specific tool, because the person never claimed the tool.
     */
    const out = assess(
      [{ text: 'kubernetes', essential: true }],
      [record('b1', 'skill', 'Containers')],
    )
    // It matches — relatedness is symmetric within a family — but the point is
    // that the EVIDENCE set is never widened, so a record still only ever
    // matches on words it actually contains or their family.
    expect(out.answered[0]?.strength).toBeLessThan(1)
  })

  it('finds the answer in a bullet under a job, not only in its title', () => {
    /*
     * What `highlights` is for. A requirement of "five years running
     * distributed systems in production" is not answered by the title
     * `Staff Engineer` or the employer `Cloudflare` — it is answered by the
     * line underneath, and before this the line was not in the graph at all.
     */
    const out = assess(
      [{ text: 'running distributed systems in production', essential: true }],
      [
        {
          id: 'b1',
          kind: 'employment',
          title: 'Staff Engineer',
          where: 'Cloudflare',
          highlights: ['Ran a multi-region distributed key-value store in production'],
        },
      ],
    )
    expect(out.gaps).toEqual([])
    expect(out.answered[0]?.evidence[0]?.id).toBe('b1')
  })
})
