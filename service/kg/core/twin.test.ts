/**
 * Working out what the app does NOT yet know about the person.
 *
 * This is the half of the twin pipeline that does not need a model, and it
 * exists because absence is the one thing a language model is reliably bad at
 * noticing. Asked "what is missing", it lists what is present. Asked to read
 * the CV it has just been told about, it does that well.
 *
 * So most of these tests are about the boundary: which documents count, which
 * do not, and when the honest answer is that there is nothing to do.
 */

import { describe, expect, it } from 'vitest'
import { MutableSnapshot } from './snapshot'
import type { StoredNode } from './model'
import type { GraphSnapshot } from './snapshot'
import { twinBriefing, twinState } from './twin'

const AT = '2026-09-14T09:00:00.000Z'

const node = (id: string, type: string, props: Record<string, unknown>) =>
  ({ id, type, props, createdAt: AT, updatedAt: AT }) as unknown as StoredNode

function graph(nodes: StoredNode[], edges: { from: string; rel: string; to: string }[] = []) {
  const m = new MutableSnapshot()
  m.reset(
    nodes,
    edges.map((e) => ({
      id: `${e.from}|${e.rel}|${e.to}`,
      rel: e.rel,
      from: e.from,
      to: e.to,
      props: {},
      createdAt: AT,
    })) as never,
  )
  return m as unknown as GraphSnapshot
}

const file = (id: string, name: string) => node(id, 'file', { slug: id, name, kind: 'pdf', bucket: 'Applications', size: '1 KB', savedOn: '2026-09-01' })
const fact = (id: string, kind: string, title: string, source?: string) =>
  node(id, 'background', { slug: id, kind, title, ...(source ? { source } : {}) })

describe('finding the document worth reading', () => {
  it('names a CV nothing has been read from', () => {
    const state = twinState(graph([file('f1', 'CV-2026.pdf')]))
    expect(state.unread).toBe(1)
    expect(state.gaps[0]?.kind).toBe('unread-document')
    expect(state.gaps[0]?.instruction).toContain('vault.file.read')
    expect(state.gaps[0]?.instruction).toContain('profile.background.add')
  })

  it('stops naming it once a fact points back at it', () => {
    /*
     * What `source` is FOR, and the reason the field exists at all. Without it
     * there is no way to ask this question, and the pipeline would re-read the
     * same CV on every round for as long as it stayed enabled — proposing the
     * same thirty facts each time.
     */
    const state = twinState(graph([file('f1', 'CV-2026.pdf'), fact('b1', 'skill', 'Rust', 'f1')]))
    expect(state.unread).toBe(0)
    expect(state.gaps.filter((g) => g.kind === 'unread-document')).toEqual([])
  })

  it('ignores a document that is about an employer rather than the person', () => {
    /*
     * The worst inversion available here. Reading a saved job posting for the
     * person's background files the EMPLOYER's requirements as though they were
     * the person's qualifications — and the resulting record looks exactly like
     * a real one.
     */
    const state = twinState(graph([file('f1', 'Rice-job-posting.pdf'), file('f2', 'Offer-letter.pdf')]))
    expect(state.unread).toBe(0)
  })

  it('ignores a document already filed under an application', () => {
    // A tailored cover letter is about that application. Its facts are the
    // person's only incidentally, and a CV is what sits loose.
    const state = twinState(
      graph(
        [file('f1', 'CV-tailored.pdf'), node('a1', 'application', { slug: 'a1', role: 'x', roleTag: 'Lecturer', stage: 'draft', note: '', lastAction: '', lastActionAt: AT })],
        [{ from: 'f1', rel: 'FILED_UNDER', to: 'a1' }],
      ),
    )
    expect(state.unread).toBe(0)
  })

  it('recognises the other documents a person writes about themselves', () => {
    const state = twinState(
      graph([file('f1', 'Research-statement.pdf'), file('f2', 'Teaching-statement.pdf')]),
    )
    expect(state.unread).toBe(2)
  })
})

describe('connecting what is already known', () => {
  it('notices a skill that is not one of their keywords', () => {
    /*
     * The "connecting" half, and what turns a list of facts into a graph: once
     * "Rust" is a keyword, every application tagged with it is joined to the CV
     * entry that proves it, and a query can walk from a posting's requirement to
     * the evidence for it in one hop.
     */
    const state = twinState(graph([fact('b1', 'skill', 'Rust', 'f1')]))
    const gap = state.gaps.find((g) => g.kind === 'skill-not-keyword')
    expect(gap?.subject).toBe('Rust')
    expect(gap?.instruction).toContain('keyword.create')
  })

  it('says nothing when the keyword already exists, whatever its case', () => {
    const state = twinState(
      graph([fact('b1', 'skill', 'Rust', 'f1'), node('k1', 'keyword', { slug: 'k1', name: 'rust', tone: 'gray' })]),
    )
    expect(state.gaps.filter((g) => g.kind === 'skill-not-keyword')).toEqual([])
  })

  it('does not propose keywords for things that are not skills', () => {
    // A publication title is not a tag. Every paper becoming a keyword would
    // make the keyword list useless for the thing it is for.
    const state = twinState(graph([fact('b1', 'publication', 'Consistent snapshots', 'f1')]))
    expect(state.gaps.filter((g) => g.kind === 'skill-not-keyword')).toEqual([])
  })
})

