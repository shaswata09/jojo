/**
 * The tool-calling evaluation, run against real model servers.
 *
 * INERT unless `JOJO_EVAL` is set, which is what lets it live beside the
 * ordinary tests without being one. It makes real HTTP calls to somebody's GPU,
 * takes minutes, and fails when a machine is off — a gate that depended on that
 * is a gate people learn to ignore.
 *
 *   JOJO_EVAL=1 npx vitest run kg/agent/live-eval --root service
 *   JOJO_EVAL=1 JOJO_EVAL_MODEL=qwen3_14b npx vitest run kg/agent/live-eval --root service
 *
 * A vitest file rather than a script because it needs the workspace's module
 * resolution — the catalog reaches through `kg/tools/index`, and Node's type
 * stripping cannot follow an extensionless TypeScript import. Borrowing the
 * test runner's resolver is cheaper than maintaining a second build for one
 * script.
 *
 * It lives under `test/` rather than beside the code it exercises because
 * `check-platform` scans `kg/` and rightly refuses `node:fs`, `fetch`,
 * `process` and a wall clock in there — that layer is mounted unchanged inside
 * React Native and a browser. This file is none of those things: it is a
 * harness that runs on a developer's machine, and `test/` is where the vitest
 * config already looks for exactly that.
 *
 * ## What is being measured
 *
 * Every scenario runs TWICE per model: once with jojo's whole catalog, once
 * with the set the retriever chose for that prompt. That comparison is the
 * actual question. Narrowing is SUPPOSED to help a small model by giving it
 * fewer names to confuse — but it could equally hurt by removing something
 * needed, and only running both says which way it falls for a given model.
 */

import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SCENARIOS, grade, type Outcome } from '../kg/agent/eval-scenarios'
import { CATALOG, functionSpecs, toWireName } from '../kg/agent/catalog'
import { inCatalogOrder, offeredFor } from '../kg/agent/retrieve'

const MODELS = [
  { id: 'gemma_4_31b', endpoint: 'http://10.116.34.124:8103/v1', label: 'Gemma 3 31B' },
  { id: 'qwen3_14b', endpoint: 'http://10.116.34.124:8109/v1', label: 'Qwen3 14B' },
  { id: 'gpt_oss_120b', endpoint: 'http://10.116.34.124:8116/v1', label: 'GPT-OSS 120B' },
]

/**
 * The instruction the models are given, deliberately short.
 *
 * A long prompt full of coaching would measure the prompt rather than the
 * model. The point is to find out what these models do with jojo's real
 * catalog, not how far one paragraph can be tuned to rescue them.
 */
const SYSTEM =
  'You help someone manage their job applications. ' +
  'Use the tools to look things up and to make changes. ' +
  'Always look a record up before changing it — never invent an id. ' +
  'If nothing needs doing, just answer.'

type Row = Outcome & {
  model: string
  condition: 'full' | 'narrowed'
  ms: number
  promptTokens: number | null
  offered: number
}

const ALL_SPECS = functionSpecs() as { function: { name: string } }[]
const byWire = new Map(ALL_SPECS.map((s) => [s.function.name, s]))

/** The retriever's set for a prompt, in the shape the wire wants. */
function narrowedSpecs(prompt: string) {
  const chosen = offeredFor(prompt, null)
  if (chosen === null) return ALL_SPECS
  return inCatalogOrder(chosen)
    .map((name) => byWire.get(toWireName(name)))
    .filter((s): s is { function: { name: string } } => s !== undefined)
}

/** Registry names of the tools a turn asked for, in order. */
function calledNames(message: unknown): string[] {
  const calls = (message as { tool_calls?: unknown } | null)?.tool_calls
  if (!Array.isArray(calls)) return []
  const out: string[] = []
  for (const call of calls) {
    const wire = (call as { function?: { name?: unknown } }).function?.name
    if (typeof wire !== 'string') continue
    const entry = CATALOG.find((e) => e.wireName === wire || e.name === wire)
    // An unresolvable name is KEPT, prefixed. A model inventing a tool is a real
    // outcome that has to show in the report rather than being dropped as noise.
    out.push(entry ? entry.name : `?${wire}`)
  }
  return out
}

