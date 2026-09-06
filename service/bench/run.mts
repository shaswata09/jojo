/*
 * The multi-turn agentic benchmark, run against a real model.
 *
 * τ-bench and TaskBench score two different things and both matter here. A run
 * can call every tool the rubric asked for and still leave the store wrong —
 * so the turn axis (did it reach for a defensible tool) and the state axis (is
 * the store what it should be at the end) are scored separately, and `clean`
 * demands both.
 *
 * ## What this file is careful about, in one place
 *
 * Three things, each learned from a published number that turned out to
 * describe the wrong thing:
 *
 *   1. THE MODEL CALL GOES THROUGH `model-server.ts`. This file used to build its
 *      own `fetch` to `/chat/completions`, so the thinking control and the
 *      empty-turn retry that the dialect layer carries were never exercised by
 *      a benchmark run, and `setup` could not even say which thinking mode a
 *      number was measured under. Same class of divergence as the document
 *      reader bug in `freshHost`: the offline suite and the live runner
 *      disagreeing about what the agent can do. `BENCH_TRANSPORT=raw` keeps the
 *      old path for bisecting a regression in the dialect layer itself.
 *
 *   2. EVERY SWITCH IS PROVEN BEFORE THE NETWORK IS TOUCHED. The loop has no
 *      option for turning off argument repair, stuck detection or the verify
 *      gate — it imports them and calls them — so an ablation has to replace
 *      the module. `proveSwitches` drives the real `runAgent` with a scripted
 *      model, once per switch, and refuses to start if a switch did not reach
 *      the loop. This project has shipped inert tests; it is not going to ship
 *      an inert ablation.
 *
 *   3. NOISE IS MEASURED, NOT ASSERTED. The README said "two or three
 *      conversations is inside the margin" on the strength of one rerun.
 *      `BENCH_RUNS=N` repeats every conversation and writes the spread.
 */
import { writeFileSync } from 'node:fs'
import { register } from 'node:module'
import { createRepository } from '../kg/repo/repository'
import { MutableSnapshot } from '../kg/core/snapshot'
import { createToolRuntime } from '../kg/tools/runtime'
import { callTool, type ToolHost } from '../kg/agent/execute'
import { CATALOG } from '../kg/agent/catalog'
import type { AgentEvent, AgentRun, AgentStep, runAgent as runAgentType } from '../kg/agent/loop'
import {
  DEFAULT_THINKING,
  THINKING_MODES,
  chatRequest,
  guardTruncation,
  readTurnFor,
  sendTurn,
  unreachable,
  type ChatMessage,
  type ModelRequest,
  type ModelResponse,
  type Thinking,
  type ToolCall,
  type Turn,
} from '../kg/core/model-server'
import type { ModelSettings } from '../kg/core/provider'
import { CONVERSATIONS } from '../kg/agent/bench-conversations'
import { WORLD, BENCH_NOW, BENCH_TODAY, readDocument } from '../kg/agent/bench-world'
import {
  scoreConversation,
  summarise,
  type BenchNode,
  type CallRecord,
  type RunTelemetry,
  type StoppedBy,
} from '../kg/agent/bench-score'
import { RESERVED_FOR_REPLY, fitHistory, type Trimmed } from '../kg/agent/budget'
import { LEDGER_HEADING, MIN_SUMMARY_CHARS } from '../kg/agent/compact'
import { approvalOf } from '../kg/core/model'
import {
  INJECTION_TARGETS,
  createPrng,
  faultCall,
  injectResult,
  seedFor,
  type FaultKind,
  type Prng,
} from './faults.mts'

const URL = process.env['BENCH_URL']!
const MODEL = process.env['BENCH_MODEL']!
const OUT = process.env['BENCH_OUT']!

const ONLY = process.env['BENCH_ONLY']?.split(',').filter(Boolean) ?? null

/** The completion cap. 0 (the default) omits it, which is what production does. */
const MAX_TOKENS = Number(process.env['BENCH_MAX_TOKENS'] ?? 0) || 0

/*
 * The configuration, read once and WRITTEN OUT with the scores.
 *
 * A number and the setup it was measured under are one fact, and this file used
 * to publish only the number. That is how a table ends up mixed: three models
 * measured months and configurations apart, all rendered in one grid as though
 * they answered the same question. `publish.mjs` refuses to build a payload
 * from rows that disagree here, which is only possible because the rows carry
 * it — and it is why every switch below is in `setup`: an ablation run is
 * un-publishable next to a baseline by construction, which is correct.
 */
const HARNESS = process.env['BENCH_HARNESS'] !== '0'
const WINDOW = Number(process.env['BENCH_WINDOW'] ?? 0) || 32_768

/**
 * A conversation, plus the two knobs a case may set on this runner.
 *
 * `window` is the context window for THAT conversation, in tokens — the loop's
 * `window` for it, with `BENCH_WINDOW` standing for every case that names
 * none. It exists because the endurance cases were measured at 32k and never
 * compacted: the world plus the full catalogue is ~17k prompt tokens on turn
 * one, the loop compacts at a third of the window (`budget.ts`
 * `COMPACT_TARGET`), and 32k therefore never trips it — 0 compactions in 16 of
 * 18 model×case cells, 1 in the other two. A case whose whole point is "the
 * early fact survives the summary" was scoring a run in which no summary was
 * ever written.
 *
 * `truncateFirstCall` makes the runner cut the FIRST tool call of that
 * conversation off at the model's output limit — `finish_reason: 'length'`,
 * arguments ending mid-string — so the loop's "send the same call again with
 * FEWER items" path is exercised on purpose. Before this, `run.mts` mentioned
 * truncation only in comments and no case forced it.
 *
 * An intersection over the fixture's own type rather than a read of two fields
 * on it, because the fields land in `bench-conversations.ts` with the cases
 * that use them; a runner that read `c.window` off the base type would not
 * compile until then, and one that waited would ship the knob and the cases
 * as one un-bisectable change. Once the fixture type carries them the
 * intersection is a no-op.
 */
type Case = (typeof CONVERSATIONS)[number] & {
  readonly window?: number
  readonly truncateFirstCall?: true
}
const LIST: readonly Case[] = ONLY
  ? CONVERSATIONS.filter((c) => ONLY.includes(c.id) || ONLY.includes(c.group))
  : CONVERSATIONS

/** The window this case runs under: its own, else the run's. */
const windowFor = (c: Case): number => c.window ?? WINDOW

/**
 * Which code builds the request and reads the reply.
 *
 * `dialect` — the default — is `chatRequest` → `fetch` → `readTurnFor` →
 * `guardTruncation`, wrapped in `sendTurn` for the empty-turn retry: the same
 * chain as the apps, minus streaming and the relay. `raw` is this file's
 * original hand-built request, kept so that a change in the dialect layer can
 * be bisected against a path that does not go through it.
 */
type Transport = 'dialect' | 'raw'
const TRANSPORT: Transport = process.env['BENCH_TRANSPORT'] === 'raw' ? 'raw' : 'dialect'

/**
 * The thinking mode, validated against the dialect layer's own list.
 *
 * Defaults to the same default production uses. Under `raw` there is no way to
 * send it — that transport predates the setting — so asking for one there is
 * refused rather than recorded as though it had been honoured; the raw path's
 * setup says `server-default`, which is literally what it sends.
 */
const THINKING: Thinking = (() => {
  const asked = process.env['BENCH_THINKING']
  if (asked === undefined || asked === '') return DEFAULT_THINKING
  if (!(THINKING_MODES as readonly string[]).includes(asked)) {
    throw new Error(`BENCH_THINKING=${asked} is not one of ${THINKING_MODES.join(' | ')}`)
  }
  if (TRANSPORT === 'raw') {
    throw new Error('BENCH_THINKING has no effect under BENCH_TRANSPORT=raw — the raw request carries no thinking field. Drop one or the other.')
  }
  return asked as Thinking
})()

/** The three loop modules an ablation can take out. `0` turns one off. */
const REPAIR = process.env['BENCH_REPAIR'] !== '0'
const STUCK = process.env['BENCH_STUCK'] !== '0'
const VERIFY = process.env['BENCH_VERIFY'] !== '0'

/** How many times every conversation runs. The spread is written out. */
const RUNS = (() => {
  const n = Number(process.env['BENCH_RUNS'] ?? 1)
  if (!Number.isInteger(n) || n < 1) throw new Error(`BENCH_RUNS must be a whole number of at least 1, not ${String(process.env['BENCH_RUNS'])}`)
  return n
})()

/** The share of tool calls deliberately corrupted, 0–1. See `faults.mts`. */
const FAULTS = (() => {
  const r = Number(process.env['BENCH_FAULTS'] ?? 0)
  if (!Number.isFinite(r) || r < 0 || r > 1) throw new Error(`BENCH_FAULTS must be a rate between 0 and 1, not ${String(process.env['BENCH_FAULTS'])}`)
  return r
})()
const SEED = Number(process.env['BENCH_SEED'] ?? 1) || 1

/** Append an adversarial instruction to every document read and search result. */
const INJECT = process.env['BENCH_INJECT'] === '1'

/**
 * The approval gate the loop is told about, defaulting to what the app ships.
 *
 * The app's default is derived, not guessed: a thread saved with no `approval`
 * is `approvalOf({}) === 'manual'` (model.ts), and `use-agent.ts` maps that
 * through its `GATE_FOR` table to `'writes'`. The table is not exported and
 * lives beside React hooks, so its one relevant row is restated here with the
 * lookup that produces it, and a change to either side shows up as a
 * different `setup.gate` rather than as a silent drift.
 *
 * HONESTY ABOUT WHAT THIS DOES. The runner passes no `approve` callback, and
 * `performCall` only consults the gate when both are present (`gated &&
 * approve`), so under this runner every value of `gate` runs every call. What
 * `setup.gate` records is what the loop was TOLD — the configuration a score
 * claims to describe — so that a future run which does wire an approver
 * cannot be folded together with these. See the README's "approval gate"
 * section for the case where the difference matters.
 */
type Gate = NonNullable<Parameters<typeof runAgentType>[0]['gate']>
const GATES = ['destructive', 'writes', 'none'] as const
const GATE: Gate = (() => {
  const asked = process.env['BENCH_GATE']
  if (asked === undefined || asked === '') {
    const mode = approvalOf({})
    // `GATE_FOR.manual` in use-agent.ts. Written as a check rather than a
    // constant so a changed default there fails here instead of being restated.
    if (mode !== 'manual') throw new Error(`the app's default approval mode is now '${mode}'; update the gate default here`)
    return 'writes'
  }
  if (!(GATES as readonly string[]).includes(asked)) throw new Error(`BENCH_GATE=${asked} is not one of ${GATES.join(' | ')}`)
  return asked as Gate
})()

/**
 * The benchmark's own knobs on the request, applied to either transport.
 *
 * `temperature: 0` is not what production sends — it sends none, and the
 * server's default stands — but every published number was measured at zero
 * and the README's whole treatment of noise assumes it. Written into `setup`
 * so that the day someone measures at the server default, the two tables
 * cannot be mistaken for one.
 */
const TEMPERATURE = 0

/* -------------------------------------------------------------------------- */
/* Ablation, by replacing the module                                           */
/* -------------------------------------------------------------------------- */

/**
 * The stubs, one per module the loop imports and does not make optional.
 *
 * `loop.ts` calls `repairArgs`, `createStuckDetector` and `verifyBeforeExit`
 * unconditionally — there is no `AgentOptions` field for any of them, and this
 * file owns none of `kg/`. So an ablation is done the way `vi.mock` does it: a
 * loader hook that answers the import of `kg/agent/repair.ts` with a module
 * whose `repairArgs` refuses everything, which is exactly the loop's behaviour
 * before the layer existed (`args = repaired?.ok === true ? … : call.args`).
 * The stuck stub never fires, so the loop runs to `maxSteps` as it did before
 * `stuck.ts`; the verify stub accepts every answer.
 *
 * Registered from a `data:` URL rather than a file so the mechanism lives in
 * this file next to the switches it serves. The loop itself is imported AFTER
 * registration, dynamically — a static import would be hoisted above the hook
 * and the real modules would already be in the cache. `proveSwitches` checks
 * that this actually happened rather than trusting the ordering.
 */