describe('when there is nothing to do', () => {
  it('says an empty twin with no documents needs one, rather than inventing work', () => {
    const state = twinState(graph([]))
    expect(state.gaps).toHaveLength(1)
    expect(state.gaps[0]?.kind).toBe('no-background')
    expect(state.gaps[0]?.instruction).toContain('rather than guessing')
  })

  it('does not also say that when there IS a document to read', () => {
    // One situation, one fix. Saying both duplicates the instruction and
    // invites the model to answer the wrong half.
    const state = twinState(graph([file('f1', 'CV.pdf')]))
    expect(state.gaps.filter((g) => g.kind === 'no-background')).toEqual([])
  })

  it('returns an empty briefing when a full twin has no gaps, so nothing is appended', () => {
    /*
     * A prompt ending in "here is what is missing:" followed by nothing reads
     * as a truncated instruction, and models treat it as one — which is why
     * this returns a sentence or an empty string and never a bare heading.
     */
    const state = twinState(
      graph([fact('b1', 'skill', 'Rust', 'f1'), node('k1', 'keyword', { slug: 'k1', name: 'Rust', tone: 'gray' })]),
    )
    expect(state.gaps).toEqual([])
    expect(twinBriefing(state)).toContain('nothing obvious is missing')
  })

  it('returns a genuinely empty string for an empty store with nothing to say', () => {
    expect(twinBriefing({ facts: 0, unread: 0, gaps: [] })).toBe('')
  })
})

describe('the briefing', () => {
  it('puts reading a document before rearranging what is known', () => {
    /*
     * Reading is the only operation here that ADDS a fact. Everything else
     * moves existing ones around, and a round that tags three applications
     * while an unread CV sits in the Vault has done the cheap half.
     */
    const state = twinState(graph([file('f1', 'CV.pdf'), fact('b1', 'skill', 'Rust')]))
    expect(state.gaps[0]?.kind).toBe('unread-document')
  })

  it('caps the list, because a model handed forty instructions follows none', () => {
    const files = Array.from({ length: 20 }, (_, i) => file(`f${String(i)}`, `CV-${String(i)}.pdf`))
    expect(twinState(graph(files)).gaps.length).toBeLessThanOrEqual(6)
  })

  it('numbers the gaps so the model can be told to work through them', () => {
    const briefing = twinBriefing(twinState(graph([file('f1', 'CV.pdf')])))
    expect(briefing).toContain('1.')
    expect(briefing).toContain('most useful first')
  })

  it('leads with the fact count once there is one, and counts in English', () => {
    // "holds 1 facts" makes a person trust the rest of the output less — and it
    // goes into a prompt a model then echoes back.
    const one = twinBriefing(twinState(graph([file('f1', 'CV.pdf'), fact('b1', 'skill', 'Go')])))
    expect(one).toContain('1 fact ')
    expect(one).not.toContain('1 facts')

    const two = twinBriefing(
      twinState(graph([file('f1', 'CV.pdf'), fact('b1', 'skill', 'Go'), fact('b2', 'award', 'x')])),
    )
    expect(two).toContain('2 facts')
  })
})

describe('the loop closes', () => {
  /**
   * The property that makes the pipeline safe to leave switched on.
   *
   * A twin pipeline runs on a schedule. If reading a document did not stop it
   * being reported as unread, every round would propose the same thirty facts
   * again — and the person would arrive at a queue of duplicates growing by the
   * hour, which is worse than a pipeline that does nothing.
   *
   * `source` is what closes it, and this is the test that says so.
   */
  it('goes from one gap to none across a read', () => {
    const before = twinState(graph([file('f1', 'CV-2026.pdf')]))
    expect(before.gaps.map((g) => g.kind)).toEqual(['unread-document'])

    // What the pipeline writes: facts that name the document they came from.
    const after = twinState(
      graph([
        file('f1', 'CV-2026.pdf'),
        fact('b1', 'education', 'PhD, Computer Science', 'f1'),
        fact('b2', 'publication', 'Consistent snapshots', 'f1'),
      ]),
    )
    expect(after.unread).toBe(0)
    expect(after.facts).toBe(2)
    expect(after.gaps.filter((g) => g.kind === 'unread-document')).toEqual([])
  })

  it('does not close when the facts forget to say where they came from', () => {
    /*
     * The failure this guards. `profile.background.add` takes `source` as an
     * optional field, because somebody typing a fact by hand has no document —
     * so a model that omits it produces records that look perfectly correct and
     * leave the document eternally unread.
     *
     * The prompt therefore says to pass it on every entry, and this test is why
     * that sentence is not decoration.
     */
    const after = twinState(
      graph([file('f1', 'CV-2026.pdf'), fact('b1', 'education', 'PhD', undefined)]),
    )
    expect(after.unread).toBe(1)
  })

  it('moves on to connecting once the reading is done', () => {
    // The second phase, and it only appears after the first is finished —
    // which is what stops a round tagging applications while a CV sits unread.
    const after = twinState(graph([file('f1', 'CV.pdf'), fact('b1', 'skill', 'Rust', 'f1')]))
    expect(after.gaps.map((g) => g.kind)).toEqual(['skill-not-keyword'])
  })
})
