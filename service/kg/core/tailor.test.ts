/**
 * Turning a measurement into advice, without inventing any of it.
 *
 * `assess.test.ts` covers whether the arithmetic is right. These are about the
 * layer where the temptation to be encouraging lives: a verdict, a list of
 * things to lead with, and a list of things to be ready for. Every one of them
 * has to be traceable to a record or a requirement, and the tests below are
 * mostly about the cases where the honest output is worse news than the number
 * on its own would suggest.
 */

import { describe, expect, it } from 'vitest'
import { assess } from './assess'
import type { Evidence, Requirement } from './assess'
import { guidanceFrom, VERDICT_LABEL } from './tailor'

const need = (text: string, essential = true): Requirement => ({ text, essential })
const want = (text: string): Requirement => ({ text, essential: false })

const record = (id: string, kind: string, title: string, detail?: string): Evidence => ({
  id,
  kind,
  title,
  ...(detail === undefined ? {} : { detail }),
})

describe('when there is nothing to measure', () => {
  it('says so rather than reporting a bad fit', () => {
    /*
     * The distinction `assess` protects by returning null instead of zero, and
     * it has to survive this layer. Somebody who has not uploaded a CV has not
     * scored badly against a posting — and telling them "a stretch" would be
     * telling them something false about themselves on the basis of no data.
     */
    const g = guidanceFrom(assess([need('distributed systems')], []))
    expect(g.verdict).toBe('not-measured')
    expect(g.tailor).toEqual([])
    expect(g.prepare).toEqual([])
  })

  it('says what to do about it, and it is not "apply anyway"', () => {
    const g = guidanceFrom(assess([], []))
    expect(g.summary).toMatch(/Vault/)
    expect(g.summary).toMatch(/profile pipeline/)
  })
})

describe('the verdict', () => {
  const strongBackground = [
    record('b1', 'education', 'PhD in Computer Science', 'distributed systems'),
    record('b2', 'publication', 'Consensus under partial synchrony', 'OSDI'),
    record('b3', 'skill', 'Rust'),
  ]

  it('calls it strong when the record answers what was asked', () => {
    const g = guidanceFrom(
      assess([need('PhD in Computer Science'), need('distributed systems')], strongBackground),
    )
    expect(g.verdict).toBe('strong')
  })

  it('caps the verdict when something stated as REQUIRED is missing', () => {
    /*
     * The one rule in this file that overrides the arithmetic, and the reason
     * it exists: a score can be respectable while the single thing the posting
     * says it requires has nothing behind it — meeting every preference and no
     * requirement. Reporting that as "worth tailoring" is defensible arithmetic
     * and terrible advice.
     */
    const g = guidanceFrom(
      assess(
        [
          need('active security clearance'),
          want('Rust'),
          want('distributed systems'),
          want('publication record'),
        ],
        strongBackground,
      ),
    )
    expect(g.prepare.some((p) => p.essential)).toBe(true)
    expect(g.verdict).toBe('a-stretch')
  })

  it('leaves it at worth-tailoring when every gap is only preferred', () => {
    // The other side of the same rule. Missing a nice-to-have is not the news
    // that missing a requirement is, and flattening the two would make the
    // verdict useless for deciding how to spend an evening.
    const g = guidanceFrom(
      assess([need('distributed systems'), want('Kubernetes at scale')], strongBackground),
    )
    expect(g.prepare.map((p) => p.essential)).toEqual([false])
    expect(g.verdict).toBe('worth-tailoring')
  })

  it('never puts a percentage in the sentence', () => {
    /*
     * A person is making a three-way choice. A number in the sentence invites
     * them to read the difference between 61% and 68% as meaning something,
     * and it does not — the score stays available beside it for anyone who
     * wants it.
     */
    for (const requirements of [
      [need('distributed systems')],
      [need('quantum optics')],
      [want('Kubernetes')],
    ]) {
      expect(guidanceFrom(assess(requirements, strongBackground)).summary).not.toMatch(/\d+%/)
    }
  })

  it('names the reason, so the sentence can be disagreed with', () => {
    const g = guidanceFrom(
      assess([need('distributed systems'), need('Rust')], strongBackground),
    )
    // "2 of 2" is checkable against the list underneath. "A strong fit" is a
    // horoscope, and reads the same whatever is in the graph.
    expect(g.summary).toMatch(/\d+ of \d+/)
  })

  it('has a label for every verdict it can return', () => {
    // The exhaustive Record is the compile-time half; this is the half that
    // catches a label left as an empty string.
    for (const label of Object.values(VERDICT_LABEL)) expect(label.length).toBeGreaterThan(0)
  })
})

