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
  ctx: Parameters<(typeof READS)[N]['read']>[2] = {},
): unknown => READS[name].read(memory, input as never, ctx)

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

describe('reading a document', () => {
  const aFile = (h: ReturnType<typeof seeded>) =>
    h.runtime.runOrThrow('vault.file.add', {
      files: [{ name: 'Rice-posting.pdf', kind: 'doc', bucket: 'Applications', size: '210 KB' }],
    }) as NodeId[]

  it('says what to install when no reader is connected, rather than failing', async () => {
    // A model that keeps trying and a user who never learns why is the failure
    // this refusal exists to avoid.
    const h = seeded()
    const [id] = aFile(h)
    const out = (await read('vault.file.read', h.memory(), { id })) as {
      ok: boolean
      hint: string
    }
    expect(out.ok).toBe(false)
    expect(out.hint).toContain('Settings')
  })

  it('hands back the Markdown, with the document’s own name beside it', async () => {
    const h = seeded()
    const [id] = aFile(h)
    const out = (await read('vault.file.read', h.memory(), { id }, {
      convert: () => Promise.resolve({ ok: true as const, markdown: '# Rice\n\nStatistics.' }),
    })) as { ok: boolean; name: string; markdown: string }
    // The name matters: an answer about "the document" is unverifiable, and an
    // answer about Rice-posting.pdf is not.
    expect(out).toMatchObject({ ok: true, name: 'Rice-posting.pdf' })
    expect(out.markdown).toContain('Statistics')
  })

  it('passes a converter’s refusal through as a reason', async () => {
    const h = seeded()
    const [id] = aFile(h)
    const out = (await read('vault.file.read', h.memory(), { id }, {
      convert: () => Promise.resolve({ ok: false as const, reason: 'File is encrypted' }),
    })) as { ok: boolean; hint: string }
    expect(out).toMatchObject({ ok: false, hint: 'File is encrypted' })
  })

  it('answers a bad id with a sentence rather than throwing', async () => {
    const h = seeded()
    const out = (await read('vault.file.read', h.memory(), { id: 'file:nope' })) as { ok: boolean }
    expect(out.ok).toBe(false)
  })
})

describe('reading a job board', () => {
  const board = READS['board.search']
  const memory = new MutableSnapshot()

  /** A scan port that answers with whatever it is given. */
  const scanning = (rows: unknown) => ({
    scan: async () => ({ ok: true as const, rows }),
  })

  /*
   * The refusal, not the failure. `vault.file.read` established the pattern and
   * the reason is the same: a model told "that went wrong" retries, and a model
   * told "nothing here can browse" stops and works from the records instead.
   */
  it('refuses with a sentence when nothing can reach a board', async () => {
    const out = (await board.read(memory, { url: 'https://a.test/jobs' }, {})) as {
      ok: boolean
      hint: string
    }
    expect(out.ok).toBe(false)
    expect(out.hint).toContain('browser extension')
  })

  it('refuses prose rather than fetching something it invented', async () => {
    const out = (await board.read(
      memory,
      { url: 'the CRA job board' },
      scanning([]),
    )) as { ok: boolean; hint: string }
    expect(out.ok).toBe(false)
    expect(out.hint).toContain('not an address')
  })

  it('passes the scanner’s own reason through when a board refuses', async () => {
    const out = (await board.read(memory, { url: 'https://a.test/jobs' }, {
      scan: async () => ({ ok: false as const, reason: 'That board wants a sign-in.' }),
    })) as { ok: boolean; hint: string }
    expect(out.ok).toBe(false)
    expect(out.hint).toBe('That board wants a sign-in.')
  })

  /*
   * The whole point of the split: the scanner over-collects and this vets. Only
   * the posting survives — the index page, the social link and the policy page
   * are what a real board surrounds its listings with.
   */
  it('keeps the postings and throws away the rest of the page', async () => {
    const out = (await board.read(
      memory,
      { url: 'https://a.test/jobs' },
      scanning([
        { url: '/jobs/4021234567', title: 'Research Engineer', org: 'Northwind' },
        { url: '/jobs', title: 'All openings' },
        { url: '/about', title: 'About us' },
        { url: 'https://twitter.com/northwind', title: 'Follow us' },
      ]),
    )) as { ok: boolean; count: number; postings: { url: string; title: string }[] }

    expect(out.ok).toBe(true)
    expect(out.count).toBe(1)
    expect(out.postings[0]?.title).toBe('Research Engineer')
    expect(out.postings[0]?.url).toBe('https://a.test/jobs/4021234567')
  })

  /*
   * An empty board and an unreadable board look identical from here, and the
   * model does different things with them — so the difference is said out loud
   * rather than left to be inferred from a zero.
   */
  it('says so when a page listed nothing it could read', async () => {
    const out = (await board.read(memory, { url: 'https://a.test/jobs' }, scanning([]))) as {
      ok: boolean
      count: number
      hint?: string
    }
    expect(out.ok).toBe(true)
    expect(out.count).toBe(0)
    expect(out.hint).toContain('render its results')
  })

  it('survives a scanner that answers with nonsense', async () => {
    for (const rows of [null, 'nope', [null, 42, { url: 5 }]]) {
      const out = (await board.read(memory, { url: 'https://a.test/jobs' }, scanning(rows))) as {
        ok: boolean
        count: number
      }
      expect(out.ok).toBe(true)
      expect(out.count).toBe(0)
    }
  })

  it('is offered to the model as a read, so it never counts as work done', () => {
    expect(board.effect).toBe('read')
  })
})