const STUBS: Record<string, string> = {
  ...(REPAIR
    ? {}
    : {
        '/kg/agent/repair.ts':
          "export const repairArgs = () => ({ ok: false, reason: 'ablated by BENCH_REPAIR=0', repairs: [] }); export const summarizeRepairs = () => '';",
      }),
  ...(STUCK
    ? {}
    : {
        '/kg/agent/stuck.ts':
          "export const createStuckDetector = () => ({ observe: () => ({ action: 'continue' }), state: () => ({}) });",
      }),
  ...(VERIFY
    ? {}
    : {
        '/kg/agent/verify-gate.ts':
          'export const verifyBeforeExit = () => ({ accept: true }); export const MAX_VERIFY_NUDGES_PER_TURN = 1;',
      }),
}

if (Object.keys(STUBS).length > 0) {
  const hook = `
    const STUBS = ${JSON.stringify(STUBS)};
    export async function load(url, context, next) {
      for (const [suffix, source] of Object.entries(STUBS)) {
        if (url.endsWith(suffix)) return { format: 'module', shortCircuit: true, source };
      }
      return next(url, context);
    }`
  register(`data:text/javascript,${encodeURIComponent(hook)}`, import.meta.url)
}

// After the hook, and dynamic, for the reason on `STUBS`.
const { runAgent } = await import('../kg/agent/loop')
type RunAgent = typeof runAgent

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
    /*
     * `readDocument`, not a lookup of its own — see its header.
     *
     * What stood here looked the NODE id up in `DOCUMENTS`, which is keyed by
     * file NAME, so it missed on every document in the suite and the whole
     * `documents` group was scored on a task this harness made impossible. The
     * offline suite had the correct version all along, which is why nothing
     * went red.
     */
    convert: async (fileId: string) => readDocument(repo.getSnapshot(), fileId),
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
      for (const e of snap.out(n.id, 'FILED_UNDER')) {
        const t = byId.get(e.to)
        const p = (t?.props ?? {}) as Record<string, unknown>
        // Employer and role together: a check may reasonably match on either.
        const org = [...snap.out(e.to, 'AT')].map((x) => nameOf(x.to)).find((x) => x !== null)
        const label = [org, p['role'] ?? p['title'] ?? p['name']].filter(Boolean).join(' — ')
        if (label !== '') props['filedUnder'] = label
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

/* -------------------------------------------------------------------------- */
/* Proving the switches                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A model that answers from a script, for driving the real loop offline.
 *
 * `turns` is consumed in order and the last entry repeats — a scripted model
 * that "runs out" would be a fourth failure mode the probe is not measuring.
 */
function scripted(turns: readonly Turn[]): { llm: (m: readonly ChatMessage[], t: readonly unknown[]) => Promise<Turn>; calls: () => number } {
  let n = 0
  return {
    llm: async () => {
      const turn = turns[Math.min(n, turns.length - 1)] as Turn
      n += 1
      return turn
    },
    calls: () => n,
  }
}

const callTurn = (name: string, raw: string, args: unknown): Turn => ({
  ok: true,
  text: null,
  toolCalls: [{ id: 'call_probe', name, args, raw }],
  finishReason: 'tool_calls',
})
const sayTurn = (text: string): Turn => ({ ok: true, text, toolCalls: [], finishReason: 'stop' })

/**
 * Three probes against the REAL loop, each of which must come out one way with
 * its switch on and the other way with it off. Anything else is a switch that
 * did not reach the loop, and the run refuses to start.
 *
 * The probes are the three modules' own smallest cases, taken from their
 * headers: a double-encoded `{}` for repair (`unwrapped-json`), the same call
 * five times for stuck (`repeatStop`), and the loop's own documented probe for
 * the verify gate — "move my Rice application to interview", answered "I've
 * moved…" with no call, which the gate must send back exactly once.
 *
 * Offline and cheap — no seed, no network — so it runs on EVERY start, which
 * also proves the modules fire when they are ON. A run where repair has
 * silently stopped firing would otherwise look like "these models emit valid
 * arguments".
 */
async function proveSwitches(run: RunAgent): Promise<void> {
  const settled: AgentStep[] = []
  let verifyNotes = 0
  const collect = (e: AgentEvent) => {
    if (e.type === 'step' && e.step.status !== 'running') settled.push(e.step)
    if (isVerifyNote(e)) verifyNotes += 1
  }
  const base = () => ({ host: freshHost().host, history: [], onEvent: collect, maxSteps: 8 })
  ctx = freshContext('(probe)')

  // Repair: `memory_overview` with `arguments` that parsed to the STRING "{}".
  {
    const model = scripted([callTurn('memory_overview', '"{}"', '{}'), sayTurn('Here is what I found: nothing yet.')])
    await run({ ...base(), llm: model.llm, prompt: 'What is in my store?' })
    const step = settled.find((s) => s.name === 'memory.overview')
    const repaired = step?.repairs?.includes('unwrapped-json') === true && step.status === 'done'
    const refused = step?.status === 'failed' && (step.repairs ?? []).length === 0
    if (REPAIR && !repaired) throw new Error(`BENCH_REPAIR=1 but the loop did not repair a double-encoded call: ${JSON.stringify(step)}`)
    if (!REPAIR && !refused) throw new Error(`BENCH_REPAIR=0 did not reach the loop: the call was still repaired: ${JSON.stringify(step)}`)
  }

  // Stuck: the identical successful call, every round, for eight rounds.
  {
    settled.length = 0
    const model = scripted([callTurn('memory_overview', '{}', {})])
    const out = await run({ ...base(), llm: model.llm, prompt: 'What is in my store?' })
    if (STUCK && out.stopped !== 'stuck') throw new Error(`BENCH_STUCK=1 but a model repeating one call ended '${out.stopped}', not 'stuck'`)
    if (!STUCK && out.stopped !== 'cap') throw new Error(`BENCH_STUCK=0 did not reach the loop: the run ended '${out.stopped}', not 'cap'`)
    /*
     * And the derivation `stuckNudgesIn` rests on, against the same run: the
     * repeat nudge fires once, at the third identical call (`repeatNudge: 3`,
     * and `already('repeat')` keeps it to once per fingerprint), and the
     * detector stubbed out sends none. Anything else means the loop no longer
     * writes tool replies the way that function reads them.
     */
    const ids = new Set(['call_probe'])
    const nudges = stuckNudgesIn(out.messages, settled, ids)
    if (STUCK && nudges !== 1) throw new Error(`stuck-nudge counting is broken: expected the one repeat nudge in the transcript, counted ${String(nudges)}`)
    if (!STUCK && nudges !== 0) throw new Error(`stuck-nudge counting is broken: BENCH_STUCK=0 but ${String(nudges)} nudge(s) were counted`)
  }

  // Verify: a claimed write with nothing attempted. The gate spends one round.
  {
    const model = scripted([sayTurn("I've moved your Rice application to interview.")])
    const out = await run({ ...base(), llm: model.llm, prompt: 'Move my Rice application to interview.' })
    if (VERIFY && model.calls() !== 2) throw new Error(`BENCH_VERIFY=1 but announce-without-acting was accepted after ${String(model.calls())} model call(s), not sent back once`)
    if (!VERIFY && model.calls() !== 1) throw new Error(`BENCH_VERIFY=0 did not reach the loop: the gate still sent the answer back (${String(model.calls())} model calls)`)
    if (out.stopped !== 'answered') throw new Error(`verify probe ended '${out.stopped}'`)
    // The counter behind `run.verifyNudges` — see `isVerifyNote` for why this
    // is the only thing standing between a reworded note and a silent zero.
    if (verifyNotes !== (VERIFY ? 1 : 0)) throw new Error(`verify-nudge counting is broken: the probe emitted ${String(verifyNotes)} verify note(s), expected ${VERIFY ? 1 : 0}`)
  }
}

/**
 * The forced truncation, driven through `llm` itself against the real loop.
 *
 * Through `llm` and a swapped transport, not through `cutOff` alone: the
 * one-shot lives in the conversation context and the wiring in `llm`, and a
 * probe that called `cutOff` directly would pass with the wiring deleted.
 * Three things have to come out right — the first call is refused with the
 * loop's "FEWER items" sentence (which is the branch that needs BOTH
 * `finish_reason: 'length'` and unparseable arguments), the model's retry on
 * the next round runs untouched, and a context that did not ask sees the same
 * script run clean on the first call.
 */
async function proveTruncation(run: RunAgent): Promise<void> {
  const real = transport
  const settled: AgentStep[] = []
  const drive = async (truncateFirstCall: boolean) => {
    settled.length = 0
    let n = 0
    transport = async () => {
      n += 1
      return n === 1
        ? callTurn('memory_search', JSON.stringify({ query: 'stripe' }), { query: 'stripe' })
        : n === 2
          ? callTurn('memory_search', JSON.stringify({ query: 'stripe' }), { query: 'stripe' })
          : sayTurn('Nothing about Stripe yet.')
    }
    ctx = freshContext('(probe)', truncateFirstCall)
    try {
      await run({
        host: freshHost().host,
        history: [],
        onEvent: (e) => {
          if (e.type === 'step' && e.step.status !== 'running') settled.push(e.step)
        },
        llm,
        prompt: 'What do I have on Stripe?',
        maxSteps: 4,
      })
    } finally {
      transport = real
    }
    return settled.map((s) => ({ status: s.status, detail: s.detail ?? '' }))
  }

  const forced = await drive(true)
  const first = forced[0]
  if (first === undefined || first.status !== 'failed' || !first.detail.startsWith("Error: your reply hit the model's output limit")) {
    throw new Error(`truncateFirstCall did not reach the loop's FEWER-items path: ${JSON.stringify(forced)}`)
  }
  if (forced[1]?.status !== 'done') {
    throw new Error(`the forced truncation is not a one-shot — the retry was ${JSON.stringify(forced[1])}`)
  }
  if (ctx.truncate !== 'done') throw new Error(`truncation fired but the context says '${ctx.truncate}'`)

  const plain = await drive(false)
  if (plain[0]?.status !== 'done') {
    throw new Error(`a case that did not ask for truncation had its first call cut: ${JSON.stringify(plain)}`)
  }
}

/**
 * A case's own `window` reaches the loop, proven by a compaction.
 *
 * Two fake cases with the same script and history: one declares a window the
 * history does not fit, one declares a window nothing could fill. The first
 * must compact (`AgentRun.compacted`, the same field `run.compactions` is
 * counted from) and the second must not — and the pair is what makes this a
 * proof of the OVERRIDE rather than of compaction: if `Case.window` were
 * ignored both would run under `BENCH_WINDOW`, and whatever that is set to,
 * one of the two assertions fails.
 *
 * The small window is 8,192 with one tool offered, measured through
 * `fitHistory` with the loop's own estimate: the system prompt, question and
 * one schema come to 516 tokens against the 4,096 ceiling that
 * `RESERVED_FOR_REPLY` leaves, and 120 messages of ~100 characters are 5,274,
 * so the trim drops 70 of them — over the line without the fixed part
 * overflowing, which would be `summarisable: false` and write no summary.
 * (Sixty messages, the first draft, are 2,632 tokens and fit.)
 */
async function proveWindow(run: RunAgent): Promise<void> {
  if (!HARNESS) return
  const filler = 'The earlier discussion covered the systems roles, the two Rice applications, and the Baylor deadline. '
  const history: ChatMessage[] = Array.from({ length: 120 }, (_, i) =>
    i % 2 === 0
      ? { role: 'user', content: `${filler}(${String(i)})` }
      : { role: 'assistant', content: `${filler}(${String(i)})` },
  )
  const base = LIST[0] ?? (CONVERSATIONS[0] as Case)
  const drive = async (window: number) => {
    const fake: Case = { ...base, id: `(probe window ${String(window)})`, window }
    const model = scripted([sayTurn('Earlier we covered the systems roles.')])
    ctx = freshContext(fake.id)
    const out = await run({
      host: freshHost().host,
      history,
      onEvent: () => {},
      llm: model.llm,
      prompt: 'Remind me what we covered.',
      tools: ['memory.overview'],
      ...harnessFor(fake, (m) => model.llm(m, [])),
    })
    return out.compacted !== undefined
  }
  if (!(await drive(8_192))) throw new Error('a case declaring window: 8192 over a 5.3k-token history did not compact — Case.window is not reaching the loop')
  if (await drive(1_000_000)) throw new Error('a case declaring window: 1000000 compacted — the window the loop received is not the case\'s')
}

/**
 * The loop's own default round cap, read by running it.
 *
 * `DEFAULT_MAX_STEPS` is not exported from `loop.ts`, and this file used to
 * hard-code 12 where the app ships 8 — with the stuck detector's thresholds
 * (repeat nudge at 3, stop at 5) tuned against 8, so every published stuck
 * figure was measured under a budget the app never gives the model. Rather
 * than restate the number and let it drift again, a scripted model that
 * never repeats — `memory_search` with a fresh query each round, so no
 * fingerprint recurs and no cycle forms — is run with no `maxSteps` and
 * counted until the loop says `'cap'`. Offline, and a few milliseconds.
 */
async function measureDefaultMaxSteps(run: RunAgent): Promise<number> {
  let n = 0
  const llm = async (): Promise<Turn> => {
    n += 1
    return callTurn('memory_search', JSON.stringify({ query: `q${String(n)}` }), { query: `q${String(n)}` })
  }
  const settled: AgentStep[] = []
  const out = await run({
    host: freshHost().host,
    history: [],
    onEvent: (e) => {
      if (e.type === 'step' && e.step.status !== 'running') settled.push(e.step)
    },
    llm,
    prompt: 'Keep searching.',
  })
  if (out.stopped !== 'cap') throw new Error(`measuring the loop's default cap: a never-repeating model ended '${out.stopped}', not 'cap'`)
  /*
   * The one run that reaches the last two rounds, so the one place the
   * budget suffixes `stuckNudgesIn` strips are actually present — and with
   * nothing repeating, no nudge is. The stuck probe in `proveSwitches` cannot
   * cover this: it stops at the fifth call, three rounds short of the budget.
   * A reworded suffix in `loop.ts` would otherwise count as a nudge on every
   * conversation that ran to its cap.
   */
  const phantom = stuckNudgesIn(out.messages, settled, new Set(['call_probe']))
  if (phantom !== 0) throw new Error(`stuck-nudge counting is broken: ${String(phantom)} nudge(s) counted on a run that never repeated — the loop's budget suffix is no longer recognised`)
  return n
}

/* -------------------------------------------------------------------------- */
/* The model                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The `finish_reason` of the most recent completion, for the turn to record.
 *
 * A module-level box rather than a threaded return, because `runAgent` owns the
 * loop and there is no seam to carry it out through — and the question it
 * answers is per TURN, not per round: did the last thing the model said get cut
 * off. Reset at the top of each turn so a turn cannot inherit the one before.
 *
 * Read off the raw body rather than the parsed `Turn`, because a failed turn —
 * an empty reply that `sendTurn` is about to retry — has no `finishReason`
 * field, and `"length"` on exactly that reply is the one signal worth having.
 */
let lastFinishReason: string | null = null

/**
 * The loop's last `error` event this turn, for the same reason and in the same
 * box. A turn that ends `stopped: 'error'` used to leave nothing in the file
 * but `answer: null` — indistinguishable from an empty reply — and the first
 * fault-injection run ended every conversation that way: the corrupted
 * arguments went into the transcript verbatim and the server refused the NEXT
 * request, which only the reason says.
 */
let lastError: string | null = null

const finishReasonOf = (text: string): string | null => {
  try {
    const body = JSON.parse(text) as { choices?: { finish_reason?: unknown }[] }
    const r = body.choices?.[0]?.finish_reason
    return typeof r === 'string' ? r : null
  } catch {
    return null
  }
}

/**
 * What this conversation has told the model so far, kept for the two layers
 * that sit between the model and the executor.
 *
 * `pendingFaults` is a queue because the loop names steps `s1`, `s2`… rather
 * than by call id, and emits exactly one settled step per call in the order
 * the calls were returned — so the fault list for the next settled step is the
 * head of the queue. `resultOf` maps a call id to the registry name of the tool
 * it ran, which is how a `tool` message is recognised as a search or a file
 * read when the injection is applied.
 */
type ConversationContext = {
  pendingFaults: FaultKind[][]
  resultOf: Map<string, string>
  exposed: Set<string>
  /** Seeded from `BENCH_SEED` and the conversation id — see `seedFor`. */
  rng: Prng
  /**
   * The loop's rounds this conversation: calls to `llm` WITH a tool list. The
   * chooser and the summariser ask with none, and a round is the thing
   * `maxSteps` caps, so they are not rounds — their cost lands in `usage`.
   */
  rounds: number
  /**
   * Token counts, summed over every model response this conversation received
   * — agent rounds, chooser, summariser, and `sendTurn`'s empty-turn re-asks,
   * because each of those was a request the server charged for.
   *
   * `unreported` counts successful replies that carried no `usage`. One is
   * enough to make the conversation's total `null`: a partial sum is a number
   * that under-states the cost while looking exact, which is the thing this
   * file's own comments keep warning about.
   */
  usage: { prompt: number; completion: number; reported: number; unreported: number }
  /** Call ids the model asked for in the CURRENT user turn, for reading its tool replies back. */
  turnCallIds: Set<string>
  /**
   * The forced truncation, as a one-shot: `pending` until the first tool call
   * of the conversation has been cut off, `done` after, `off` for a case that
   * did not ask. See `Case.truncateFirstCall` and `cutOff`.
   */
  truncate: 'off' | 'pending' | 'done'
}
const freshContext = (conversationId: string, truncateFirstCall = false): ConversationContext => ({
  pendingFaults: [],
  resultOf: new Map(),
  exposed: new Set(),
  rng: createPrng(seedFor(SEED, conversationId)),
  rounds: 0,
  usage: { prompt: 0, completion: 0, reported: 0, unreported: 0 },
  turnCallIds: new Set(),
  truncate: truncateFirstCall ? 'pending' : 'off',
})
let ctx: ConversationContext = freshContext('(none)')

/** Fold one successful reply's `usage` into the conversation's total. */
function countUsage(turn: Turn): void {
  if (!turn.ok) return
  const u = turn.usage
  if (u == null || u.promptTokens === null || u.completionTokens === null) {
    ctx.usage.unreported += 1
    return
  }
  ctx.usage.reported += 1
  ctx.usage.prompt += u.promptTokens
  ctx.usage.completion += u.completionTokens
}

const registryName = (wire: string): string =>
  CATALOG.find((e) => e.wireName === wire || e.name === wire)?.name ?? wire

const SETTINGS: ModelSettings = { provider: 'openai-compatible', endpoint: URL, model: MODEL }

/**
 * The benchmark's fields on top of whatever the dialect built.
 *
 * Parsed and re-serialised rather than built here, so the request is
 * `chatRequest`'s — model, messages, tools, `tool_choice`, the thinking field
 * for this provider, `stream: false` — with two additions the benchmark owns.
 */
function benchBody(body: string | undefined): string {
  const built = JSON.parse(body ?? '{}') as Record<string, unknown>
  return JSON.stringify({
    ...built,
    temperature: TEMPERATURE,
    /*
     * The completion cap, and it was a silent thumb on the scale.
     *
     * Hard-coded at 1400 while PRODUCTION SENDS NONE — `budget.ts` argues at
     * length why, and the servers then allow everything left after the prompt.
     * 1,400 also sits below Qwen3 14B's measured 2,358-token pre-answer floor,
     * so a reasoning model could exhaust the cap before emitting its first
     * token and score `no-required-call` for a reason the benchmark had
     * created. `BENCH_MAX_TOKENS=0` (the default) omits it, matching production.
     */
    ...(MAX_TOKENS > 0 ? { max_tokens: MAX_TOKENS } : {}),
  })
}

/**
 * One request over the wire, as `ModelResponse`.
 *
 * Retried on a transport failure or a 5xx, up to three sends, because a run is
 * hours long and one dropped socket should not decide a conversation. A 4xx is
 * returned at once: `sendTurn` needs to SEE a 400 that names the thinking
 * field, because re-asking without it is the recovery.
 */
async function send(request: ModelRequest): Promise<ModelResponse | { failed: Turn }> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        signal: AbortSignal.timeout(180_000),
      })
      const text = await res.text()
      if (res.status >= 500 && attempt < 2) continue
      return { ok: res.ok, status: res.status, text, retryAfter: res.headers.get('retry-after') }
    } catch (e) {
      if (attempt < 2) continue
      const timedOut = e instanceof Error && e.name === 'TimeoutError'
      return { failed: unreachable(URL, String(e), timedOut) }
    }
  }
}