describe('what to lead with', () => {
  it('pairs each record with the requirement it answers', () => {
    /*
     * The pair is the whole value. "Lead with your OSDI paper" is a suggestion;
     * "lead with your OSDI paper — it is what answers their distributed systems
     * requirement" is something somebody can follow into a cover letter.
     */
    const g = guidanceFrom(
      assess(
        [need('distributed systems'), need('Rust')],
        [
          record('b1', 'publication', 'Consensus under partial synchrony', 'distributed systems'),
          record('b2', 'skill', 'Rust'),
        ],
      ),
    )
    const paper = g.tailor.find((t) => t.evidence.id === 'b1')
    expect(paper?.answers).toBe('distributed systems')
    expect(g.tailor.find((t) => t.evidence.id === 'b2')?.answers).toBe('Rust')
  })

  it('keeps everything the assessment put on the lead list', () => {
    /*
     * A regression this file already had once. An entry can reach `lead` by
     * being the second-best answer to several requirements without ever topping
     * one, and pairing on rank 0 alone dropped it — silently shortening the
     * list of things to lead with, which is the output somebody came for.
     */
    const background = [
      record('b1', 'employment', 'Staff engineer', 'distributed systems and Rust services'),
      record('b2', 'publication', 'Consensus under partial synchrony', 'distributed systems'),
      record('b3', 'skill', 'Rust'),
    ]
    const a = assess([need('distributed systems'), need('Rust')], background)
    const g = guidanceFrom(a)
    expect(g.tailor.map((t) => t.evidence.id)).toEqual(a.lead.map((e) => e.id))
  })

  it('names the requirement the entry answers best, not the first one it touched', () => {
    /*
     * One line of a CV usually answers several sentences of a posting, and the
     * one worth naming is the one that carries weight — a required "distributed
     * systems in Rust" over a preferred "Rust". Naming whichever requirement
     * happened to be read first would put a nice-to-have in the cover-letter
     * advice while the requirement it actually satisfies goes unmentioned.
     *
     * The preferred requirement is deliberately listed FIRST, so the order of
     * the posting cannot be what makes this pass.
     */
    const g = guidanceFrom(
      assess(
        [want('Rust'), need('distributed systems in Rust')],
        [record('b1', 'employment', 'Staff engineer', 'distributed systems in Rust')],
      ),
    )
    expect(g.tailor[0]?.answers).toBe('distributed systems in Rust')
  })

  it('is empty when nothing matched, rather than falling back to what is impressive', () => {
    // The best paper in somebody's record is not the one to lead with if this
    // employer never asked about the subject.
    const g = guidanceFrom(
      assess([need('quantum optics')], [record('b1', 'publication', 'Consensus under partial synchrony')]),
    )
    expect(g.tailor).toEqual([])
  })
})

describe('what to prepare for', () => {
  it('carries every gap through with its advice', () => {
    const g = guidanceFrom(
      assess(
        [need('active security clearance'), want('Kubernetes at scale')],
        [record('b1', 'skill', 'Rust')],
      ),
    )
    expect(g.prepare.map((p) => p.requirement)).toEqual([
      'active security clearance',
      'Kubernetes at scale',
    ])
  })

  it('leaves room for "you have this and it is not written down"', () => {
    /*
     * The distinction `assess` refuses to collapse, restated here because this
     * is the layer a person actually reads. A gap means the RECORD does not
     * answer the requirement — the commonest cause by a wide margin is a CV
     * that never mentioned it, and that is the reading somebody can act on
     * tonight.
     */
    const g = guidanceFrom(assess([need('Kubernetes')], [record('b1', 'skill', 'Rust')]))
    expect(g.prepare[0]?.advice).toMatch(/on the CV/i)
  })

  it('puts the required ones first', () => {
    // Inherited from `assess`, asserted here because the screen renders this
    // list in order and the first line is the one that gets read.
    const g = guidanceFrom(
      assess(
        [want('Kubernetes at scale'), need('active security clearance')],
        [record('b1', 'skill', 'Rust')],
      ),
    )
    expect(g.prepare.map((p) => p.essential)).toEqual([true, false])
  })
})
