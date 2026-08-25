/**
 * Relating two records, through the store.
 *
 * `core/claim.test.ts` covers what counts as a duplicate. These are about the
 * part that needs a graph: that the refusal actually stops the write, that both
 * ends get edges, and that a run adding thirty relations sees its own earlier
 * ones — which a cached index would break exactly when it mattered.
 */

import { describe, expect, it } from 'vitest'
import { MutableSnapshot } from '../core/snapshot'
import { createRepository } from '../repo/repository'
import { createToolRuntime } from './runtime'
import type { GraphSnapshot } from '../core/snapshot'
import type { NodeId } from '../core/model'

const NOW = '2026-08-25T09:00:00.000Z'

const nullDriver = () => ({
  open: async () => ({ ok: true as const, value: { version: 1, from: 0, migrated: [], crossTab: false } }),
  readAll: async () => ({ ok: true as const, value: { nodes: [], edges: [], meta: [], ops: [] } }),
  commit: async () => ({ ok: true as const, value: undefined }),
  replace: async () => ({ ok: true as const, value: undefined }),
  seedIfPristine: async () => ({ ok: true as const, value: true }),
  destroy: async () => ({ ok: true as const, value: undefined }),
  onRemoteCommit: () => () => {},
  onBlocking: () => () => {},
  close: () => {},
})

function world() {
  let tick = 0
  const now = () => new Date(Date.parse(NOW) + tick++ * 1000).toISOString()
  const repo = createRepository({
    driver: nullDriver() as Parameters<typeof createRepository>[0]['driver'],
    snapshot: new MutableSnapshot(),
    meta: { schemaVersion: 1, createdAt: NOW, lastOpenedAt: NOW, dataSet: 'user', seededAt: null, handoverAt: null },
    now,
  })
  const runtime = createToolRuntime({ repo, now })

  const background = (kind: string, title: string) => {
    const out = runtime.run('profile.background.add', { background: [{ kind, title }] } as never)
    if (!out.ok) throw new Error('fixture failed')
    return (out.output as NodeId[])[0]!
  }

  const paper = background('publication', 'Consistency without coordination')
  const skill = background('skill', 'Distributed systems')
  const memory = () => repo.getSnapshot() as GraphSnapshot
  return { runtime, memory, paper, skill }
}

const relate = (
  w: ReturnType<typeof world>,
  subject: NodeId,
  predicate: string,
  object: NodeId,
) => w.runtime.run('claim.add', { subject, predicate, object })

describe('recording a relation', () => {
  it('mints a record with an edge at each end', () => {
    /*
     * The reason a claim is a node at all. The ends are EDGES rather than id
     * properties, because they are what traversal walks — "what evidence do I
     * have for this skill" is a graph question only if there is a graph.
     */
    const w = world()
    const out = relate(w, w.paper, 'is evidence of', w.skill)
    expect(out.ok).toBe(true)

    const m = w.memory()
    const claim = m.ofType('claim')[0]
    expect(claim?.props.predicate).toBe('EVIDENCES')
    expect(m.out(claim!.id, 'SUBJECT')[0]?.to).toBe(w.paper)
    expect(m.out(claim!.id, 'OBJECT')[0]?.to).toBe(w.skill)
  })

  it('keeps what the caller actually said', () => {
    // Evidence. Somebody looking at "EVIDENCES" who does not recognise it needs
    // to see that the document said "demonstrates" and that jojo made that
    // mapping — otherwise the relation reads as jojo's opinion.
    const w = world()
    relate(w, w.paper, 'demonstrates', w.skill)
    const claim = w.memory().ofType('claim')[0]
    expect(claim?.props.surface).toBe('demonstrates')
    expect(claim?.props.known).toBe(true)
  })

  it('records an unfamiliar relation and marks it as one', () => {
    const w = world()
    expect(relate(w, w.paper, 'was retracted from', w.skill).ok).toBe(true)
    const claim = w.memory().ofType('claim')[0]
    expect(claim?.props.predicate).toBe('retracted from')
    expect(claim?.props.known).toBe(false)
  })
})

describe('refusing what the graph already holds', () => {
  it('refuses the same fact proposed in different words', () => {
    /*
     * THE requirement. A model reading a CV and then a cover letter proposes
     * the same relation twice, in different words both times. Stored twice, the
     * graph becomes unqueryable — "what evidence have I got" returns one paper
     * under three predicates and no search finds all three.
     */
    const w = world()
    expect(relate(w, w.paper, 'is evidence of', w.skill).ok).toBe(true)
    const second = relate(w, w.paper, 'demonstrates', w.skill)
    expect(second.ok).toBe(false)
    expect(w.memory().ofType('claim')).toHaveLength(1)
  })

  it('names the predicate the graph holds it by', () => {
    // The thing the caller could not have found by searching: they looked for
    // "demonstrates" and the graph says "is evidence of".
    const w = world()
    relate(w, w.paper, 'is evidence of', w.skill)
    const second = relate(w, w.paper, 'demonstrates', w.skill)
    expect(!second.ok && second.errors[0]?.message).toContain('is evidence of')
  })

  it('refuses the fact written backwards', () => {
    const w = world()
    relate(w, w.paper, 'is evidence of', w.skill)
    const inverse = relate(w, w.skill, 'is evidenced by', w.paper)
    expect(inverse.ok).toBe(false)
    expect(w.memory().ofType('claim')).toHaveLength(1)
  })

  it('sees a relation added moments earlier in the same run', () => {
    /*
     * Why the index is rebuilt on every call rather than cached. The agent adds
     * thirty relations in one run; a cached index means the twenty-ninth cannot
     * see the second, which is precisely when deduplication was needed.
     */
    const w = world()
    for (const word of ['built', 'developed', 'worked on', 'created']) {
      relate(w, w.paper, word, w.skill)
    }
    expect(w.memory().ofType('claim')).toHaveLength(1)
  })

  it('still allows a genuinely different relation between the same pair', () => {
    const w = world()
    relate(w, w.paper, 'is evidence of', w.skill)
    expect(relate(w, w.paper, 'is about', w.skill).ok).toBe(true)
    expect(w.memory().ofType('claim')).toHaveLength(2)
  })
})

describe('what it will not relate', () => {
  it('refuses a record to itself', () => {
    const w = world()
    expect(relate(w, w.paper, 'part of', w.paper).ok).toBe(false)
  })

  it('refuses an end that is not in the store', () => {
    // `s.id` checks the shape of an id; only the store knows whether anything
    // answers to it. A claim pointing at nothing is a claim nothing can check.
    const w = world()
    const gone = 'background:00000000-0000-7000-8000-000000000000' as NodeId
    expect(relate(w, w.paper, 'is evidence of', gone).ok).toBe(false)
  })
})
