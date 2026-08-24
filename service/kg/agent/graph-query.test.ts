/**
 * The query engine, over a graph built by the real write tools.
 *
 * The questions asserted here are the ones the Graph page has always claimed to
 * answer — "applications with no follow-up scheduled" first, because that is the
 * gap that costs people interviews and it is the one a list cannot express.
 */
import { describe, expect, it } from 'vitest'
import { MutableSnapshot } from '../core/snapshot'
import { createRepository } from '../repo/repository'
import { createToolRuntime } from '../tools/runtime'
import type { GraphSnapshot } from '../core/snapshot'
import type { NodeId } from '../core/model'
import { runGraphQuery } from './graph-query'
import type { GraphQuery } from './graph-query'

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

/** Two applications; one has a follow-up, the other has nothing. */
function world() {
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
  const rt = createToolRuntime({ repo, now })
  const austin = rt.runOrThrow('application.create', {
    org: 'UT Austin',
    role: 'Assistant professor, CS',
    roleTag: 'Assistant Professor',
    stage: 'submitted',
  }) as NodeId
  const stripe = rt.runOrThrow('application.create', {
    org: 'Stripe',
    role: 'ML engineer',
    roleTag: 'ML Engineer',
    stage: 'interview',
  }) as NodeId
  rt.runOrThrow('timeline.item.create', {
    title: 'Chase the committee',
    date: '2026-09-01',
    kind: 'follow-up',
    urgency: 'amber',
    applicationIds: [austin],
  })
  const kw = rt.runOrThrow('keyword.create', { name: 'Teaching', tone: 'teal' }) as NodeId
  rt.runOrThrow('keyword.attach', { keyword: kw, record: austin })
  return { memory: () => repo.getSnapshot() as GraphSnapshot, austin, stripe, kw }
}

const ask = (memory: GraphSnapshot, q: GraphQuery) => runGraphQuery(memory, q)

describe('the question a list cannot express', () => {
  it('finds applications with no follow-up scheduled', () => {
    const w = world()
    const out = ask(w.memory(), {
      kind: 'pattern',
      start: 'application',
      quantifier: 'missing',
      rel: 'ABOUT',
      end: 'timelineItem',
      endFacet: 'follow-up',
    })
    expect(out.rows).toHaveLength(1)
    expect(out.rows[0]?.record.id).toBe(w.stripe)
    // A `missing` row has nothing to show, and that IS the finding.
    expect(out.rows[0]?.matched).toEqual([])
    // The FACET has to be in the sentence. Without it this read "9 applications
    // with no timeline items", which is a true count under a false description —
    // only three applications have no timeline item at all.
    expect(out.summary).toBe('1 application with no follow-up timeline items by ABOUT.')
  })

  it('finds the ones that DO have one, which is the complement', () => {
    const w = world()
    const out = ask(w.memory(), {
      kind: 'pattern',
      start: 'application',
      quantifier: 'has',
      rel: 'ABOUT',
      end: 'timelineItem',
      endFacet: 'follow-up',
    })
    expect(out.rows.map((r) => r.record.id)).toEqual([w.austin])
    expect(out.rows[0]?.matched).toHaveLength(1)
  })
})

describe('facets', () => {
  it('separates a kind of item from a reminder, which are different axes', () => {
    const w = world()
    const byKind = ask(w.memory(), {
      kind: 'pattern',
      start: 'timelineItem',
      startFacet: 'follow-up',
      quantifier: 'has',
      rel: 'any',
      end: 'any',
    })
    expect(byKind.rows).toHaveLength(1)
    const byReminder = ask(w.memory(), {
      kind: 'pattern',
      start: 'timelineItem',
      startFacet: 'reminder',
      quantifier: 'has',
      rel: 'any',
      end: 'any',
    })
    expect(byReminder.rows).toHaveLength(0)
  })

  it('fails a facet on a type that cannot have one, rather than ignoring it', () => {
    // "Interviews that are files" is a question with a real answer: none.
    const w = world()
    const out = ask(w.memory(), {
      kind: 'pattern',
      start: 'application',
      startFacet: 'interview',
      quantifier: 'has',
      rel: 'any',
      end: 'any',
    })
    expect(out.rows).toEqual([])
  })
})

describe('keywords, by name', () => {
  it('narrows to records carrying a keyword the user said out loud', () => {
    // By name rather than id: a keyword is the one record a person names in the
    // question itself, and an id lookup would be a round trip for a word they
    // already gave us.
    const w = world()
    const out = ask(w.memory(), {
      kind: 'pattern',
      start: 'application',
      quantifier: 'has',
      rel: 'AT',
      end: 'organisation',
      keyword: 'teaching',
    })
    expect(out.rows.map((r) => r.record.id)).toEqual([w.austin])
  })

  it('says a keyword does not exist, rather than reporting nobody has it', () => {
    // Found by asking the real model for "applications tagged Teaching" against
    // a store with six other keywords: "0 applications" reads as a fact about
    // the applications when it is a fact about the word.
    const w = world()
    const out = ask(w.memory(), {
      kind: 'pattern',
      start: 'application',
      quantifier: 'has',
      rel: 'any',
      end: 'any',
      keyword: 'Bookbinding',
    })
    expect(out.rows).toEqual([])
    expect(out.summary).toBe('There is no keyword called "Bookbinding".')
  })
})