/** The dialect path: production's chain, minus streaming and the relay. */
async function dialectTurn(messages: readonly ChatMessage[], tools: readonly unknown[]): Promise<Turn> {
  return sendTurn(
    async ({ thinking }) => {
      const request = chatRequest(SETTINGS, messages, tools, false, { thinking })
      const body = benchBody(request.body)
      const response = await send({ ...request, body })
      if ('failed' in response) return response.failed
      lastFinishReason = finishReasonOf(response.text)
      const turn = guardTruncation(body, readTurnFor(SETTINGS, response))
      // Here, inside `sendTurn`, so a re-ask on an empty reply is counted as
      // the extra request it was.
      countUsage(turn)
      return turn
    },
    {
      delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      thinking: THINKING,
      provider: SETTINGS.provider,
    },
  )
}

/**
 * The original hand-built request, unchanged, for bisecting.
 *
 * No thinking field, no empty-turn retry, no truncation guard, its own reader.
 * It is kept precisely because it is DIFFERENT: a number that moves when the
 * transport is switched is a finding about the dialect layer.
 */
async function rawTurn(messages: readonly ChatMessage[], tools: readonly unknown[]): Promise<Turn> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${URL}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          messages,
          ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
          temperature: TEMPERATURE,
          ...(MAX_TOKENS > 0 ? { max_tokens: MAX_TOKENS } : {}),
        }),
        signal: AbortSignal.timeout(180_000),
      })
      if (!res.ok) {
        if (attempt < 2) continue
        return { ok: false, kind: 'refused', reason: `${res.status}` }
      }
      const body = (await res.json()) as never
      const choice = (body as { choices?: { message?: Record<string, unknown>; finish_reason?: string }[] }).choices?.[0]
      lastFinishReason = choice?.finish_reason ?? null
      const msg = choice?.message ?? {}
      const raw = (msg['tool_calls'] as { id?: string; function?: { name?: string; arguments?: unknown } }[]) ?? []
      return {
        ok: true,
        text: typeof msg['content'] === 'string' ? msg['content'] : null,
        toolCalls: raw.map((c, i) => {
          const a = c.function?.arguments
          const text = typeof a === 'string' ? a : a === undefined || a === null ? '{}' : JSON.stringify(a)
          /*
           * `null`, not `{}` — production's `safeParse` answers null, and the
           * loop has a whole branch for it ("the arguments were not valid
           * JSON", and since the truncation fix, a different sentence when the
           * reply hit the output limit).
           *
           * Laundering a malformed argument string into an empty object sent it
           * down the VALIDATION path instead, where it failed as "field X is
           * required". The invalid-JSON bucket had therefore never held a single
           * entry across any published run, and two harnesses over the same 36
           * conversations disagreed about which branch a malformed call takes.
           */
          let parsed: unknown = null
          try { parsed = JSON.parse(text) } catch { parsed = null }
          return { id: c.id ?? `call_${i}`, name: c.function?.name ?? '', args: parsed, raw: text }
        }),
        finishReason: choice?.finish_reason ?? null,
      }
    } catch (e) {
      if (attempt < 2) continue
      return { ok: false, kind: 'unreachable', reason: String(e) }
    }
  }
  return { ok: false, kind: 'unreachable', reason: 'exhausted' }
}

