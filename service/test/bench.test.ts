/**
 * The multi-turn agentic benchmark, run against real models and a real store.
 *
 * INERT unless `JOJO_BENCH=1`. It builds a world, holds conversations with a
 * language model over somebody's GPU, and takes tens of minutes — a gate that
 * depended on that is a gate people learn to ignore.
 *
 *   JOJO_BENCH=1 npx vitest run test/bench --root service
 *   JOJO_BENCH=1 JOJO_BENCH_MODEL=qwen3_14b npx vitest run test/bench --root service
 *   JOJO_BENCH=1 JOJO_BENCH_OUT=/tmp/bench.json npx vitest run test/bench --root service
 *
 * ## What makes this different from `live-eval.test.ts`
 *
 * That one asks "given a sentence, does the model name a sensible tool" and
 * grades the first call. It is a tool-choice quiz and it is the easy half.
 *
 * This one gives the model a real store, runs the real agent loop so calls are
 * EXECUTED, and then asks what the store looks like afterwards. The difference
 * shows up on exactly the cases that matter: a model can name
 * `application.stage.set` correctly and still set the stage on the wrong Rice
 * application, and only a benchmark that looks at the store afterwards can
 * tell.
 *
 * ## Each conversation gets a fresh world
 *
 * Rebuilt from scratch between conversations, because otherwise conversation
 * four is scored against damage done in conversation two, and every number
 * after the first failure is meaningless. It costs a few milliseconds — the
 * world is built in-memory through the tool runtime, with no driver behind it.
 */

import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MutableSnapshot } from '../kg/core/snapshot'
import { createRepository } from '../kg/repo/repository'
import { createToolRuntime } from '../kg/tools/runtime'
import type { NodeId } from '../kg/core/model'
import type { GraphSnapshot } from '../kg/core/snapshot'
import type { ToolName } from '../kg/tools/index'
import type { ToolHost } from '../kg/agent/execute'
import type { ChatMessage, Turn } from '../kg/core/model-server'
import { CATALOG, functionSpecs, toWireName } from '../kg/agent/catalog'
import { runAgent, type AgentStep } from '../kg/agent/loop'
import { inCatalogOrder, offeredFor } from '../kg/agent/retrieve'
import { BENCH_NOW, BENCH_TODAY, DOCUMENTS, WORLD, WORLD_SHAPE } from '../kg/agent/bench-world'
import { CONVERSATIONS, TURN_COUNT } from '../kg/agent/bench-conversations'
import {
  scoreConversation,
  summarise,
  type BenchNode,
  type CallRecord,
} from '../kg/agent/bench-score'

const MODELS = [
  { id: 'gemma_4_31b', endpoint: 'http://10.116.34.124:8103/v1', label: 'Gemma 3 31B' },
  { id: 'qwen3_14b', endpoint: 'http://10.116.34.124:8109/v1', label: 'Qwen3 14B' },
  { id: 'gpt_oss_120b', endpoint: 'http://10.116.34.124:8116/v1', label: 'GPT-OSS 120B' },
]

/**
 * The two facts the app's own system prompt cannot carry, added as history.
 *
 * `runAgent` supplies `SYSTEM_PROMPT` itself and splices `history` after it, so
 * this arrives as a second system message rather than replacing the real one —
 * which is what we want: the benchmark should measure the app's prompt, not a
 * substitute written to make it look good.
 *
 * The DATE is here because half the conversations turn on "this month" and "two
 * days before", and a model that does not know what day it is fails those for a
 * reason with nothing to do with tool calling. The AMBIGUITY line is here
 * because asking rather than guessing is the behaviour under test, and a model
 * never told it may ask is being scored on a rule it was not given.
 */
const PREAMBLE = [
  `Today is ${BENCH_TODAY}.`,
  'If a request could mean more than one record, ask which one instead of guessing.',
].join(' ')

/* ------------------------------- the world -------------------------------- */

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

/**
 * A store with the benchmark world in it, plus the host the agent drives.
 *
 * The clock is fixed at `BENCH_NOW` and advances a second per write, so ids
 * stay ordered and nothing depends on the wall clock. A benchmark whose score
 * moves because the day changed is one nobody can bisect.
 */
