/*
 * The multi-turn agentic benchmark, run against a real model.
 *
 * τ-bench and TaskBench score two different things and both matter here. A run
 * can call every tool the rubric asked for and still leave the store wrong —
 * so the turn axis (did it reach for a defensible tool) and the state axis (is
 * the store what it should be at the end) are scored separately, and `clean`
 * demands both.
 */
import { writeFileSync } from 'node:fs'
import { createRepository } from '../kg/repo/repository'
import { MutableSnapshot } from '../kg/core/snapshot'
import { createToolRuntime } from '../kg/tools/runtime'
import { callTool, type ToolHost } from '../kg/agent/execute'
import { runAgent, type AgentRun } from '../kg/agent/loop'
import type { ChatMessage, Turn } from '../kg/core/model-server'
import { CONVERSATIONS } from '../kg/agent/bench-conversations'
import { WORLD, BENCH_NOW, BENCH_TODAY, readDocument } from '../kg/agent/bench-world'
import { scoreConversation, summarise, type CallRecord, type BenchNode } from '../kg/agent/bench-score'

const URL = process.env['BENCH_URL']!
const MODEL = process.env['BENCH_MODEL']!
const OUT = process.env['BENCH_OUT']!
import { RESERVED_FOR_REPLY } from '../kg/agent/budget'

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
 * it.
 */
const HARNESS = process.env['BENCH_HARNESS'] !== '0'
const WINDOW = Number(process.env['BENCH_WINDOW'] ?? 0) || 32_768
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

/**
 * The `finish_reason` of the most recent completion, for the turn to record.
 *
 * A module-level box rather than a threaded return, because `runAgent` owns the
 * loop and there is no seam to carry it out through — and the question it
 * answers is per TURN, not per round: did the last thing the model said get cut
 * off. Reset at the top of each turn so a turn cannot inherit the one before.
 */
let lastFinishReason: string | null = null