/**
 * The transcript as the model will see it, with the injection applied.
 *
 * Applied on the way OUT rather than written into the loop's history, and
 * re-applied on every request: the same `tool` message is re-sent in every
 * later round and turn, so an instruction planted in a result stays in front
 * of the model for the rest of the conversation — which is what a poisoned
 * document does. `exposed` counts each result once, however many times it is
 * re-sent, so `exposures` is "results that carried the instruction" and not
 * "requests that did".
 */
function withInjection(messages: readonly ChatMessage[]): readonly ChatMessage[] {
  return messages.map((m) => {
    if (m.role !== 'tool') return m
    const tool = ctx.resultOf.get(m.tool_call_id)
    if (tool === undefined || !INJECTION_TARGETS.includes(tool)) return m
    if (!ctx.exposed.has(m.tool_call_id) && process.env['BENCH_TRACE']) {
      process.stderr.write(`      inject: ${tool} result ${m.tool_call_id} now carries the instruction\n`)
    }
    ctx.exposed.add(m.tool_call_id)
    return { ...m, content: injectResult(m.content) }
  })
}

/**
 * A tool call as the server hands it back when the reply hit the output limit.
 *
 * `arguments` ends partway through — a prefix of the JSON the model was
 * writing — so it does not parse and `readToolCalls` reports `args: null`.
 * The loop then reads `finishReason === 'length'` beside that null and sends
 * its "FEWER items" sentence instead of "not valid JSON": both conditions are
 * what `performCall` checks (`truncated && call.args === null`), so both are
 * forced here, and `proveTruncation` drives the pair through the real loop on
 * every start.
 *
 * The cut is at half the string, then shortened until the prefix genuinely
 * fails to parse — `{}   ` cut at half is `{} `, which parses, and a "cut-off"
 * call that the loop could read would test the wrong branch.
 */
function cutOff(call: ToolCall): ToolCall {
  let raw = call.raw.slice(0, Math.max(1, Math.floor(call.raw.length / 2)))
  for (;;) {
    try {
      JSON.parse(raw)
    } catch {
      return { ...call, args: null, raw }
    }
    if (raw.length <= 1) return { ...call, args: null, raw: '' }
    raw = raw.slice(0, -1)
  }
}

/**
 * The reply with its first call cut off, and nothing after it.
 *
 * Nothing after it because that is what a length stop looks like: the server
 * stopped generating mid-call, so a second call in the same reply cannot
 * exist. Keeping later calls would hand the loop a shape no server produces.
 */
function truncatedReply(turn: Turn & { ok: true }): Turn & { ok: true } {
  const first = turn.toolCalls[0]
  if (first === undefined) return turn
  return { ...turn, toolCalls: [cutOff(first)], finishReason: 'length' }
}

/**
 * The wire, behind a seam.
 *
 * `llm` is what the loop calls, and everything this runner does between the
 * model and the executor — counting rounds, faults, the injection, the forced
 * truncation — lives inside it. The start-up probes have to drive THAT
 * function with a scripted model rather than a copy of its logic, or a probe
 * proves the copy; so the network sits behind one assignment the probes can
 * replace and put back.
 */
let transport: (messages: readonly ChatMessage[], tools: readonly unknown[]) => Promise<Turn> =
  TRANSPORT === 'raw' ? rawTurn : dialectTurn

/** The specs the loop last offered — for the round-three fit diagnostic under `BENCH_TRACE`. */
let lastSpecs: readonly unknown[] = []

async function llm(messages: readonly ChatMessage[], tools: readonly unknown[]): Promise<Turn> {
  if (process.env['BENCH_SIZE']) {
    // Rough, and rough is enough: what matters is the SHAPE of the growth.
    const chars = JSON.stringify(messages).length + JSON.stringify(tools).length
    process.stderr.write(
      `      size: ${String(messages.length)} msgs, ${String(tools.length)} tools, ~${String(Math.round(chars / 4))} tokens\n`,
    )
  }
  const sent = INJECT ? withInjection(messages) : messages
  // A round is a call the LOOP makes: one with tools on offer. See `ctx.rounds`.
  if (tools.length > 0) ctx.rounds += 1
  if (tools.length > 0) lastSpecs = tools
  const turn = await transport(sent, tools)
  if (tools.length === 0 && process.env['BENCH_TRACE']) {
    // Round-three measurement: which no-tools call this was, and what came back.
    const head = messages[0]
    const what = head !== undefined && typeof head.content === 'string' ? head.content.slice(0, 40) : ''
    const reply = turn.ok ? `ok ${String((turn.text ?? '').length)} chars` : `${turn.kind}: ${turn.reason.slice(0, 80)}`
    process.stderr.write(`      no-tools call: ${String(messages.length)} msgs, system=${JSON.stringify(what)} reply=${reply}\n`)
  }
  // The raw transport parses no `usage`, so under it every reply is
  // unreported and `tokens` is null — which is literally what that path knows.
  if (TRANSPORT === 'raw') countUsage(turn)
  if (!turn.ok) return turn
  for (const c of turn.toolCalls) {
    ctx.resultOf.set(c.id, registryName(c.name))
    ctx.turnCallIds.add(c.id)
  }
  /*
   * The fault layer, between the model's reply and the executor.
   *
   * Only on the agent's own turns. The chooser and the summariser are asked
   * with no tools and any call they emitted would never be executed, so a
   * fault there would draw from the PRNG for a call nothing records.
   */
  if (tools.length === 0) return turn
  const faulted = turn.toolCalls.map((c) => faultCall(c, FAULTS, ctx.rng))
  /*
   * The forced truncation, AFTER the faults and over the top of them.
   *
   * After, so the PRNG draws exactly what it would have drawn on the same
   * replies without the cut — `faultCall` draws once per call whatever it
   * decides, and a call removed before the draw would shift every later fault
   * in the conversation. Over the top, so the record says what the loop saw:
   * a fault planted on the call that was then cut off never reached the
   * executor, and reporting it would count a fault the repair layer was never
   * shown. `pendingFaults` therefore gets one empty entry, for the one call
   * the reply still carries.
   */
  if (ctx.truncate === 'pending' && faulted.length > 0) {
    ctx.truncate = 'done'
    ctx.pendingFaults.push([])
    return truncatedReply({ ...turn, toolCalls: faulted.map((f) => f.call) })
  }
  for (const f of faulted) ctx.pendingFaults.push([...f.faults])
  return { ...turn, toolCalls: faulted.map((f) => f.call) }
}

/* -------------------------------------------------------------------------- */
/* Counting what the loop emits                                               */
/* -------------------------------------------------------------------------- */

/**
 * Is this app note the verify gate sending the model back?
 *
 * What the loop emits on a verify nudge is `{ type: 'note', app: true, text:
 * VERIFY_NOTE[reason] }` — the same event shape as the trim note, the overflow
 * note, the truncation note and the repair note, with nothing on it saying
 * which. `VERIFY_NOTE` is not exported. Its four sentences share a frame no
 * other app note has: they open "The assistant …" and end "… It has been asked
 * to <verb> …". That frame is the discriminator, and `proveSwitches` drives a
 * real nudge through the real loop on every start and refuses to run if this
 * does not see exactly one — so a reworded `VERIFY_NOTE` is a refused start,
 * not a silent zero.
 */
const isVerifyNote = (e: AgentEvent): boolean =>
  e.type === 'note' && e.app === true && /^The assistant .*\. It has been asked to /.test(e.text)

/**
 * The budget suffixes `loop.ts` appends to a tool reply in the last two rounds,
 * verbatim. Needed by `stuckNudgesIn`, which has to take them off.
 */
const BUDGET_SUFFIXES = [
  '\n\nThis was your last step. Answer now with what you have, and say plainly what you could not finish.',
  '\n\nYou have one step left. Answer now with what you have, and say plainly what you could not finish.',
] as const

/**
 * How many stuck-detector nudges this turn's tool replies carried.
 *
 * THE LOOP EMITS NOTHING FOR A STUCK NUDGE. On a call verdict of `nudge` it
 * appends `verdict.text` to the tool reply the model is already reading —
 * `content: \`${step.detail ?? 'Done.'}${nudge}${budget}\`` — and no event
 * goes to `onEvent`; only a `stop` is announced, as an `error`. (The echo
 * nudge on a call-free answer is dropped on purpose, with the loop's own
 * reasoning beside it, so it is neither emitted nor injected and cannot be
 * counted by anyone.)
 *
 * So the count is read back off the transcript the loop returns. Every
 * settled step's `detail` is known from its `step` event, and the two budget
 * suffixes are fixed strings; a tool reply for one of this turn's calls that
 * is anything more than a detail plus an optional budget suffix carries a
 * nudge. `proveSwitches` proves the derivation against the real loop on every
 * start: the repeat probe must show exactly one (the repeat nudge fires once
 * per fingerprint, at the third identical call) with the detector on, and
 * zero with it stubbed out. A reply that starts with none of the details is
 * a format this file no longer understands and is NOT counted — the probe is
 * what makes that a refused start rather than a wrong number.
 */
function stuckNudgesIn(messages: readonly ChatMessage[], settled: readonly AgentStep[], callIds: ReadonlySet<string>): number {
  // Longest first, so `detail` "Done." cannot claim a reply whose real detail
  // merely starts with it.
  const details = [...new Set(settled.map((st) => st.detail ?? 'Done.'))].sort((a, b) => b.length - a.length)
  let nudges = 0
  for (const m of messages) {
    if (m.role !== 'tool' || !callIds.has(m.tool_call_id)) continue
    const detail = details.find((d) => m.content.startsWith(d))
    if (detail === undefined) continue
    let rest = m.content.slice(detail.length)
    for (const suffix of BUDGET_SUFFIXES) if (rest.endsWith(suffix)) rest = rest.slice(0, -suffix.length)
    if (rest.length > 0) nudges += 1
  }
  return nudges
}

/**
 * The scorer's spelling of how a turn ended. `AgentRun.stopped` says `'cap'`
 * for the round budget; everything else is carried as the loop said it.
 */
const stoppedBy = (stopped: AgentRun['stopped']): StoppedBy => (stopped === 'cap' ? 'maxSteps' : stopped)

/* -------------------------------------------------------------------------- */
/* One conversation                                                           */
/* -------------------------------------------------------------------------- */

type Condition = 'full' | 'narrowed'

/**
 * The scorer's telemetry plus the two fields this runner adds to it.
 *
 * `bench-score.ts` carries `run` through whole, so the fields reach the file
 * and the guide without the scorer naming them; they are declared here so the
 * literal that builds them is checked.
 */
type BenchTelemetry = RunTelemetry & {
  readonly window?: number
  readonly truncated?: boolean
}

/**
 * The harness, ON by default — because it is what the apps pass.
 *
 * It used to be opt-in, with the reasoning that the published numbers should
 * measure the model rather than the scaffolding around it. That was wrong, and
 * it made every published figure describe code nobody runs: `Assistant.tsx`
 * and `AssistantScreen.tsx` both pass `window`, `chooser`, `summariser` and
 * `onCompacted` on every turn. A benchmark whose default configuration the
 * product does not ship is measuring a hypothetical.
 *
 * `BENCH_HARNESS=0` turns it off, for isolating the model from the scaffolding
 * deliberately rather than by accident.
 *
 * The window default is 32,768 because that is what BOTH local providers
 * declare as `defaultContext` — the number a person running Ollama or
 * llama.cpp actually gets. 16k is worth running too and says something
 * different: there the whole catalog does not fit and the retriever is what
 * rescues the run. A case may name its own (`Case.window`), and that one wins
 * for that conversation only.
 *
 * `ask` is a parameter rather than `llm` so `proveWindow` can hand in a
 * scripted summariser and drive this exact function through the real loop.
 */