function buildWorld() {
  let tick = 0
  const now = () => new Date(Date.parse(BENCH_NOW) + tick++ * 1000).toISOString()
  const repo = createRepository({
    driver: nullDriver() as Parameters<typeof createRepository>[0]['driver'],
    snapshot: new MutableSnapshot(),
    meta: {
      schemaVersion: 1,
      createdAt: BENCH_NOW,
      lastOpenedAt: BENCH_NOW,
      dataSet: 'user',
      seededAt: null,
      handoverAt: null,
    },
    now,
  })
  const runtime = createToolRuntime({ repo, now })

  // `$name` in an input is replaced with the id an earlier step returned.
  const named = new Map<string, string>()
  const resolve = (value: unknown): unknown => {
    if (typeof value === 'string' && value.startsWith('$')) return named.get(value.slice(1)) ?? value
    if (Array.isArray(value)) return value.map(resolve)
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v)]))
    }
    return value
  }

  for (const step of WORLD) {
    const out = runtime.run(step.tool as ToolName, resolve(step.input) as never)
    if (!out.ok) throw new Error(`world step ${step.tool} failed: ${JSON.stringify(out.errors)}`)
    if (step.as) named.set(step.as, String(out.output))
  }

  const host: ToolHost = {
    memory: () => repo.getSnapshot() as GraphSnapshot,
    // The same pinned day the prompt states, so `stats.report` and the model
    // cannot disagree about what is overdue.
    today: () => BENCH_TODAY,
    check: (name, input) => runtime.check(name as ToolName, input) as never,
    run: (name, input) => runtime.run(name as ToolName, input as never) as never,
    /*
     * A document reader, stubbed with real contents.
     *
     * In the app this is a network call to MarkItDown that turns a PDF into
     * text; here it is a lookup. Supplying it is what makes the document
     * conversations answerable at all — without a converter, `vault.file.read`
     * returns "no document reader is connected" and the model is being scored
     * on a capability the harness withheld.
     *
     * The contents are deliberately the only place their facts appear, so a
     * correct answer proves the file was opened rather than guessed at.
     */
    convert: async (fileId: string) => {
      const node = (repo.getSnapshot() as GraphSnapshot).node(fileId as NodeId, 'file')
      const name = node ? String((node.props as { name?: unknown }).name ?? '') : ''
      const markdown = DOCUMENTS[name]
      return markdown === undefined
        ? { ok: false as const, reason: `no stored text for ${name || fileId}` }
        : { ok: true as const, markdown }
    },
  }
  return { repo, host }
}

/**
 * The store flattened into what the scorer reads.
 *
 * Two things are RESOLVED here rather than left as edges, because a state check
 * written in advance cannot name an id that does not exist until the world is
 * built.
 *
 * **Keywords**, to their names — so a check can say `keyword: 'negotiation'`.
 *
 * **The employer**, to `props.org` — and this one is a genuine feature of the
 * model rather than a convenience. An application does not STORE its employer;
 * it points at an organisation through an `AT` edge, and `projections.ts`
 * flattens that for the screens. Doing the same here means the checks are
 * written against what a person sees rather than against the storage shape.
 */
function flatten(repo: ReturnType<typeof buildWorld>['repo']): BenchNode[] {
  const snapshot = repo.getSnapshot() as GraphSnapshot
  const keywordName = new Map<string, string>()
  for (const node of snapshot.ofType('keyword')) {
    keywordName.set(node.id, String((node.props as { name?: unknown }).name ?? ''))
  }
  return snapshot.nodes().map((node) => {
    const org =
      node.type === 'application'
        ? snapshot.one(node.id as NodeId, 'AT', 'organisation')
        : undefined
    return {
      type: node.type,
      props: {
        ...(node.props as Readonly<Record<string, unknown>>),
        ...(org ? { org: (org.props as { name?: unknown }).name } : {}),
      },
      keywords: snapshot
        .many(node.id as NodeId, 'TAGS', 'in', 'keyword')
        .map((k) => keywordName.get(k.id) ?? '')
        .filter(Boolean),
    }
  })
}

/* -------------------------------- the model ------------------------------- */

const ALL_SPECS = functionSpecs() as { function: { name: string } }[]
const byWire = new Map(ALL_SPECS.map((s) => [s.function.name, s]))

/**
 * The tools offered for one turn, exactly as `agent-runs.ts` computes them.
 *
 * `carried` and `calledSoFar` are the whole correctness of this function, and
 * the first version of it had neither — it re-narrowed from scratch on every
 * turn, from that turn's sentence alone. That is HARSHER than anything jojo
 * ships, and it showed up as a model appearing to get worse under narrowing:
 * turn two of a conversation ("the assistant professor one, in computer
 * science") names no capability at all, so a from-scratch selection lost the
 * stage tools that turn one had earned.
 *
 * A benchmark measuring a configuration the app does not have is measuring
 * nothing, and it would have reported that as a fact about the models.
 */