async function llm(messages: readonly ChatMessage[], tools: readonly unknown[]): Promise<Turn> {
  if (process.env['BENCH_SIZE']) {
    // Rough, and rough is enough: what matters is the SHAPE of the growth.
    const chars = JSON.stringify(messages).length + JSON.stringify(tools).length
    process.stderr.write(
      `      size: ${String(messages.length)} msgs, ${String(tools.length)} tools, ~${String(Math.round(chars / 4))} tokens\n`,
    )
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${URL}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          messages,
          ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
          temperature: 0,
          /*
           * The completion cap, and it was a silent thumb on the scale.
           *
           * Hard-coded at 1400 while PRODUCTION SENDS NONE — `budget.ts` argues
           * at length why, and the servers then allow everything left after the
           * prompt. 1,400 also sits below Qwen3 14B's measured 2,358-token
           * pre-answer floor, so a reasoning model could exhaust the cap before
           * emitting its first token and score `no-required-call` for a reason
           * the benchmark had created.
           *
           * `BENCH_MAX_TOKENS=0` (the default) omits it, matching production.
           * A number pins it, for measuring exactly this.
           */
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
           * required". The invalid-JSON bucket has therefore never held a single
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

type Condition = 'full' | 'narrowed'

async function runOne(c: (typeof CONVERSATIONS)[number], condition: Condition) {
  const { host, nodes } = freshHost()
  await seed(host)
  let history: ChatMessage[] = []
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
  const perTurn: { calls: CallRecord[]; answered: boolean; finishReason: string | null; answer: string | null }[] =
    []
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
    const calls: CallRecord[] = []
    lastFinishReason = null
    let run: AgentRun
    try {
      run = await runAgent({
        host,
        llm,
        history,
        prompt: turn.say,
        onEvent: (e) => {
          if (process.env['BENCH_TRACE'] && e.type === 'note') {
            process.stderr.write(`      note: ${e.text.slice(0, 300)}\n`)
          }
          if (process.env['BENCH_TRACE'] && e.type === 'step') {
            process.stderr.write(`      [${e.step.status}] ${e.step.name} ${JSON.stringify(e.step.args ?? {}).slice(0, 130)}${e.step.detail ? ` !! ${e.step.detail.slice(0, 160)}` : ''}\n`)
          }
          if (e.type !== 'step' || e.step.status === 'running') return
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
          calls.push({
            turn: perTurn.length,
            name: e.step.name,
            effect: e.step.effect,
            ok: e.step.status === 'done',
            args: JSON.stringify(e.step.args ?? {}),
            ...(e.step.repairs && e.step.repairs.length > 0 ? { repairs: [...e.step.repairs] } : {}),
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
        maxSteps: 12,
        // `full` passes neither `tools` nor `retrieve`, which is how the loop is
        // told to offer the whole catalog. Omitted rather than set to undefined:
        // `exactOptionalPropertyTypes` treats those as different requests.
        ...(condition === 'narrowed' ? { retrieve: { carried } } : {}),
        /*
         * The harness, ON by default — because it is what the apps pass.
         *
         * It used to be opt-in, with the reasoning that the published numbers
         * should measure the model rather than the scaffolding around it. That
         * was wrong, and it made every published figure describe code nobody
         * runs: `Assistant.tsx` and `AssistantScreen.tsx` both pass `window`,
         * `chooser`, `summariser` and `onCompacted` on every turn. A benchmark
         * whose default configuration the product does not ship is measuring a
         * hypothetical.
         *
         * `BENCH_HARNESS=0` turns it off, for isolating the model from the
         * scaffolding deliberately rather than by accident.
         *
         * The window default is 32,768 because that is what BOTH local
         * providers declare as `defaultContext` — the number a person running
         * Ollama or llama.cpp actually gets. 16k is worth running too and says
         * something different: there the whole catalog does not fit and the
         * retriever is what rescues the run.
         */
        ...(HARNESS
          ? {
              chooser: { ask: (m: readonly ChatMessage[]) => llm(m, []) },
              summariser: { ask: (m: readonly ChatMessage[]) => llm(m, []) },
              window: WINDOW,
            }
          : {}),
      })
    } catch (e) {
      perTurn.push({ calls, answered: false, finishReason: lastFinishReason, answer: null })
      continue
    }
    if (process.env['BENCH_TRACE']) {
      process.stderr.write(`   > "${turn.say.slice(0, 70)}"\n   < stopped=${run.stopped} answer=${JSON.stringify((run.answer ?? '').slice(0, 120))}\n`)
    }
    history = run.messages
    carried = run.offered
    perTurn.push({
      calls,
      answered: run.answer !== null && run.answer.trim() !== '',
      finishReason: lastFinishReason,
      answer: run.answer,
    })
  }
  /*
   * `finishReason` and the answers ride alongside the score rather than into it.
   *
   * The rubric does not read them — scoring on them would be a different
   * change — but a report that cannot say WHY a turn called nothing cannot tell
   * a model declining to act from one that ran out of room before it could.
   */
  return {
    ...scoreConversation(c, perTurn, nodes()),
    errors,
    reasons: perTurn.map((t, i) => ({
      turn: i,
      finishReason: t.finishReason,
      calls: t.calls.length,
      answered: t.answered,
      answer: t.answer === null ? null : t.answer.slice(0, 240),
    })),
  }
}

const report: unknown[] = []
for (const condition of ['full', 'narrowed'] as Condition[]) {
  const scores = []
  for (const c of LIST) {
    const s = await runOne(c, condition)
    scores.push(s)
    process.stderr.write(`${condition} ${s.clean ? 'ok  ' : 'FAIL'} ${s.conversation}\n`)
  }
  report.push({ condition, ...summarise(scores), scores })
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
const observed = report.reduce<number>((n, r) => n + (r as { calls: number }).calls, 0)
if (observed === 0) {
  throw new Error(
    'the run recorded zero tool calls across every conversation — the observer is broken, not the model. Refusing to write a report.',
  )
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
       */
      setup: { harness: HARNESS, ...(HARNESS ? { window: WINDOW } : {}), reserve: RESERVED_FOR_REPLY },
      report,
    },
    null,
    2,
  ),
)
console.log('written', OUT, `— ${String(observed)} calls observed`)