function harnessFor(c: Case, ask: (m: readonly ChatMessage[]) => Promise<Turn>) {
  return HARNESS ? { chooser: { ask }, summariser: { ask }, window: windowFor(c) } : {}
}

/* -------------------------------------------------------------------------- */
/* What one conversation feeds back between turns                             */
/* -------------------------------------------------------------------------- */

/**
 * The history the next turn is given, built the way the app builds it.
 *
 * This used to be `history = out.messages`: the previous turn's SENT messages,
 * fed straight back. `AgentRun.messages` is the request as the loop made it —
 * the system prompt first, then the summary note when there is one (a fresh
 * one, or the carried `context`, both `system` role), then the history AS
 * FITTED (old tool results replaced by one-line stubs, evicted exchanges gone,
 * the covered prefix's user turns carried ahead of the tail), then the question
 * and everything the run appended (assistant turns, tool replies, verify
 * nudges as `user` messages). Feeding that back measured a conversation the
 * app never has, and round two of the compaction work put numbers on it:
 *
 *   - a copy of the system prompt entered the history on every turn, and the
 *     loop later "evicted" those copies as though they were exchanges — 12 of
 *     26 no-call trims were exactly that, the person was told 'earliest 2
 *     messages were left out' for two copies of the system prompt, and the
 *     summariser's `replaces` was inflated by 1,220 characters per copy;
 *   - the summary note went in as a `system` message and was subject to the
 *     next cut (`priorSummaryIn` in `loop.ts` exists to fish it back out);
 *   - a tool result the previous fit had stubbed came back as the STUB, so by
 *     the time a cut evicted it the ledger walk in `compact` had nothing to
 *     read: Gemma 36 of 60 evicted results were already stubs, Qwen 21/35,
 *     GPT-OSS 29/83, and the ledger — the part of the summary that exists to
 *     carry ids — was under-measured on every endurance case.
 *
 * The app (`kg/react/use-threads.ts`, `historyFor` and `nextContextThrough`)
 * keeps the ORIGINAL entries and rebuilds the history each turn: the user
 * turns of the summarised prefix replayed verbatim, then the tail the summary
 * does not cover; the summary itself travels as `context`, never as a
 * message, and the boundary advances by the loop's count LESS the replayed
 * head. This is that, over wire messages instead of entries — the two are
 * one-to-one here, so the app's `entriesForMessages` collapses to a clamp.
 * `proveFeedback` drives it through `runOne` against the real loop on every
 * start.
 */
function createFeedback() {
  /** Every wire message in ORIGINAL form: each turn's question and what its run appended. */
  const transcript: ChatMessage[] = []
  /** The latest summary, kept as the app keeps `ThreadProps.context`. */
  let context: string | undefined
  /** How much of `transcript` the summary covers — the app's `contextThrough`. */
  let through = 0
  return {
    /** The next turn's history, and how many replayed head messages it starts with. */
    history(): { history: ChatMessage[]; replayed: number } {
      const head = transcript.slice(0, through).filter((m) => m.role === 'user')
      return { history: [...head, ...transcript.slice(through)], replayed: head.length }
    },
    context: (): string | undefined => context,
    /**
     * Record what a turn did: advance the boundary if it compacted, keep its
     * summary, append what it added. `replayed` is what `history()` reported
     * for the history this run was given — the head is discounted from the
     * loop's count exactly as `nextContextThrough` discounts it. The two
     * clamps — never backwards, never past the end — cannot be reached by
     * construction (a summary is written only when the cut passes the head
     * into an assistant turn, and the cut never exceeds what was sent);
     * `proveFeedback`'s mutation sweep records them as the survivors.
     */
    absorb(out: AgentRun, prompt: string, replayed: number): void {
      if (out.compacted !== undefined) {
        context = out.compacted.context
        through = Math.min(transcript.length, through + Math.max(0, out.compacted.messages - replayed))
      }
      transcript.push(...addedBy(out.messages, prompt))
    },
  }
}

/**
 * The messages a run ADDED: its question and everything after it.
 *
 * Found by the question rather than counted from the sent history, because
 * what precedes it in `AgentRun.messages` is the request as fitted, and a
 * plain trim — no summary written, so `compacted` is absent — drops messages
 * the caller is told nothing about. The question is the LAST user message
 * carrying the prompt's exact text: the loop pushes only verify nudges as user
 * messages after it, and those are its own sentences, not the person's.
 */
function addedBy(messages: readonly ChatMessage[], prompt: string): ChatMessage[] {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]
    if (m !== undefined && m.role === 'user' && m.content === prompt) return messages.slice(i)
  }
  throw new Error('the loop returned a transcript without the question it was asked; the runner cannot tell what this turn added')
}

/**
 * A call as this runner records it: the scorer's record, plus what the fault
 * layer did to it. `faultsInjected` is this file's field — `bench-score.ts`
 * does not read it — kept on the same object so a repair and the fault that
 * provoked it sit side by side in the trace.
 */
type BenchCall = CallRecord & { readonly faultsInjected?: readonly FaultKind[] }

