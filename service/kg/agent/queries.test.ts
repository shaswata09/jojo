/**
 * The read surface, over a graph built by the real write tools.
 *
 * Deliberately not over a hand-built snapshot: what these tools return is what a
 * model will reason with, so the records under them have to be the records the
 * app actually writes — with the edges `application.create` really makes and the
 * props it really sets. A fixture would test the fixture.
 */
import { describe, expect, it } from 'vitest'
import { MutableSnapshot } from '../core/snapshot'
import { createRepository } from '../repo/repository'
import { createToolRuntime } from '../tools/runtime'
import { READS, labelOf, render } from './queries'
import type { GraphSnapshot, NodeId, StoredNode } from '../core/model'

const START = Date.parse('2026-08-22T09:00:00.000Z')

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

function harness() {
  let tick = 0
  const now = () => new Date(START + tick++ * 1000).toISOString()
  const repo = createRepository({
    driver: nullDriver() as Parameters<typeof createRepository>[0]['driver'],
    snapshot: new MutableSnapshot(),
    meta: {
      schemaVersion: 1,
      createdAt: new Date(START).toISOString(),
      lastOpenedAt: new Date(START).toISOString(),
      dataSet: 'empty',
      seededAt: null,
    },
    now,
  })
  const runtime = createToolRuntime({ repo, now })
  return { repo, runtime, memory: () => repo.getSnapshot() as GraphSnapshot }
}

/** One application at one organisation, plus a keyword on it. */
function seeded() {
  const h = harness()
  const made = h.runtime.runOrThrow('application.create', {
    org: 'UT Austin',
    role: 'Assistant professor, CS',
    roleTag: 'Assistant Professor',
    stage: 'submitted',
  })
  // The create tools hand back the id itself, not a record.
  const id = made as NodeId
  const keywordId = h.runtime.runOrThrow('keyword.create', {
    name: 'Teaching',
    tone: 'teal',
  }) as NodeId
  h.runtime.runOrThrow('keyword.attach', { keyword: keywordId, record: id })
  return { ...h, id, keywordId }
}

const read = <N extends keyof typeof READS>(
  name: N,
  memory: GraphSnapshot,
  input: unknown,
): unknown => READS[name].read(memory, input as never)

describe('memory.overview', () => {
  it('names only the kinds that have records in them', () => {
    // A model shown eleven types of which eight are zero spends its attention on
    // the eight.
    const { memory } = seeded()
    const out = read('memory.overview', memory(), {}) as {
      counts: Record<string, number>
      total: number
    }
    expect(out.counts).toMatchObject({ application: 1, organisation: 1, keyword: 1 })
    expect(Object.values(out.counts).every((n) => n > 0)).toBe(true)
    expect(out.total).toBe(3)
  })
})

describe('rendering a record for a model', () => {
  it('flattens props to the top level, so no translation step is needed', () => {
    // A model asked to read `result.props.stage` and then pass `stage` to a
    // write tool has to translate, and translation is where small models drop
    // fields.
    const { memory, id } = seeded()
    const node = memory().node(id) as StoredNode
    const out = render(node, memory())
    expect(out.stage).toBe('submitted')
    expect(out).not.toHaveProperty('props')
    expect(out.id).toBe(id)
  })

  it('names an application by role AND organisation', () => {
    // "Assistant professor" is four of the twelve seeded records; the org is one
    // hop away and is what a person would have said.
    const { memory, id } = seeded()
    expect(labelOf(memory().node(id) as StoredNode, memory())).toBe(
      'Assistant professor, CS — UT Austin',
    )
  })
})

describe('memory.get', () => {
  it('returns the record with everything joined to it, in both directions', () => {
    const { memory, id, keywordId } = seeded()
    const out = read('memory.get', memory(), { id }) as {
      found: boolean
      related: { rel: string; direction: string; id: string }[]
    }
    expect(out.found).toBe(true)
    expect(out.related.map((r) => r.rel).sort()).toEqual(['AT', 'TAGS'])
    // The keyword TAGS the application, so from the application it is inbound.
    const tag = out.related.find((r) => r.rel === 'TAGS')
    expect(tag).toMatchObject({ direction: 'in', id: keywordId })
  })

  it('answers a bad id with a sentence rather than throwing', () => {
    // A missing id is the commonest thing a model gets wrong, and it recovers
    // from a sentence far better than from an exception that ends the turn.
    const { memory } = seeded()
    const out = read('memory.get', memory(), { id: 'application:nope' }) as { found: boolean }
    expect(out.found).toBe(false)
  })
})

describe('memory.list', () => {
  it('is newest first, so a truncated list keeps the half that was meant', () => {
    const h = seeded()
    h.runtime.runOrThrow('application.create', {
      org: 'Stripe',
      role: 'ML engineer',
      roleTag: 'ML Engineer',
      stage: 'submitted',
    })
    const out = read('memory.list', h.memory(), { type: 'application' }) as { label: string }[]
    expect(out[0]?.label).toContain('Stripe')
  })

  it('caps the limit so one call cannot spend the whole context window', () => {
    const h = seeded()
    const out = read('memory.list', h.memory(), { type: 'application', limit: 1 }) as unknown[]
    expect(out).toHaveLength(1)
  })
})

describe('memory.search', () => {
  it('finds a record by text in any of its string props, ignoring case', () => {
    const { memory } = seeded()
    const out = read('memory.search', memory(), { query: 'ut austin' }) as { type: string }[]
    expect(out.map((r) => r.type)).toContain('organisation')
  })

  it('finds an application by its employer, which is a separate record', () => {
    // The case a real model hit on its first call: an application's props hold
    // the role, not the employer, and searching "UT Austin" for an application
    // used to come back empty. Four wasted round trips before it recovered.
    const { memory } = seeded()
    const out = read('memory.search', memory(), {
      query: 'UT Austin',
      type: 'application',
    }) as { id: string }[]
    expect(out).toHaveLength(1)
  })

  it('narrows to one kind when asked', () => {
    const { memory } = seeded()
    const out = read('memory.search', memory(), {
      query: 'assistant',
      type: 'application',
    }) as { type: string }[]
    expect(out.every((r) => r.type === 'application')).toBe(true)
  })
})

describe('memory.related', () => {
  it('follows one relation only when given one', () => {
    const { memory, id } = seeded()
    const out = read('memory.related', memory(), { id, rel: 'AT' }) as { type: string }[]
    expect(out).toHaveLength(1)
    expect(out[0]?.type).toBe('organisation')
  })
})

describe('the surface as a whole', () => {
  it('writes nothing — every read leaves the graph byte-identical', () => {
    // The rule tools/index.ts keeps sharp, asserted rather than asserted-in-prose.
    const { memory, repo, id } = seeded()
    const before = JSON.stringify({ n: memory().nodes(), e: memory().edges() })
    read('memory.overview', memory(), {})
    read('memory.list', memory(), { type: 'application' })
    read('memory.get', memory(), { id })
    read('memory.search', memory(), { query: 'a' })
    read('memory.related', memory(), { id })
    const after = JSON.stringify({ n: memory().nodes(), e: memory().edges() })
    expect(after).toBe(before)
    expect(repo.getSnapshot().nodes()).toHaveLength(3)
  })

  it('every read tool answers to the key it is filed under', () => {
    for (const [key, tool] of Object.entries(READS)) expect(tool.name).toBe(key)
  })
})
