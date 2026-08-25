/**
 * A CV, all the way to an assessment, with nothing stubbed but the model.
 *
 * Each piece of this has its own tests. This is the seam between them, and the
 * seam is where the previous version of this feature failed: documents could be
 * uploaded, converted to text and read, and the text went nowhere. Every layer
 * worked and the path did not exist.
 *
 * So the model's reply is a fixture and everything after it is real — the
 * parser, the tool, the store, the projection, the scorer. What is asserted is
 * that a person who uploads a CV ends up with a different answer about a
 * posting than a person who does not, which is the entire point of the feature
 * and the one claim no unit test makes.
 */

import { describe, expect, it } from 'vitest'
import { MutableSnapshot } from '../kg/core/snapshot'
import { createRepository } from '../kg/repo/repository'
import { createToolRuntime } from '../kg/tools/runtime'
import type { GraphSnapshot } from '../kg/core/snapshot'
import { readCv } from '../kg/agent/read-cv'
import { assess, type Evidence, type Requirement } from '../kg/core/assess'

const NOW = '2026-09-14T09:00:00.000Z'

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

function store() {
  let tick = 0
  const now = () => new Date(Date.parse(NOW) + tick++ * 1000).toISOString()
  const repo = createRepository({
    driver: nullDriver() as Parameters<typeof createRepository>[0]['driver'],
    snapshot: new MutableSnapshot(),
    meta: { schemaVersion: 1, createdAt: NOW, lastOpenedAt: NOW, dataSet: 'user', seededAt: null, handoverAt: null },
    now,
  })
  return { repo, runtime: createToolRuntime({ repo, now }) }
}

/**
 * What a model actually returns for the benchmark CV.
 *
 * A fixture rather than a live call, because the servers are somebody else's
 * and a test that fails when a GPU is switched off is a test people learn to
 * ignore. The SHAPE is what a real reply looks like — fenced, with prose around
 * it and one unusable row — because those are what the parser exists to survive.
 */
const REPLY = `Here is the extracted data:
\`\`\`json
{"background": [
  {"kind":"education","title":"PhD, Computer Science","where":"University of Illinois","period":"2016–2021","year":2016},
  {"kind":"employment","title":"Postdoctoral Researcher","where":"Carnegie Mellon University","period":"2021–2024","year":2021},
  {"kind":"employment","title":"Research Engineer","where":"Cloudflare","period":"2024–present","year":2024},
  {"kind":"publication","title":"Consistent snapshots without coordination","where":"OSDI","year":2023,"detail":"distributed systems, storage"},
  {"kind":"publication","title":"A cache that admits it is wrong","where":"NSDI","year":2022,"detail":"cache coherence"},
  {"kind":"teaching","title":"Distributed Systems","detail":"graduate course, three years"},
  {"kind":"skill","title":"Rust"},
  {"kind":"hobby","title":"Cycling"}
]}
\`\`\``

const POSTING: Requirement[] = [
  { text: 'research in distributed systems and storage', essential: true },
  { text: 'PhD in computer science or a related field', essential: true },
  { text: 'experience teaching graduate courses', essential: true },
  { text: 'FPGA and hardware design', essential: false },
]

/** The store's own records, in the shape the scorer takes. */
const evidenceFrom = (m: GraphSnapshot): Evidence[] =>
  m.ofType('background').map((n) => ({
    id: n.id,
    kind: n.props.kind,
    title: n.props.title,
    where: n.props.where,
    detail: n.props.detail,
    year: n.props.year,
  }))

describe('a CV, read and then used', () => {
  it('lands in the graph as records the app can query', () => {
    const { repo, runtime } = store()
    const read = readCv(REPLY)
    expect(read.ok).toBe(true)
    if (!read.ok) return

    // The unusable row is dropped and the other seven survive, which is the
    // whole reason entries are validated one at a time.
    expect(read.background).toHaveLength(7)
    expect(read.skipped[0]).toContain('hobby')

    const out = runtime.run('profile.background.add', { background: [...read.background] })
    expect(out.ok).toBe(true)

    const m = repo.getSnapshot() as GraphSnapshot
    expect(m.ofType('background')).toHaveLength(7)
    // Not a blob of text on the profile: seven separate records, each with a
    // kind, that a query can filter and a screen can list.
    expect(m.ofType('background').filter((n) => n.props.kind === 'publication')).toHaveLength(2)
  })

  it('changes the answer about a posting, which is the point', () => {
    /*
     * THE assertion. Before this feature, somebody with a CV in the Vault got
     * exactly the same answer as somebody with nothing — the document was in
     * the app and not in the graph, so nothing could score against it.
     */
    const { repo, runtime } = store()
    const empty = assess(POSTING, evidenceFrom(repo.getSnapshot() as GraphSnapshot))
    expect(empty.score).toBeNull()

    const read = readCv(REPLY)
    if (!read.ok) return
    runtime.run('profile.background.add', { background: [...read.background] })

    const scored = assess(POSTING, evidenceFrom(repo.getSnapshot() as GraphSnapshot))
    expect(scored.score).not.toBeNull()
    expect(scored.score!).toBeGreaterThan(0)
  })

  it('names the record behind each requirement it says is met', () => {
    // A claim about somebody's background that cannot be traced to the line it
    // came from is a claim they cannot check.
    const { repo, runtime } = store()
    const read = readCv(REPLY)
    if (!read.ok) return
    runtime.run('profile.background.add', { background: [...read.background] })

    const m = repo.getSnapshot() as GraphSnapshot
    const scored = assess(POSTING, evidenceFrom(m))
    const systems = scored.answered.find((a) => a.requirement.text.includes('distributed systems'))
    expect(systems?.evidence.length).toBeGreaterThan(0)

    // The id points at a real record, not at a paraphrase.
    const cited = systems!.evidence[0]!.id
    expect(m.node(cited, 'background')).toBeDefined()
  })

  it('reports the requirement nothing answers, and does not invent one', () => {
    const { repo, runtime } = store()
    const read = readCv(REPLY)
    if (!read.ok) return
    runtime.run('profile.background.add', { background: [...read.background] })

    const scored = assess(POSTING, evidenceFrom(repo.getSnapshot() as GraphSnapshot))
    expect(scored.gaps.map((g) => g.requirement.text)).toEqual(['FPGA and hardware design'])
  })

  it('says what to lead with, drawn from what this employer asked about', () => {
    const { repo, runtime } = store()
    const read = readCv(REPLY)
    if (!read.ok) return
    runtime.run('profile.background.add', { background: [...read.background] })

    const m = repo.getSnapshot() as GraphSnapshot
    const scored = assess(POSTING, evidenceFrom(m))
    expect(scored.lead.length).toBeGreaterThan(0)
    // Every suggestion is a record they actually hold.
    for (const e of scored.lead) expect(m.node(e.id, 'background')).toBeDefined()
  })
})