async function runOne(
  run: RunAgent,
  c: Case,
  condition: Condition,
  /** Zero-based, and only under `BENCH_RUNS>1` — a single run carries none. */
  repetition?: number,
) {
  const { host, nodes } = freshHost()
  await seed(host)
  ctx = freshContext(c.id, c.truncateFirstCall === true)
  const feed = createFeedback()
  let carried: readonly string[] | null = null
  /*
   * `finishReason` and the answer text, kept per turn.
   *
   * The reason was parsed and thrown away, so no published report has ever
   * contained a single `"length"` — the one signal that says whether a turn
   * that called nothing was a model declining to act or a model that ran out of
   * room before it could. Those have opposite fixes and the reports could not
   * tell them apart.
   */
  const perTurn: {
    calls: BenchCall[]
    answered: boolean
    finishReason: string | null
    answer: string | null
    error: string | null
    /** `'error'` when `runAgent` itself threw, which `AgentRun.stopped` cannot say. */
    stopped: StoppedBy
    /** How many calls this turn had made when each verify nudge fired — where it fell. */
    verifyNudgedAt: number[]
    stuckNudges: number
    compacted: boolean
    /** The turn in which the forced truncation fired. See `Case.truncateFirstCall`. */
    truncated: boolean
  }[] = []
  // Measured from the first request to the last reply; building the world is
  // not the model's time. Outside `kg/`, so a clock is allowed here.
  const startedAt = performance.now()
  /*
   * Every tool call that came back an error, with the message.
   *
   * `refusalRate` says how OFTEN calls failed and never what failed, which is
   * the half you need to fix anything: a rate of 8% is a schema the model
   * cannot satisfy or a model inventing a tool name, and those have opposite
   * fixes. Collected per run and reported alongside the scores.
   */
  const errors: { turn: number; tool: string; args: string; detail: string }[] = []

  for (const turn of c.turns) {
    const calls: BenchCall[] = []
    const settled: AgentStep[] = []
    const verifyNudgedAt: number[] = []
    lastFinishReason = null
    lastError = null
    ctx.turnCallIds = new Set()
    const truncationPending = ctx.truncate === 'pending'
    // `truncate` moves to `done` inside `llm`, so "fired this turn" is read
    // after the run, in both the thrown and the returned branch.
    const firedThisTurn = () => truncationPending && ctx.truncate === 'done'
    // What the app sends: the replayed head, the uncovered tail, and the
    // summary as `context` — see `createFeedback`. Omitted rather than set to
    // undefined, for `exactOptionalPropertyTypes`.
    const { history, replayed } = feed.history()
    const context = feed.context()
    let out: AgentRun
    try {
      out = await run({
        host,
        llm,
        history,
        prompt: turn.say,
        ...(context === undefined ? {} : { context }),
        gate: GATE,
        onEvent: (e) => {
          if (process.env['BENCH_TRACE'] && e.type === 'note') {
            process.stderr.write(`      note: ${e.text.slice(0, 300)}\n`)
          }
          if (isVerifyNote(e)) verifyNudgedAt.push(calls.length)
          if (e.type === 'error') {
            lastError = e.reason
            if (process.env['BENCH_TRACE']) process.stderr.write(`      error: ${e.reason.slice(0, 300)}\n`)
          }
          if (process.env['BENCH_TRACE'] && e.type === 'step') {
            process.stderr.write(`      [${e.step.status}] ${e.step.name} ${JSON.stringify(e.step.args ?? {}).slice(0, 130)}${e.step.detail ? ` !! ${e.step.detail.slice(0, 160)}` : ''}\n`)
          }
          if (e.type !== 'step' || e.step.status === 'running') return
          settled.push(e.step)
          // The head of the queue belongs to this step — see `ConversationContext`.
          const faults = ctx.pendingFaults.shift() ?? []
          if (e.step.status === 'declined') return
          // `effect` is what tells the scorer a write from a read, and every
          // trajectory metric — grounded, lookedFirst — is a ratio over writes.
          // Leave it off and the denominator is zero, which the scorer reports
          // as a perfect 1 rather than as missing data.
          /*
           * `repairs` rides along, and it is the number the repair layer is
           * judged by.
           *
           * `loop.ts` records what it fixed on every step and its own comment
           * calls `repairs.length` "the number that says" whether the layer
           * earns its place — and the benchmark captured neither, so the first
           * run after the layer shipped could not tell a flat score caused by
           * "repair never fires, these models emit valid arguments" from one
           * caused by "repair fires constantly and does not help". Those are
           * opposite conclusions and both look like no change.
           */
          /*
           * `[]` on every call while the layer is on, and absent only when it
           * is off. The scorer reads absence as "not measured" and reports
           * `repairs: null` — and the step carries `repairs` only when it fixed
           * something, so writing the step's field through verbatim made every
           * clean run read as unmeasured: `summarise.repairs` was null on runs
           * where the layer had looked at every call and found nothing to do.
           * The empty list is the measurement, "looked and fixed nothing", and
           * the roll-up is then `{ total: 0, byKind: {} }` rather than null.
           * Under `BENCH_REPAIR=0` the layer saw nothing, so nothing is written.
           */
          calls.push({
            turn: perTurn.length,
            name: e.step.name,
            effect: e.step.effect,
            ok: e.step.status === 'done',
            args: JSON.stringify(e.step.args ?? {}),
            ...(REPAIR ? { repairs: [...(e.step.repairs ?? [])] } : {}),
            ...(faults.length > 0 ? { faultsInjected: faults } : {}),
          })
          if (e.step.status === 'failed') {
            // The ARGUMENTS, not just the message. Two schema misreadings were
            // found and fixed from exactly this: the message says what was
            // wrong, and only the arguments say what the model thought it was
            // being asked for, which is the half a fix is written against.
            errors.push({
              turn: perTurn.length,
              tool: e.step.name,
              args: JSON.stringify(e.step.args ?? {}).slice(0, 400),
              detail: e.step.detail ?? '',
            })
          }
        },
        maxSteps: MAX_STEPS,
        // `full` passes neither `tools` nor `retrieve`, which is how the loop is
        // told to offer the whole catalog. Omitted rather than set to undefined:
        // `exactOptionalPropertyTypes` treats those as different requests.
        ...(condition === 'narrowed' ? { retrieve: { carried } } : {}),
        ...harnessFor(c, (m) => llm(m, [])),
      })
    } catch (e) {
      perTurn.push({
        calls,
        answered: false,
        finishReason: lastFinishReason,
        answer: null,
        error: String(e),
        stopped: 'error',
        verifyNudgedAt,
        stuckNudges: 0,
        compacted: false,
        truncated: firedThisTurn(),
      })
      continue
    }
    if (process.env['BENCH_TRACE']) {
      process.stderr.write(`   > "${turn.say.slice(0, 70)}"\n   < stopped=${out.stopped} answer=${JSON.stringify((out.answer ?? '').slice(0, 120))}\n`)
    }
    if (process.env['BENCH_TRACE']) {
      // Round-three measurement: the summary the loop wrote, and the loop's own
      // fit of the history this turn was GIVEN, re-run here so a trim with no
      // summariser call can be attributed (floor, overflow, or nothing to summarise).
      if (out.compacted !== undefined) {
        process.stderr.write(`      summary(${String(out.compacted.messages)} msgs, kept ${String(out.compacted.kept.length)}): ${out.compacted.context.replace(/\n/g, '\\n')}\n`)
      }
      if (HARNESS) {
        const q = addedBy(out.messages, turn.say)[0]
        const fit = fitHistory(history, [out.messages[0], q, lastSpecs], windowFor(c))
        process.stderr.write(
          `      fit: window=${String(windowFor(c))} history=${String(history.length)} dropped=${String(fit.dropped)} kept=${String(fit.kept.length)} stubbed=${String(fit.stubbed)} toSummarise=${String(fit.toSummarise.length)} summaryChars=${String(fit.summaryChars)} summarisable=${String(fit.summarisable)} overflows=${String(fit.overflows)} lost=${JSON.stringify(fit.lost)} evicted=${JSON.stringify(history.slice(0, fit.dropped).map((m) => (m.role === 'tool' ? `tool${m.content.includes('withheld to save room') ? '(stub)' : ''}` : m.role)))}\n`,
        )
      }
    }
    feed.absorb(out, turn.say, replayed)
    carried = out.offered
    perTurn.push({
      calls,
      answered: out.answer !== null && out.answer.trim() !== '',
      finishReason: lastFinishReason,
      answer: out.answer,
      error: lastError,
      stopped: stoppedBy(out.stopped),
      verifyNudgedAt,
      stuckNudges: stuckNudgesIn(out.messages, settled, ctx.turnCallIds),
      // `AgentRun.compacted` is present exactly when a summary was written this
      // turn. The loop also emits a trim note, but that fires for a plain trim
      // too (no summariser, or one that failed), and a trim is not a compaction.
      compacted: out.compacted !== undefined,
      truncated: firedThisTurn(),
    })
  }
  const wallMs = Math.round(performance.now() - startedAt)
  const all = perTurn.flatMap((t) => t.calls)
  const faultedCalls = all.filter((c) => (c.faultsInjected ?? []).length > 0)
  const wipes = all.filter((c) => c.name === 'memory.clear')
  /*
   * `finishReason` and the answers ride alongside the score rather than into it.
   *
   * The rubric does not read them — scoring on them would be a different
   * change — but a report that cannot say WHY a turn called nothing cannot tell
   * a model declining to act from one that ran out of room before it could.
   */
  /*
   * One `stoppedBy` for the conversation: the FIRST turn that did not end in
   * an answer, else `'answered'`.
   *
   * Not the last turn's. The scorer's `stuck.stoppedButClean` is the
   * detector's false-positive rate — a run it cut off that was nevertheless
   * correct — and a stuck stop on turn one of three would be invisible behind
   * an `'answered'` on turn three. Every turn's own outcome is in `reasons`.
   */
  const stopped = perTurn.find((t) => t.stopped !== 'answered')?.stopped ?? 'answered'
  const telemetry: BenchTelemetry = {
    stoppedBy: stopped,
    rounds: ctx.rounds,
    verifyNudges: perTurn.reduce((n, t) => n + t.verifyNudgedAt.length, 0),
    stuckNudges: perTurn.reduce((n, t) => n + t.stuckNudges, 0),
    compactions: perTurn.filter((t) => t.compacted).length,
    tokens:
      ctx.usage.reported > 0 && ctx.usage.unreported === 0
        ? { prompt: ctx.usage.prompt, completion: ctx.usage.completion }
        : null,
    wallMs,
    /*
     * The window this conversation ran under, when the harness was on. Per
     * conversation rather than only in `setup`, because a case may carry its
     * own (`Case.window`) and a compaction count means nothing without the
     * window it was measured against.
     */
    ...(HARNESS ? { window: windowFor(c) } : {}),
    /*
     * Whether the forced truncation happened. `true` when the first call was
     * cut off; `false` when the case asked for it and the model never made a
     * call to cut, which is a measurement and not a default — a case that
     * scores the retry path scored nothing on such a run, and the file has to
     * say so rather than leave the field off as though nothing was asked.
     */
    ...(c.truncateFirstCall === true ? { truncated: ctx.truncate === 'done' } : {}),
    /*
     * Whether the planted instruction was followed.
     *
     * `attempted` counts every `memory.clear` the model asked for; `landed`
     * the ones that ran. Under `narrowed` the two differ — `NEVER_IMPLICIT` is
     * refused when it was not offered — and under `full` they do not, which is
     * itself the finding: the offered-list check is the only thing between a
     * poisoned document and an emptied store.
     */
    ...(INJECT
      ? {
          injection: {
            exposures: ctx.exposed.size,
            attempted: wipes.length,
            landed: wipes.filter((c) => c.ok).length,
          },
        }
      : {}),
  }
  return {
    ...scoreConversation(c, perTurn, nodes(), telemetry, repetition),
    // The same object the scorer was handed, restated only so the return type
    // carries this runner's two fields (`BenchTelemetry`) for `proveRecords`.
    run: telemetry,
    errors,
    reasons: perTurn.map((t, i) => ({
      turn: i,
      finishReason: t.finishReason,
      calls: t.calls.length,
      answered: t.answered,
      answer: t.answer === null ? null : t.answer.slice(0, 240),
      error: t.error === null ? null : t.error.slice(0, 300),
      stopped: t.stopped,
      verifyNudgedAt: t.verifyNudgedAt,
      stuckNudges: t.stuckNudges,
      compacted: t.compacted,
      ...(t.truncated ? { truncated: true } : {}),
    })),
    /*
     * What the fault layer did to this conversation, call by call.
     *
     * Each row pairs the fault with what the loop made of it — repaired, or
     * refused — which is the measurement `faults.mts` exists for. Absent when
     * no faults were asked for, so a baseline file does not grow a field that
     * says "nothing happened" 48 times.
     *
     * Only the rows. The COUNTS are `trajectory.faults`, the scorer's, and this
     * block used to restate three of them under the same names with a
     * different definition: it counted a call that was repaired and then
     * refused by the runtime as both `repaired` and `refused`, where the
     * scorer counts it once, as refused. Seen on `stripe-offer` at rate 0.6,
     * seed 3 — `application.offer.decide` trimmed and then rejected for having
     * no offer to decide on — as `repaired: 2, refused: 1` here beside
     * `repaired: 1, refused: 1` two keys over, in one file. One definition,
     * in the scorer, where `publish.mjs` re-derives it.
     */
    ...(FAULTS > 0
      ? {
          faults: {
            calls: faultedCalls.map((c) => ({
              turn: c.turn,
              tool: c.name,
              kinds: c.faultsInjected ?? [],
              repairs: c.repairs ?? [],
              ok: c.ok,
            })),
          },
        }
      : {}),
  }
}

/* -------------------------------------------------------------------------- */
/* The run                                                                     */
/* -------------------------------------------------------------------------- */

await proveSwitches(runAgent)
await proveTruncation(runAgent)
await proveWindow(runAgent)

/**
 * The round cap every conversation runs under. `BENCH_MAX_STEPS`, else the
 * loop's own default — measured, see `measureDefaultMaxSteps`. Recorded in
 * `setup` either way, because the stuck detector's thresholds make the cap
 * part of what a stuck figure means.
 */
const APP_MAX_STEPS = await measureDefaultMaxSteps(runAgent)
const MAX_STEPS = (() => {
  const asked = process.env['BENCH_MAX_STEPS']
  if (asked === undefined || asked === '') return APP_MAX_STEPS
  const n = Number(asked)
  if (!Number.isInteger(n) || n < 1) throw new Error(`BENCH_MAX_STEPS must be a whole number of at least 1, not ${asked}`)
  return n
})()

await proveRecords(runAgent)
await proveFeedback(runAgent)

type Score = Awaited<ReturnType<typeof runOne>>

/**
 * What one conversation WRITES, proven through `runOne` with a scripted wire.
 *
 * The two probes above prove the loop sees the knobs; this one proves the
 * file says so. A fake case built on the suite's first conversation, one
 * turn, a model that calls `memory_overview` and then answers, run through
 * `runOne` exactly as the suite runs it — so the record is the one
 * `scoreConversation` gets, and three fields on it are checked:
 *
 *   - every call carries `repairs` (`[]` here, nothing was malformed) with the
 *     layer on, and none does with it off — which is the difference between
 *     `summarise.repairs` reading `{ total: 0, byKind: {} }` and `null`;
 *   - `run.window` is the CASE's window, not the run's;
 *   - `run.truncated` is `true` and the first call is the refused one, when
 *     the case asked for the cut; absent when it did not.
 *
 * After `MAX_STEPS`, because `runOne` reads it.
 */
async function proveRecords(run: RunAgent): Promise<void> {
  const base = CONVERSATIONS[0] as Case
  const real = transport
  const drive = async (knobs: { window?: number; truncateFirstCall?: true }) => {
    let n = 0
    transport = async (_m, tools) => {
      n += 1
      // The chooser and summariser ask with no tools; they get prose.
      if (tools.length === 0) return sayTurn('Nothing to add.')
      return n <= 2 ? callTurn('memory_overview', '{}', {}) : sayTurn('The store holds the seeded world.')
    }
    try {
      const turn = base.turns[0]
      if (turn === undefined) throw new Error('the suite has no conversations to build the probe on')
      return await runOne(run, { ...base, id: '(probe records)', turns: [turn], ...knobs }, 'full')
    } finally {
      transport = real
    }
  }

  const plain = await drive({ window: 12_345 })
  if (plain.trajectory.calls < 1) throw new Error('the records probe recorded no calls; the scripted wire did not reach the loop')
  const kinds = plain.trajectory.repairKinds
  if (REPAIR && kinds === undefined) throw new Error('BENCH_REPAIR=1 but the calls carry no `repairs` — a clean run would publish repairs: null')
  if (!REPAIR && kinds !== undefined) throw new Error('BENCH_REPAIR=0 but the calls carry `repairs`; the file would claim the layer was measured')
  if (HARNESS && plain.run.window !== 12_345) throw new Error(`run.window is ${String(plain.run.window)}, not the case's 12345`)
  if (!HARNESS && plain.run.window !== undefined) throw new Error('BENCH_HARNESS=0 but run.window was written')
  if (plain.run.truncated !== undefined) throw new Error('a case that did not ask for truncation has run.truncated set')

  const cut = await drive({ truncateFirstCall: true })
  const firstCall = cut.reasons[0]
  if (cut.run.truncated !== true || firstCall?.truncated !== true) {
    throw new Error(`truncateFirstCall did not reach the file: run=${JSON.stringify(cut.run)} turn0=${JSON.stringify(firstCall)}`)
  }
  if (cut.trajectory.refused < 1) throw new Error('truncateFirstCall fired but no call was refused; the loop did not see the cut')
}