function specsFor(
  prompt: string,
  narrowed: boolean,
  carried: Set<string> | null,
  calledSoFar: readonly string[],
) {
  if (!narrowed) return { specs: ALL_SPECS, chosen: null }
  const chosen = offeredFor(prompt, carried, calledSoFar)
  if (chosen === null) return { specs: ALL_SPECS, chosen: null }
  return {
    specs: inCatalogOrder(chosen)
      .map((name) => byWire.get(toWireName(name)))
      .filter((s): s is { function: { name: string } } => s !== undefined),
    chosen,
  }
}

function llmFor(model: (typeof MODELS)[number]) {
  return async (messages: readonly ChatMessage[], tools: readonly unknown[]): Promise<Turn> => {
    const response = await fetch(`${model.endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.id,
        messages,
        ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
        stream: false,
        // Two of these three models reason before answering; a budget that cuts
        // them off scores a thinking model as a broken one.
        max_tokens: 2048,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(240_000),
    })
    if (!response.ok) {
      return { ok: false, kind: 'refused', reason: `HTTP ${String(response.status)}` }
    }
    const payload = (await response.json()) as {
      choices?: { message?: { content?: string | null; tool_calls?: unknown[] }; finish_reason?: string }[]
    }
    const message = payload.choices?.[0]?.message
    const raw = Array.isArray(message?.tool_calls) ? message.tool_calls : []
    const toolCalls = raw.map((entry, index) => {
      const fn = (entry as { function?: { name?: string; arguments?: string } }).function
      const args = fn?.arguments ?? '{}'
      let parsed: unknown = null
      try {
        parsed = JSON.parse(args === '' ? '{}' : args)
      } catch {
        parsed = null
      }
      return {
        id: (entry as { id?: string }).id ?? `call_${String(index)}`,
        name: fn?.name ?? '',
        args: parsed,
        raw: args,
      }
    })
    const text = message?.content ?? null
    if (text === null && toolCalls.length === 0) {
      return { ok: false, kind: 'malformed', reason: 'empty turn' }
    }
    return { ok: true, text, toolCalls, finishReason: payload.choices?.[0]?.finish_reason ?? null }
  }
}

/* -------------------------------- the run --------------------------------- */

const enabled = process.env['JOJO_BENCH'] === '1'
const wanted = process.env['JOJO_BENCH_MODEL']
const models = wanted ? MODELS.filter((m) => m.id === wanted) : MODELS
const conditions = (process.env['JOJO_BENCH_CONDITION']?.split(',') ?? ['full', 'narrowed']) as (
  | 'full'
  | 'narrowed'
)[]

describe.skipIf(!enabled)('multi-turn agentic benchmark', () => {
  it('holds every conversation with every model and scores three axes', { timeout: 14_400_000 }, async () => {
    const report: unknown[] = []

    for (const model of models) {
      for (const condition of conditions) {
        const scores = []

        for (const conversation of CONVERSATIONS) {
          // A fresh world per conversation: otherwise conversation four is
          // scored against damage done in conversation two.
          const { repo, host } = buildWorld()
          const perTurn: { calls: CallRecord[]; answered: boolean }[] = []
          let history: ChatMessage[] = [{ role: 'system', content: PREAMBLE }]
          /*
           * What this conversation has accumulated, and what it has actually
           * called. Both are what `agent-runs.ts` threads through, and both are
           * why a later turn does not lose a tool an earlier one earned.
           */
          let carried: Set<string> | null = null
          const calledSoFar: string[] = []

          for (const [index, turn] of conversation.turns.entries()) {
            const calls: CallRecord[] = []
            let answered = false
            const offered = specsFor(turn.say, condition === 'narrowed', carried, calledSoFar)
            // Monotone: a conversation only ever gains tools, which is the rule
            // `offeredFor` states and the reason a correction can still act.
            if (offered.chosen) carried = offered.chosen
            try {
              const run = await runAgent({
                host,
                llm: llmFor(model),
                history,
                prompt: turn.say,
                tools: inCatalogOrder(
                  new Set(
                    offered.specs.map(
                      (s) =>
                        CATALOG.find((e) => e.wireName === s.function.name)?.name ?? s.function.name,
                    ),
                  ),
                ),
                maxSteps: 6,
                onEvent: (event) => {
                  if (event.type !== 'step') return
                  const step = event.step as AgentStep
                  if (step.status === 'running') return
                  calls.push({
                    turn: index,
                    name: step.name,
                    effect: step.effect,
                    ok: step.status === 'done',
                  })
                  calledSoFar.push(step.name)
                },
              })
              answered = run.answer !== null && run.answer.trim().length > 0
              // The next turn continues this conversation, which is the whole
              // point — a correction only means something given what came before.
              history = run.messages.filter((m) => m.role !== 'system')
            } catch (cause) {
              calls.push({ turn: index, name: `?error`, effect: 'unknown', ok: false })
              void cause
            }
            // Steps arrive twice (running, then settled); the running ones are
            // filtered above, but a retried call can still land twice.
            perTurn.push({ calls, answered })
          }

          const score = scoreConversation(conversation, perTurn, flatten(repo))
          scores.push(score)
          const mark = score.clean ? 'ok  ' : 'FAIL'
          const bad = score.turns.filter((t) => !t.correct).map((t) => t.failure)
          const badState = score.state.filter((s) => !s.pass).length
          console.log(
            `${mark} ${model.id.padEnd(13)} ${condition.padEnd(9)} ${conversation.id.padEnd(22)} ` +
              `turns ${String(score.turns.filter((t) => t.correct).length)}/${String(score.turns.length)} ` +
              `state ${String(score.state.length - badState)}/${String(score.state.length)}` +
              (bad.length > 0 ? `  ${bad.join(',')}` : ''),
          )
        }

        const totals = summarise(scores)
        report.push({ model: model.id, label: model.label, condition, ...totals, scores })
        console.log(
          `\n  ${model.label} · ${condition}: ` +
            `${String(totals.conversationsClean)}/${String(totals.conversations)} conversations clean, ` +
            `${String(totals.turnsCorrect)}/${String(totals.turns)} turns, ` +
            `${String(totals.stateChecksPassed)}/${String(totals.stateChecks)} state checks, ` +
            `grounded ${(totals.grounded * 100).toFixed(0)}%, ` +
            `looked-first ${(totals.lookedFirst * 100).toFixed(0)}%, ` +
            `refused ${(totals.refusalRate * 100).toFixed(0)}%\n`,
        )
      }
    }

    const out = process.env['JOJO_BENCH_OUT']
    if (out) {
      writeFileSync(out, `${JSON.stringify({ ranAt: new Date().toISOString(), report }, null, 2)}\n`)
      console.log(`wrote ${out}`)
    }

    expect(report.length).toBe(models.length * conditions.length)
  })
})

describe('the benchmark world builds and is the shape it says', () => {
  /*
   * This half runs in the ORDINARY test suite, with no model anywhere near it.
   *
   * A benchmark that silently built a different world than it meant to would
   * report model failures that are its own — two Rice applications is the
   * entire premise of three conversations, and a setup that quietly made one
   * would turn the hardest cases into easy ones and nobody would notice.
   */
  it('builds without a single step failing', () => {
    expect(() => buildWorld()).not.toThrow()
  })

  it('contains exactly what the conversations assume', () => {
    const nodes = flatten(buildWorld().repo)
    for (const [type, count] of Object.entries(WORLD_SHAPE)) {
      expect(nodes.filter((n) => n.type === type).length, type).toBe(count)
    }
  })

  it('really does hold two Rice applications, which three conversations depend on', () => {
    const nodes = flatten(buildWorld().repo)
    const rice = nodes.filter(
      (n) => n.type === 'application' && String(n.props['org']).includes('Rice'),
    )
    expect(rice).toHaveLength(2)
    // And they must be distinguishable by role, or "the assistant professor
    // one" in `rice-resolved` cannot be followed either.
    expect(new Set(rice.map((r) => String(r.props['role']))).size).toBe(2)
  })

  it('holds two UT campuses, one already closed', () => {
    const nodes = flatten(buildWorld().repo)
    const ut = nodes.filter((n) => n.type === 'application' && String(n.props['org']).startsWith('UT'))
    expect(ut).toHaveLength(2)
    // `stage: 'closed'` with `outcome: 'rejected'` — this app separates where
    // you are from how it ended, and the conversation depends on one campus
    // being live while the other is not.
    expect(ut.filter((a) => a.props['stage'] === 'closed')).toHaveLength(1)
    expect(ut.filter((a) => a.props['outcome'] === 'rejected')).toHaveLength(1)
    expect(ut.filter((a) => a.props['stage'] === 'submitted')).toHaveLength(1)
  })

  it('resolves keyword edges to names, which the state checks are written against', () => {
    const nodes = flatten(buildWorld().repo)
    const stripe = nodes.find((n) => n.type === 'application' && String(n.props['org']) === 'Stripe')
    expect(stripe?.keywords).toContain('systems')
  })

  it('has a turn count the report can use as a denominator', () => {
    expect(TURN_COUNT).toBe(CONVERSATIONS.reduce((n, c) => n + c.turns.length, 0))
    expect(TURN_COUNT).toBeGreaterThan(15)
  })
})