describe('atLeast', () => {
  it('counts, and defaults to two', () => {
    const w = world()
    const out = ask(w.memory(), {
      kind: 'pattern',
      start: 'application',
      quantifier: 'atLeast',
      rel: 'any',
      end: 'any',
    })
    // Austin has an org, a follow-up and a keyword; Stripe has only an org.
    expect(out.rows.map((r) => r.record.id)).toEqual([w.austin])
  })
})

describe('paths', () => {
  it('joins two records named in words, not by id', () => {
    // 'UT Austin' is an organisation's own label; 'Teaching' is a keyword's.
    // Neither is an id, and the path between them runs through the application.
    const w = world()
    const out = ask(w.memory(), { kind: 'path', from: 'UT Austin', to: 'Teaching' })
    expect(out.rows.map((r) => r.record.id)).toEqual([
      expect.stringContaining('org:') as unknown as string,
      w.austin,
      w.kw,
    ])
    expect(out.summary).toContain('2 steps apart')
    // Every hop after the first says which relationship got there.
    expect(out.rows.slice(1).map((r) => r.via)).toEqual(['AT', 'TAGS'])
  })

  it('matches a label by substring when nothing matches it exactly', () => {
    // 'ML engineer' is not any record's whole label; it is most of one.
    const w = world()
    const out = ask(w.memory(), { kind: 'path', from: 'ML engineer', to: 'Stripe' })
    expect(out.rows[0]?.record.id).toBe(w.stripe)
  })

  it('says which name matched nothing, rather than "no results"', () => {
    // A path that failed on a name is a different answer from one that failed
    // because the records are genuinely unconnected.
    const w = world()
    const out = ask(w.memory(), { kind: 'path', from: 'Stripe', to: 'Zzyzx' })
    expect(out.summary).toContain('Zzyzx')
    expect(out.highlight).toEqual([])
  })

  it('reports two real records that are not connected as exactly that', () => {
    // This world has two components: the Stripe application reaches only its
    // organisation, and the Teaching keyword sits on the other one. Saying "not
    // connected" is a finding; saying "no results" would hide it.
    const w = world()
    const out = ask(w.memory(), { kind: 'path', from: 'Stripe', to: 'Teaching' })
    expect(out.rows).toEqual([])
    expect(out.summary).toContain('are not connected')
    // Both ends still light up, so the canvas shows what was asked about.
    expect(out.highlight).toHaveLength(2)
  })
})

describe('what a canvas needs', () => {
  it('returns every id involved, so a drawing can highlight the subgraph', () => {
    const w = world()
    const out = ask(w.memory(), {
      kind: 'pattern',
      start: 'application',
      quantifier: 'has',
      rel: 'AT',
      end: 'organisation',
    })
    expect(out.highlight.length).toBe(4)
    expect(out.highlight).toContain(w.austin)
  })

  it('names a reminder facet as an adjective, so it reads as English', () => {
    const w = world()
    expect(
      ask(w.memory(), {
        kind: 'pattern',
        start: 'application',
        quantifier: 'missing',
        rel: 'ABOUT',
        end: 'timelineItem',
        endFacet: 'reminder',
      }).summary,
    ).toContain('no reminding timeline items')
  })

  it('answers in prose, so the model can say it without re-deriving it', () => {
    const w = world()
    expect(
      ask(w.memory(), {
        kind: 'pattern',
        start: 'application',
        quantifier: 'missing',
        rel: 'FILED_UNDER',
        end: 'file',
      }).summary,
    ).toBe('2 applications with no files by FILED_UNDER.')
  })
})

describe('it never writes', () => {
  it('leaves the graph byte-identical', () => {
    const w = world()
    const before = JSON.stringify({ n: w.memory().nodes(), e: w.memory().edges() })
    ask(w.memory(), { kind: 'pattern', start: 'any', quantifier: 'has', rel: 'any', end: 'any' })
    ask(w.memory(), { kind: 'path', from: 'Stripe', to: 'Teaching' })
    expect(JSON.stringify({ n: w.memory().nodes(), e: w.memory().edges() })).toBe(before)
  })
})

describe('a path query missing an endpoint', () => {
  /**
   * `from` and `to` are optional on the schema the model is handed — one input
   * shape serves both query kinds — while `PathQuery` declared them required.
   * So `{"kind":"path"}` parsed, and `resolve` called `.trim()` on undefined.
   *
   * A read tool that throws is worse than one that answers badly: `execute`
   * promises reads never throw, so nothing above catches it, and the thread it
   * was running in could not be recovered. The Graph page offers this tool and
   * suggests exactly the kind of question that produces it.
   */
  it('is answered, not thrown', () => {
    const memory = new MutableSnapshot([], []) as unknown as GraphSnapshot
    for (const q of [
      { kind: 'path' },
      { kind: 'path', from: 'Rice' },
      { kind: 'path', to: 'Rice' },
      { kind: 'path', from: '   ', to: 'Rice' },
    ] as GraphQuery[]) {
      expect(() => runGraphQuery(memory, q)).not.toThrow()
      const result = runGraphQuery(memory, q)
      expect(result.rows).toEqual([])
      expect(result.summary).toContain('two records')
    }
  })
})