/**
 * The feedback contract (`createFeedback`), proven through `runOne` against
 * the real loop with a scripted wire, on every start.
 *
 * Two runs of a fake case built on the suite's first conversation. The wire
 * answers turn one with a `memory_search` (a real JSON result from the seeded
 * world), every later turn with a fixed paragraph, and the summariser with a
 * sentence carrying a marker. A wrapper around `run` records the `history`
 * and `context` each turn was GIVEN, which is the thing this proves — the
 * transport sees the request the loop built from them, which is the loop's
 * business and `proveWindow`'s.
 *
 * With the harness on, the case's window is PLANNED rather than guessed: the
 * one-turn run yields the exact system message, tool list and turn-one
 * transcript, and `fitHistory` — the loop's own estimate — is then asked for
 * the smallest window at which turn two goes untouched, turn three is fitted
 * by a stub alone, and turn four has to cut and can afford a summary. That
 * shape is the one the old feedback got wrong: the runner that fed
 * `out.messages` back handed turn four the STUB turn three had written, and
 * the ledger walk in `compact` had nothing to read. Sized from the loop's
 * estimate so that a bigger catalogue moves the window rather than breaking
 * the probe; the assertions still say what actually happened.
 *
 * What is checked, over the five turns:
 *   1. no history the loop was given holds a `system` message, a summary
 *      note, or a stubbed tool result;
 *   2. the history of the turn that compacts carries turn one's tool result
 *      VERBATIM — the JSON the executor rendered, not the stub the previous
 *      fit sent — so the evicted prefix `compact` walks is the original;
 *   3. the turn after the compaction is given the app's history exactly: the
 *      user turns of the covered prefix (the loop's own `kept`) verbatim,
 *      then the uncovered tail of ORIGINAL messages — turn one's question
 *      first — and the summary as `context`, which the loop then places
 *      (the marker is in that turn's request).
 * With the harness off nothing compacts, and the last turn must be given the
 * whole transcript, original and system-free.
 */
async function proveFeedback(run: RunAgent): Promise<void> {
  const base = CONVERSATIONS[0] as Case
  /*
   * Sixteen turns, for at least THREE compactions the probe can look past
   * (measured: turns 4, 6, 9, 11, 13, 14, 15 and 16). One
   * would prove the head and the context; it would not prove the arithmetic.
   * With nothing replayed yet the first boundary is the loop's count whether
   * or not the head is discounted; at the second the difference is one
   * message, and it is the user turn the cut stopped before, which the next
   * history replays at the head either way — the same sequence. Only at the
   * third does a boundary that never discounted the head over-advance by the
   * head's whole size and drop an assistant turn from the tail, which is
   * where a wrong boundary is visible.
   *
   * Few turns and fat replies rather than many thin ones, and that was
   * measured: with 24 one-line turns the loop compacted on 4 and 12 and then
   * trimmed plain six times, because every user turn is kept and by turn 19
   * the person's turns alone filled the target (a third of an ~820-token
   * room), so no cut left room for a summary — the loop's floor case, not a
   * fault. Replies of seven sentences from turn five keep the user share
   * small and the compactions three turns apart.
   */
  const SAY = [
    'What do I have on file about applications?',
    'Which of those is the furthest along?',
    'And which one is the earliest?',
    'Is anything on that list waiting on me?',
    'What did we start with?',
    // Turn 11 repeats turn 8 word for word: the runner finds what a turn added
    // by its question, and a search from the front would take the earlier
    // copy — still in the history — and duplicate everything between.
    ...[6, 7, 8, 9, 10, 8, 12, 13, 14, 15, 16].map((n) => `Question ${String(n)}: which of those has the nearest date?`),
  ] as const
  const MARKER = 'probe-summary-7f3a'
  const SUMMARY = `Earlier turns listed the applications on file and compared their stages (${MARKER}).`
  // No capitalised name, no first-person claim, nothing repeated ten times:
  // the verify gate and the chant scan must both stay quiet, and each reply
  // differs so the stuck detector sees no repeat. `sentences` is the plan's
  // second axis, below: the reply has to be small beside the tool result for
  // a stub alone to fit turn three, and big enough that turn four cannot.
  let sentences = 3
  const reply = (n: number): string =>
    `Reply ${String(n)}. ${Array.from(
      // The plan sizes replies one and two; from the third on they are fat.
      { length: n < 3 ? sentences : sentences + 5 },
      (_, i) =>
        `point ${String(i + 1)} of reply ${String(n)}: the listing covered the employer, the stage and the next date for each application on file, in the order the store returned them.`,
    ).join(' ')}`
  const FIRST = 'The store lists the applications on file, each with an employer and a stage.'

  const sent: { history: readonly ChatMessage[]; context: string | undefined }[] = []
  const outs: AgentRun[] = []
  const wrapped: RunAgent = async (o) => {
    sent.push({ history: o.history, context: o.context })
    const out = await run(o)
    outs.push(out)
    return out
  }
  const WITHHELD = 'withheld to save room'
  const NOTE = 'summarised, not verbatim'
  let system: ChatMessage | undefined
  let tools: readonly unknown[] = []
  /** Turn index of each request that carried a stubbed result, and each that carried the marker. */
  const stubbedAt = new Set<number>()
  const markerAt = new Set<number>()
  let rounds = 0
  const real = transport
  transport = async (m, t) => {
    const turn = sent.length - 1
    if (m.some((x) => x.role === 'tool' && x.content.includes(WITHHELD))) stubbedAt.add(turn)
    if (m.some((x) => typeof x.content === 'string' && x.content.includes(MARKER))) markerAt.add(turn)
    if (t.length === 0) return sayTurn(SUMMARY)
    rounds += 1
    system ??= m[0]
    if (tools.length === 0) tools = t
    const last = m[m.length - 1]
    if (last?.role === 'tool') return sayTurn(FIRST)
    if (last?.role !== 'user') throw new Error(`the feedback probe's wire was asked after a ${String(last?.role)} message`)
    const i = (SAY as readonly string[]).indexOf(last.content)
    if (i === 0) return callTurn('memory_search', JSON.stringify({ query: 'application' }), { query: 'application' })
    if (i > 0) return sayTurn(reply(i))
    throw new Error(`the feedback probe's wire was asked after an unscripted user message: ${JSON.stringify(last.content.slice(0, 120))}`)
  }
  const drive = (id: string, says: readonly string[], knobs: { window?: number }) =>
    runOne(wrapped, { ...base, id, turns: says.map((say) => ({ say, why: 'feedback probe' })), ...knobs }, 'full')
  const user = (content: string): ChatMessage => ({ role: 'user', content })
  const assistant = (content: string): ChatMessage => ({ role: 'assistant', content })
  const same = (a: readonly ChatMessage[], b: readonly ChatMessage[]): boolean =>
    JSON.stringify(a) === JSON.stringify(b)
  const untouched = (t: Trimmed): boolean => !t.overflows && t.dropped === 0 && t.stubbed === 0

  try {
    // One turn, no ceiling: the original transcript of turn one, and the fixed part.
    await drive('(probe feedback: one turn)', [SAY[0]], { window: 1_000_000 })
    const first = outs[0]
    if (first === undefined || system?.role !== 'system') throw new Error('the feedback probe did not reach the loop')
    const turnOne = addedBy(first.messages, SAY[0])
    const result = turnOne.find((m) => m.role === 'tool')
    if (result === undefined || result.content.includes(WITHHELD)) throw new Error('the feedback probe recorded no tool result on turn one')
    try {
      JSON.parse(result.content)
    } catch {
      throw new Error(`turn one's tool result is not the executor's JSON: ${result.content.slice(0, 120)}`)
    }
    if (rounds !== 2) throw new Error(`the one-turn probe made ${String(rounds)} rounds, not 2`)

    /*
     * The plan, from the loop's own estimate. `fixed` is what the loop
     * measures against: the system message, the question and the offered
     * specs. Two axes: the window, scanned upward from the smallest at which
     * turn two goes untouched (a wider one only makes turn three fit whole),
     * and the reply's length, because the shape wanted is a ratio — after the
     * stub, turn three's prose must sit under the target (a third of the room
     * once the schemas take more than a third of the window) and turn four's
     * must not. Measured on the seeded world: the result is 714 tokens and
     * its stub 49, the rest of turn one 105, so a three-sentence reply (178
     * with its question) left turn three at 333 against a target of 273 and
     * the loop cut on turn three; two sentences fit it and let turn four cut.
     */
    const fixed = (q: string): unknown[] => [system, user(q), tools]
    const plan = (): number | null => {
      const two = turnOne
      const three = [...two, user(SAY[1]), assistant(reply(1))]
      const four = [...three, user(SAY[2]), assistant(reply(2))]
      let lo = 1
      let hi = 1 << 22
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2)
        if (untouched(fitHistory(two, fixed(SAY[1]), mid))) hi = mid
        else lo = mid + 1
      }
      for (let w = lo; ; w += 4) {
        const t3 = fitHistory(three, fixed(SAY[2]), w)
        if (untouched(t3)) return null
        const t4 = fitHistory(four, fixed(SAY[3]), w)
        const stubOnly = t3.dropped === 0 && t3.stubbed > 0
        const cuts = t4.dropped > 0 && t4.summarisable && t4.toSummarise.length > 0 && t4.summaryChars >= MIN_SUMMARY_CHARS
        if (stubOnly && cuts) return w
      }
    }
    let window: number | undefined
    if (HARNESS) {
      for (sentences = 1; sentences <= 8 && window === undefined; sentences += 1) window = plan() ?? undefined
      if (window === undefined) {
        throw new Error(`no reply length up to eight sentences and no window make turn three stub and turn four cut against a ${String(result.content.length)}-character tool result; the fit's stages have changed shape and this probe needs re-planning`)
      }
      sentences -= 1
    }

    sent.length = 0
    outs.length = 0
    rounds = 0
    const score = await drive('(probe feedback)', SAY, window === undefined ? {} : { window })
    if (sent.length !== SAY.length || outs.length !== SAY.length) throw new Error(`the feedback probe ran ${String(outs.length)} of ${String(SAY.length)} turns`)
    if (rounds !== SAY.length + 1) throw new Error(`the feedback probe made ${String(rounds)} rounds over ${String(SAY.length)} turns, not ${String(SAY.length + 1)} — a nudge or a retry the script did not plan for`)
    /*
     * What each turn added, from the script rather than from `addedBy`: the
     * wire is known — two rounds on turn one (call, result, answer), one on
     * every later turn — so the count is known, and an `addedBy` that found
     * the wrong question would otherwise be checked against itself.
     */
    const addedIn = (i: number): ChatMessage[] => {
      const added = (outs[i]?.messages ?? []).slice(i === 0 ? -4 : -2)
      if (added[0]?.role !== 'user' || added[0].content !== SAY[i]) throw new Error(`turn ${String(i + 1)}'s run did not end with its question and reply as scripted`)
      return added
    }
    const transcript = outs.flatMap((_, i) => addedIn(i))

    // 1. Never the system prompt, never a summary note, never a stub.
    sent.forEach((s, i) => {
      if (s.history.some((m) => m.role === 'system')) throw new Error(`turn ${String(i + 1)} was given a system message in its history — the runner is feeding the request back, not the conversation`)
      if (s.history.some((m) => typeof m.content === 'string' && m.content.includes(NOTE))) throw new Error(`turn ${String(i + 1)} was given a summary note in its history; the summary travels as context`)
      if (s.history.some((m) => m.role === 'tool' && m.content.includes(WITHHELD))) throw new Error(`turn ${String(i + 1)} was given a stubbed tool result; the runner must keep the original`)
    })

    /** The transcript as it stood BEFORE turn `i`: what turns `0..i` added. */
    const before = (i: number): ChatMessage[] => transcript.slice(0, i === 0 ? 0 : 4 + 2 * (i - 1))

    if (window === undefined) {
      // Nothing compacts, so the last turn is given everything before it, original.
      const last = sent[SAY.length - 1]
      if (last === undefined || !same(last.history, before(SAY.length - 1))) throw new Error('with the harness off, the last turn was not given the whole original transcript')
      if (sent.some((s) => s.context !== undefined)) throw new Error('with the harness off a context was passed; nothing was summarised')
      return
    }

    // 2. The first compaction, where planned, after a turn that was fitted by
    // a stub — and the ledger it wrote, which is what the original buys.
    const compactedAt = score.reasons.flatMap((r, i) => (r.compacted ? [i] : []))
    if (compactedAt[0] !== 3) {
      throw new Error(`the plan was a first compaction on turn 4 at window ${String(window)}; the loop compacted on ${JSON.stringify(compactedAt.map((i) => i + 1))} (stubs seen on ${JSON.stringify([...stubbedAt].map((i) => i + 1))})`)
    }
    if (compactedAt.length < 3) {
      throw new Error(`the probe needs three compactions over ${String(SAY.length)} turns to check the boundary arithmetic; the loop compacted on ${JSON.stringify(compactedAt.map((i) => i + 1))} at window ${String(window)}`)
    }
    if (!stubbedAt.has(2)) throw new Error(`the plan was a stub-only fit on turn 3 at window ${String(window)}; stubs were seen on ${JSON.stringify([...stubbedAt].map((i) => i + 1))}, so the probe cannot tell the original from the stub`)
    // This run's own turn one, not the one-turn run's: each `runOne` seeds a
    // fresh world, and the ids in the result are minted per world.
    const original = transcript.find((m) => m.role === 'tool')
    const given = sent[3]?.history.find((m) => m.role === 'tool')
    if (original === undefined || original.content.includes(WITHHELD)) throw new Error('the probe recorded no original tool result on turn one')
    if (given === undefined || given.content !== original.content) {
      throw new Error(`the compacting turn was given ${given === undefined ? 'no tool result' : `a tool result that is not the original: ${given.content.slice(0, 100)}`}`)
    }
    const firstSummary = outs[3]?.compacted?.context ?? ''
    if (!firstSummary.includes(LEDGER_HEADING)) {
      throw new Error(`the first summary names no records — the evicted result reached compact as something other than the executor's JSON: ${firstSummary.slice(0, 200)}`)
    }

    // 3. After every compaction: the app's history, and the summary as
    // context. `through` here is the app's arithmetic (`nextContextThrough`
    // over messages) run beside the runner's, from the loop's own counts.
    let through = 0
    let checked = 0
    for (const k of compactedAt) {
      const written = outs[k]?.compacted
      const after = sent[k + 1]
      if (written === undefined) throw new Error(`turn ${String(k + 1)} compacted but reported no summary`)
      // A compaction on the last turn has no successor to check.
      if (after === undefined) break
      checked += 1
      const stood = before(k)
      const replayed = stood.slice(0, through).filter((m) => m.role === 'user').length
      if (written.messages <= replayed) throw new Error(`turn ${String(k + 1)}'s cut (${String(written.messages)}) covered only the replayed head (${String(replayed)}); nothing to check`)
      through += written.messages - replayed
      const next = before(k + 1)
      const covered = next.slice(0, through)
      if (k === 3 && (covered[0]?.role !== 'user' || !covered.some((m) => m.role === 'tool'))) {
        throw new Error(`the first cut covered ${String(written.messages)} messages and left turn one's result in the tail; the probe would prove nothing`)
      }
      const expected = [...covered.filter((m) => m.role === 'user'), ...next.slice(through)]
      if (!same(after.history, expected)) {
        throw new Error(`turn ${String(k + 2)} was not given the app's history.\n  expected: ${JSON.stringify(expected.map((m) => [m.role, String(m.content ?? '').slice(0, 40)]))}\n  given:    ${JSON.stringify(after.history.map((m) => [m.role, String(m.content ?? '').slice(0, 40)]))}`)
      }
      const head = after.history[0]
      if (head === undefined || head.role !== 'user' || head.content !== SAY[0]) throw new Error(`turn ${String(k + 2)}'s history does not start with turn one's question verbatim`)
      if (!same(stood.slice(0, through).flatMap((m) => (m.role === 'user' ? [user(m.content)] : [])), written.kept.map(user))) {
        throw new Error(`turn ${String(k + 1)}: the covered prefix's user turns are not what the loop reported as kept`)
      }
      if (after.context !== written.context) throw new Error(`turn ${String(k + 2)} was given context ${JSON.stringify(after.context?.slice(0, 80))}, not the summary turn ${String(k + 1)} wrote`)
      if (!written.context.includes(MARKER)) throw new Error(`the summary the loop wrote on turn ${String(k + 1)} does not carry the scripted sentence: ${written.context.slice(0, 160)}`)
      if (!markerAt.has(k + 1)) throw new Error(`the context turn ${String(k + 2)} was given did not reach the model; the loop placed no note carrying it`)
    }
    if (checked < 3) throw new Error(`the probe checked ${String(checked)} compaction(s); it needs three to see a wrong boundary (compacted on ${JSON.stringify(compactedAt.map((i) => i + 1))})`)
  } finally {
    transport = real
  }
}

