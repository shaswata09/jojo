/*
 * The multi-turn agentic benchmark, run against a real model.
 *
 * τ-bench and TaskBench score two different things and both matter here. A run
 * can call every tool the rubric asked for and still leave the store wrong —
 * so the turn axis (did it reach for a defensible tool) and the state axis (is
 * the store what it should be at the end) are scored separately, and `clean`
 * demands both.
 */
import { createRepository } from '../kg/repo/repository'
import { MutableSnapshot } from '../kg/core/snapshot'
import { createToolRuntime } from '../kg/tools/runtime'
import { callTool, type ToolHost } from '../kg/agent/execute'
import { CONVERSATIONS } from '../kg/agent/bench-conversations'
import { WORLD, BENCH_NOW, BENCH_TODAY, DOCUMENTS } from '../kg/agent/bench-world'
import { scoreConversation, type CallRecord, type BenchNode } from '../kg/agent/bench-score'

const ONLY = process.env['BENCH_ONLY']?.split(',').filter(Boolean) ?? null
const LIST = ONLY ? CONVERSATIONS.filter((c) => ONLY.includes(c.id) || ONLY.includes(c.group)) : CONVERSATIONS

const nullDriver = () => ({
  readAll: async () => ({ ok: true as const, value: { nodes: [], edges: [], meta: [], ops: [] } }),
  commit: async () => ({ ok: true as const, value: undefined }),
  replace: async () => ({ ok: true as const, value: undefined }),
  seedIfPristine: async () => ({ ok: true as const, value: true }),
  destroy: async () => ({ ok: true as const, value: undefined }),
  onRemoteCommit: () => () => {},
  onBlocking: () => () => {},
  close: () => {},
})

function freshHost(): { host: ToolHost; nodes: () => BenchNode[] } {
  let tick = 0
  const base = Date.parse(BENCH_NOW)
  const now = () => new Date(base + tick++ * 1000).toISOString()
  const repo = createRepository({
    driver: nullDriver() as never,
    snapshot: new MutableSnapshot(),
    meta: {
      schemaVersion: 1,
      createdAt: BENCH_NOW,
      lastOpenedAt: BENCH_NOW,
      dataSet: 'empty',
      seededAt: null,
      handoverAt: null,
    },
    now,
  })
  const runtime = createToolRuntime({ repo, now })
  const host: ToolHost = {
    memory: () => repo.getSnapshot(),
    today: () => BENCH_TODAY as never,
    check: runtime.check as never,
    run: runtime.run as never,
    convert: async (fileId: string) => {
      const md = (DOCUMENTS as Record<string, string>)[fileId]
      return md === undefined ? { ok: false as const, reason: 'no text' } : { ok: true as const, markdown: md }
    },
  }
  /*
   * The store's shape flattened into what the rubric asks about.
   *
   * A check says `where: {prop: 'org', contains: 'UT Austin'}`, but an
   * application has no `org` prop — the employer is a separate node joined by
   * an `AT` edge, because `application.create` mints the org itself. Same for
   * keywords, which are `TAGS` edges from a keyword node. Reading the store
   * literally and handing the rubric `props` alone makes every such check
   * report "no such record", which reads as a model failure and is a harness
   * bug. Both are resolved here, once, so the rubric can stay declarative.
   */
  const nodes = (): BenchNode[] => {
    const snap = repo.getSnapshot()
    const all = [...snap.nodes()]
    const byId = new Map(all.map((n) => [n.id, n]))
    const nameOf = (id: string): string | null => {
      const n = byId.get(id)
      const p = (n?.props ?? {}) as Record<string, unknown>
      for (const key of ['name', 'title', 'label']) {
        if (typeof p[key] === 'string') return p[key] as string
      }
      return null
    }
    return all.map((n) => {
      const props: Record<string, unknown> = { ...(n.props as Record<string, unknown>) }
      for (const e of snap.out(n.id, 'AT')) {
        const name = nameOf(e.to)
        if (name !== null) props['org'] = name
      }
      const keywords: string[] = []
      for (const e of snap.in(n.id, 'TAGS')) {
        const name = nameOf(e.from)
        if (name !== null) keywords.push(name)
      }
      return { type: n.type, props, keywords }
    })
  }
  return { host, nodes }
}

/** Seed the world through the real tools — no back door into the store. */
async function seed(host: ToolHost) {
  const named = new Map<string, string>()
  const sub = (v: unknown): unknown => {
    if (typeof v === 'string' && v.startsWith('$')) return named.get(v.slice(1)) ?? v
    if (Array.isArray(v)) return v.map(sub)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sub(x)]))
    return v
  }
  for (const step of WORLD) {
    const out = await callTool(host, step.tool, sub(step.input))
    if (!out.ok) throw new Error(`seed ${step.tool}: ${out.error}`)
    if (step.as) {
      // Creating tools return the new id as a bare string; a couple wrap it.
      const r = out.result
      // …and `vault.file.add` takes several files and returns several ids, so
      // an array's FIRST id is what a `$name` referring to it means.
      const id =
        typeof r === 'string'
          ? r
          : Array.isArray(r) && typeof r[0] === 'string'
            ? (r[0] as string)
            : typeof (r as Record<string, unknown> | null)?.['id'] === 'string'
              ? ((r as Record<string, string>)['id'] as string)
              : null
      if (id === null) throw new Error(`seed ${step.tool}: no id in ${JSON.stringify(r).slice(0, 120)}`)
      named.set(step.as, id)
    }
  }
}


const scores = []
for (const c of LIST) {
  const { host, nodes } = freshHost()
  await seed(host)
  const empty = c.turns.map(() => ({ calls: [] as CallRecord[], answered: true }))
  const s = scoreConversation(c, empty, nodes())
  const failed = s.state.filter((x) => !x.pass).length
  scores.push({ id: c.id, group: c.group, checks: s.state.length, failed })
}
const byGroup = new Map()
for (const s of scores) {
  const g = byGroup.get(s.group) ?? { checks: 0, failed: 0 }
  byGroup.set(s.group, { checks: g.checks + s.checks, failed: g.failed + s.failed })
}
for (const [g, v] of byGroup) console.log(`${g.padEnd(14)} ${v.failed}/${v.checks} checks fail on an untouched world`)
const t = scores.reduce((a, s) => ({ checks: a.checks + s.checks, failed: a.failed + s.failed }), { checks: 0, failed: 0 })
console.log(`TOTAL          ${t.failed}/${t.checks}`)