async function ask(model: (typeof MODELS)[number], prompt: string, specs: unknown[]) {
  const started = Date.now()
  const response = await fetch(`${model.endpoint}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model.id,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: prompt },
      ],
      ...(specs.length > 0 ? { tools: specs, tool_choice: 'auto' } : {}),
      stream: false,
      // Sent here and NOT by the app. Two of these three models reason before
      // answering, and a budget that cuts them off scores a thinking model as a
      // broken one. The app sends no ceiling because a truncated answer is worse
      // than a slow one when somebody is waiting; nobody is waiting here.
      max_tokens: 2048,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(240_000),
  })
  const text = await response.text()
  if (!response.ok) {
    return { error: `HTTP ${String(response.status)}: ${text.slice(0, 160)}`, ms: Date.now() - started }
  }
  const payload = JSON.parse(text) as {
    choices?: { message?: unknown }[]
    usage?: { prompt_tokens?: number }
  }
  return {
    called: calledNames(payload.choices?.[0]?.message),
    promptTokens: payload.usage?.prompt_tokens ?? null,
    ms: Date.now() - started,
  }
}

const enabled = process.env['JOJO_EVAL'] === '1'
const wanted = process.env['JOJO_EVAL_MODEL']
const models = wanted ? MODELS.filter((m) => m.id === wanted) : MODELS

describe.skipIf(!enabled)('tool calling, against real models', () => {
  // The timeout is the second argument in Vitest 4; a trailing options object
  // is removed rather than deprecated, and fails the whole suite to load.
  it('runs every scenario twice per model and writes the report', { timeout: 3_600_000 }, async () => {
      const rows: Row[] = []

      for (const model of models) {
        for (const condition of ['full', 'narrowed'] as const) {
          for (const scenario of SCENARIOS) {
            const specs = condition === 'full' ? ALL_SPECS : narrowedSpecs(scenario.prompt)
            let row: Row
            try {
              const turn = await ask(model, scenario.prompt, specs)
              const outcome =
                'error' in turn
                  ? ({
                      scenario: scenario.id,
                      called: [],
                      pass: false,
                      failure: 'error',
                      detail: turn.error,
                    } satisfies Outcome)
                  : grade(scenario, turn.called)
              row = {
                ...outcome,
                model: model.id,
                condition,
                ms: turn.ms,
                promptTokens: 'promptTokens' in turn ? turn.promptTokens : null,
                offered: specs.length,
              }
            } catch (cause) {
              row = {
                scenario: scenario.id,
                called: [],
                pass: false,
                failure: 'error',
                detail: String(cause).slice(0, 160),
                model: model.id,
                condition,
                ms: 0,
                promptTokens: null,
                offered: specs.length,
              }
            }
            rows.push(row)
            const mark = row.pass ? 'ok  ' : 'FAIL'
            const note = row.pass
              ? (row.called[0] ?? 'answered')
              : `${row.failure ?? '?'}: ${row.detail ?? ''}`
            console.log(
              `${mark} ${model.id.padEnd(13)} ${condition.padEnd(9)} ${scenario.id.padEnd(22)} ` +
                `${String(row.offered).padStart(3)} tools ${String(row.ms).padStart(6)}ms  ${note}`,
            )
          }
        }
      }

      const summary = []
      for (const model of models) {
        for (const condition of ['full', 'narrowed'] as const) {
          const mine = rows.filter((r) => r.model === model.id && r.condition === condition)
          if (mine.length === 0) continue
          const withTokens = mine.filter((r) => r.promptTokens !== null)
          summary.push({
            model: model.id,
            label: model.label,
            condition,
            passed: mine.filter((r) => r.pass).length,
            total: mine.length,
            medianMs: [...mine.map((r) => r.ms)].sort((a, b) => a - b)[Math.floor(mine.length / 2)] ?? 0,
            meanTools: Math.round(mine.reduce((n, r) => n + r.offered, 0) / mine.length),
            meanPromptTokens: Math.round(
              withTokens.reduce((n, r) => n + (r.promptTokens ?? 0), 0) / Math.max(withTokens.length, 1),
            ),
          })
        }
      }

      console.log('\n--- summary ---')
      for (const row of summary) {
        console.log(
          `${row.label.padEnd(14)} ${row.condition.padEnd(9)} ${String(row.passed)}/${String(row.total)}  ` +
            `${String(row.meanTools).padStart(3)} tools ~${String(row.meanPromptTokens).padStart(6)} tok  ${String(row.medianMs)}ms`,
        )
      }

      const out = process.env['JOJO_EVAL_OUT']
      if (out) {
        // `ranAt` is written by the runner rather than baked into the page, so
        // the report can say how old it is instead of implying it is current.
        writeFileSync(out, `${JSON.stringify({ ranAt: new Date().toISOString(), summary, rows }, null, 2)}\n`)
        console.log(`\nwrote ${out}`)
      }

    expect(rows.length).toBe(models.length * 2 * SCENARIOS.length)
  })
})