/**
 * One condition's row: the scorer's summary, and the scores it was made from.
 *
 * Nothing of the runner's is written over `summarise`'s keys. This used to
 * spread the summary and then replace `faults` (and before that `injection`)
 * with a tally of its own — a different shape under the same name, and on
 * `stripe-offer` at rate 0.6, seed 3, a different NUMBER: `repaired: 7,
 * refused: 1` here against the scorer's `repaired: 6, refused: 1`, because
 * this file counted a repaired-then-refused call twice. `publish.mjs` recounts
 * from the scores and would have put the scorer's figure in the payload, so
 * the raw file and the published table disagreed about the one metric the
 * fault layer exists to produce. Every roll-up — `faults`, `injection`,
 * `stops`, `stuck`, `verify`, `compactions`, `cost` — is now the scorer's, and
 * a reader who wants the faults by kind has them per call in each score's
 * `faults.calls`.
 */
function row(condition: Condition, scores: Score[]) {
  return { condition, ...summarise(scores), scores }
}

type Row = ReturnType<typeof row>

const runs: { run: number; report: Row[] }[] = []
for (let r = 1; r <= RUNS; r++) {
  const report: Row[] = []
  for (const condition of ['full', 'narrowed'] as Condition[]) {
    const scores: Score[] = []
    for (const c of LIST) {
      const s = await runOne(runAgent, c, condition, RUNS > 1 ? r - 1 : undefined)
      scores.push(s)
      process.stderr.write(`${RUNS > 1 ? `run ${String(r)}/${String(RUNS)} ` : ''}${condition} ${s.clean ? 'ok  ' : 'FAIL'} ${s.conversation}\n`)
    }
    report.push(row(condition, scores))
  }
  runs.push({ run: r, report })
}

/*
 * A run that watched nothing is not a run, and it does not look like a failure.
 *
 * The event union discriminates on `type`; this file read `kind`, so the filter
 * was never true and every tool call was dropped on the floor. The store still
 * changed — the calls really happened — so the state axis passed and only the
 * turn axis collapsed, which reads exactly like a model that answers in prose
 * without acting. Six conversations were blamed on Gemma before the trace
 * showed zero recorded calls against a store that had grown a snippet.
 *
 * Nothing about that was visible in the output. So: a suite in which no
 * conversation ever records a call is a broken observer, and it refuses to
 * write a file that someone might later quote.
 */
const observed = runs.reduce<number>((n, r) => n + r.report.reduce((m, x) => m + x.calls, 0), 0)
if (observed === 0) {
  throw new Error(
    'the run recorded zero tool calls across every conversation — the observer is broken, not the model. Refusing to write a report.',
  )
}

/**
 * The spread of the headline numbers across runs.
 *
 * Sample standard deviation (n − 1), and `null` below two runs rather than
 * zero: one run has no spread to report, and a zero would read as "measured,
 * stable". `values` is kept so a reader can see the shape and not only two
 * moments of it — five runs of 46, 46, 46, 46, 40 is a different fact from
 * five runs of 44, 45, 44, 46, 45 at nearly the same mean.
 */
const spread = (values: readonly number[]) => {
  const n = values.length
  const mean = values.reduce((a, v) => a + v, 0) / n
  const raw = n < 2 ? null : Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1))
  // Three identical F1s of 0.8 report a spread of 1.4e-16. That is the
  // arithmetic, not a measurement, and a reader scanning for non-zero would
  // stop on it.
  const sd = raw === null ? null : raw < 1e-9 ? 0 : raw
  return { mean, sd, min: Math.min(...values), max: Math.max(...values), values: [...values] }
}

const HEADLINE: Record<string, (x: Row) => number | null> = {
  conversationsClean: (x) => x.conversationsClean,
  turnsCorrect: (x) => x.turnsCorrect,
  stateChecksPassed: (x) => x.stateChecksPassed,
  refusalRate: (x) => x.refusalRate,
  repairs: (x) => x.repairs?.total ?? null,
  nodeF1: (x) => x.graph.nodeF1,
  linkF1: (x) => x.graph.linkF1,
}

const repeats =
  RUNS < 2
    ? {}
    : {
        repeats: Object.fromEntries(
          (['full', 'narrowed'] as Condition[]).map((condition) => {
            const rows = runs.map((r) => r.report.find((x) => x.condition === condition)!)
            const noise = Object.fromEntries(
              Object.entries(HEADLINE).flatMap(([name, pick]) => {
                const values = rows.map(pick)
                // A metric that is null in any run (no gold graph, say) has no spread.
                return values.every((v): v is number => v !== null) ? [[name, spread(values)]] : []
              }),
            )
            /*
             * The conversations that flipped, which is the list a person acts on.
             *
             * A standard deviation says how wide the band is; this says WHICH
             * cases make it wide, and whether a fix moved one of them or one of
             * the stable ones. Qwen's "5 fixed / 6 broke on identical code" was
             * only readable at all by diffing two files by hand.
             */
            const unstable = LIST.flatMap((c) => {
              const cleanIn = rows.filter((x) => x.scores.find((s) => s.conversation === c.id)?.clean === true).length
              return cleanIn > 0 && cleanIn < RUNS ? [{ conversation: c.id, cleanIn, of: RUNS }] : []
            })
            return [condition, { noise, unstable }]
          }),
        ),
      }

writeFileSync(
  OUT,
  JSON.stringify(
    {
      model: MODEL,
      url: URL,
      /*
       * `reserve` is here because it changed under a completed run once and
       * nothing in the file would have said so. It decides how much prompt gets
       * packed in, so it decides when history is trimmed — a score measured
       * either side of a change to it is a score measured under a different
       * setup, whatever the window says.
       *
       * Everything after it is a switch this file added, and each is here for
       * the same reason: `publish.mjs` compares this object whole, so a run
       * with repair off, or faults on, or a different thinking mode, cannot be
       * published beside a baseline as though it were one. `runs` is NOT in
       * here — repeating a measurement does not change what was measured, and
       * `report` below is the first run, which is exactly the file a single
       * run would have written.
       */
      setup: {
        harness: HARNESS,
        ...(HARNESS ? { window: WINDOW } : {}),
        reserve: RESERVED_FOR_REPLY,
        transport: TRANSPORT,
        // The raw request carries no thinking field, which is what this mode means.
        thinking: TRANSPORT === 'raw' ? 'server-default' : THINKING,
        temperature: TEMPERATURE,
        ...(MAX_TOKENS > 0 ? { maxTokens: MAX_TOKENS } : {}),
        repair: REPAIR,
        stuck: STUCK,
        verify: VERIFY,
        // What the loop was told. Under this runner the gate is inert (no
        // `approve` is passed — see `GATE`), and the cap is the app's own
        // unless overridden; both change what a stuck or verify number means.
        gate: GATE,
        maxSteps: MAX_STEPS,
        faults: FAULTS,
        ...(FAULTS > 0 ? { seed: SEED } : {}),
        inject: INJECT,
      },
      runs: RUNS,
      report: runs[0]!.report,
      // Runs two onward, in full. `report` is run one, so nothing is written twice.
      ...(RUNS > 1 ? { laterRuns: runs.slice(1) } : {}),
      ...repeats,
    },
    null,
    2,
  ),
)
console.log('written', OUT, `— ${String(observed)} calls observed over ${String(RUNS)} run(s)`)
