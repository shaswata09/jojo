/**
 * What the models actually did, per conversation, from the published payload.
 *
 * `tool-bench.json` is six rows — three models by two conditions — each holding
 * a `scores` array with one entry per conversation. The table on this page
 * reads the totals; this reads the other direction, so a reader who has picked
 * ONE case can see how each model handled it — and, since the loop began
 * reporting on itself, what each run cost: rounds, tokens, how it stopped, and
 * the band across repeated passes. Those live here too (`telemetryOf` and the
 * text helpers under it) so the table only paints.
 *
 * Pure, and separate from the component, because components are never mounted
 * in this app's tests. Everything here is assertable against the real payload.
 */

import { CONVERSATIONS } from '@jojo/service/agent/bench-conversations'

import report from '@/components/guide/tool-bench.json'

export type RunTurn = {
  readonly correct: boolean
  readonly failure?: string
  readonly detail?: string
}

export type RunCheck = { readonly pass: boolean; readonly saw?: string; readonly why: string }

export type ConversationRun = {
  readonly model: string
  readonly label: string
  readonly condition: string
  readonly clean: boolean
  readonly turns: readonly RunTurn[]
  readonly state: readonly RunCheck[]
  /** Calls, writes and refusals, as the trajectory recorded them. */
  readonly calls: number
  readonly refused: number
  /** What the model said, per turn, when the run captured it. */
  readonly answers: readonly (string | null)[]
  readonly errors: readonly { tool: string; args: string; detail: string }[]
  /**
   * How close the calls came to the gold workflow, when both exist.
   *
   * `null` covers two different absences — a conversation with no authored
   * graph, and a run published before the axis existed — and the caller says
   * which rather than printing a zero for either.
   */
  readonly workflow: RunWorkflow | null
  /**
   * The rubric moved after this run was published.
   *
   * Set when the run's turn or check count disagrees with the conversation as
   * it stands now. A published payload is always older than the suite — cases
   * grow a turn, a state check is added — and the two honest responses are to
   * re-run or to say so. The dishonest one is to line the arrays up anyway:
   * a five-turn case against a four-turn run draws the fifth turn as though no
   * model reached it, which reads as a model failure and is a publishing lag.
   */
  readonly stale: boolean
  /** The loop's own account of the run — see `CaseRun`. */
  readonly run: CaseRun | null
  /**
   * Whether this case flipped between clean and not across the repeats the
   * payload was built from. `null` when the payload was a single pass: one run
   * cannot say a case is stable, only that it happened to pass.
   */
  readonly unstable: boolean | null
}

/**
 * What the runner recorded about one conversation, beyond whether it passed.
 *
 * `null` when the score carries no `run` — a payload published before the
 * loop's telemetry existed. The Runs tab prints "—" for it rather than a row
 * of zeros, because "0 compactions" on a run nobody measured reads as a
 * finding.
 */
export type CaseRun = {
  readonly stoppedBy: string
  readonly rounds: number
  readonly promptTokens: number
  readonly completionTokens: number
  readonly compactions: number
  readonly verifyNudges: number
  readonly stuckNudges: number
}

export type RunWorkflow = {
  readonly nodeF1: number
  readonly nodePrecision: number
  readonly nodeRecall: number
  readonly linkF1: number
  readonly argsChecked: number
  readonly argsMatched: number
}

type Row = {
  model: string
  label: string
  condition: string
  scores?: {
    conversation: string
    clean: boolean
    turns: RunTurn[]
    state: { pass: boolean; saw?: string; check?: { why?: string } }[]
    trajectory?: { calls?: number; refused?: number }
    workflow?: {
      nodes: { precision: number; recall: number; f1: number }
      links: { f1: number }
      args: { checked: number; matched: number }
    } | null
    errors?: { tool: string; args: string; detail: string }[]
    reasons?: { turn: number; answer: string | null }[]
    run?: {
      stoppedBy: string
      rounds: number
      verifyNudges: number
      stuckNudges: number
      compactions: number
      tokens: { prompt: number; completion: number }
    }
  }[]
  conversations?: number
  cost?: { rounds?: { mean: number }; tokens?: { prompt: number } } | null
  stops?: { maxSteps: number; stuck: number } | null
  /** Where `publish.mjs` wrote the noise before it moved to the top level. */
  noise?: RawNoise | null
}

/**
 * A mean and a sample deviation, as the scorer spells them.
 *
 * `sd` is what the payload contract names; `stddev` is what `publish.mjs`
 * wrote at the time this was built. Both are read so that whichever lands
 * first renders, and the guide is never one rename behind the runner.
 */
type RawSpread = { mean: number | null; sd?: number | null; stddev?: number | null }
type RawNoise = {
  runs?: number
  clean?: RawSpread
  nodeF1?: RawSpread
  unstable?: string[]
  flips?: { ids: string[] }
}

/**
 * The published file, typed for exactly what this module reads from it.
 *
 * `noise` is keyed model → condition and `runs` counts the passes, both at the
 * top level: noise is a property of the whole publish, not of a spliced row.
 * Every field is optional because a payload predates every field it lacks.
 */
export type Payload = {
  ranAt?: string
  setup?: { harness?: boolean; window?: number; reserve?: number }
  runs?: number
  noise?: Record<string, Record<string, RawNoise | undefined> | undefined>
  report?: Row[]
}

const PAYLOAD = report as unknown as Payload
const ROWS = PAYLOAD.report ?? []

/** When the published payload was measured, and under what setup. */
export const RAN_AT: string = PAYLOAD.ranAt ?? ''
export const SETUP = PAYLOAD.setup
/** How many passes the payload was built from; `null` when it does not say. */
export const RUNS: number | null = typeof PAYLOAD.runs === 'number' ? PAYLOAD.runs : null

/**
 * Every model's attempt at one conversation, in the payload's own order.
 *
 * Returns `[]` for a conversation the published run does not contain — a case
 * added since the last publish. That is a real state and the caller says so,
 * rather than showing an empty table that reads as "no model managed it".
 */
export function runsFor(conversationId: string): readonly ConversationRun[] {
  return runsOf(PAYLOAD, conversationId)
}

/** `runsFor`, over any payload — so the tests can hand it one they authored. */
export function runsOf(payload: Payload, conversationId: string): readonly ConversationRun[] {
  const now = CONVERSATIONS.find((c) => c.id === conversationId)
  const out: ConversationRun[] = []
  for (const row of payload.report ?? []) {
    const score = row.scores?.find((s) => s.conversation === conversationId)
    if (!score) continue
    const noise = noiseOf(payload, row)
    const stale =
      now !== undefined &&
      (score.turns.length !== now.turns.length || score.state.length !== now.finalState.length)
    out.push({
      model: row.model,
      label: row.label,
      condition: row.condition,
      clean: score.clean,
      turns: score.turns,
      state: score.state.map((c) => ({
        pass: c.pass,
        ...(c.saw === undefined ? {} : { saw: c.saw }),
        why: c.check?.why ?? '',
      })),
      calls: score.trajectory?.calls ?? 0,
      refused: score.trajectory?.refused ?? 0,
      answers: (score.reasons ?? []).map((r) => r.answer),
      errors: score.errors ?? [],
      stale,
      run:
        score.run === undefined
          ? null
          : {
              stoppedBy: score.run.stoppedBy,
              rounds: score.run.rounds,
              promptTokens: score.run.tokens.prompt,
              completionTokens: score.run.tokens.completion,
              compactions: score.run.compactions,
              verifyNudges: score.run.verifyNudges,
              stuckNudges: score.run.stuckNudges,
            },
      unstable: noise === null ? null : noise.unstable.includes(conversationId),
      workflow:
        score.workflow == null
          ? null
          : {
              nodeF1: score.workflow.nodes.f1,
              nodePrecision: score.workflow.nodes.precision,
              nodeRecall: score.workflow.nodes.recall,
              linkF1: score.workflow.links.f1,
              argsChecked: score.workflow.args.checked,
              argsMatched: score.workflow.args.matched,
            },
    })
  }
  return out
}

/** Which conversations the published run knows about at all. */
export function publishedConversations(): ReadonlySet<string> {
  const out = new Set<string>()
  for (const row of ROWS) for (const s of row.scores ?? []) out.add(s.conversation)
  return out
}

/* ------------------------- what a model row cost ------------------------- */

export type Spread = { readonly mean: number; readonly sd: number | null }

/** The band across `runs` passes, and which cases made it wide. */
export type RowNoise = {
  readonly runs: number
  readonly clean: Spread
  readonly nodeF1: Spread | null
  readonly unstable: readonly string[]
}

export type RowCost = {
  /** Model calls per conversation, on average. */
  readonly rounds: number
  /** Prompt tokens per conversation — the sum the payload carries, divided out. */
  readonly promptPerConversation: number
}

/** Conversations that ended some way other than the model answering. */
export type RowStops = { readonly maxSteps: number; readonly stuck: number }

/**
 * Each `null` is "the payload does not carry it", which the table prints as
 * "—". None of them is ever synthesised from zero: a run recorded before the
 * loop reported its stops has not measured zero stops.
 */
export type RowTelemetry = {
  readonly cost: RowCost | null
  readonly noise: RowNoise | null
  readonly stops: RowStops | null
}

const readSpread = (raw: RawSpread | undefined): Spread | null =>
  raw === undefined || raw.mean === null ? null : { mean: raw.mean, sd: raw.sd ?? raw.stddev ?? null }

/**
 * The noise for one row, from wherever the payload put it.
 *
 * Top-level `noise[model][condition]` is the contract; a row-level `noise` is
 * where the first `publish.mjs` wrote it. `null` on a single pass even when a
 * figure is present, because a deviation over one value is not a measurement
 * and a table that printed "81 ± 0" would be asserting stability from nothing.
 */
function noiseOf(payload: Payload, row: Row): RowNoise | null {
  const raw = payload.noise?.[row.model]?.[row.condition] ?? row.noise ?? undefined
  if (raw === undefined) return null
  const runs = payload.runs ?? raw.runs ?? 1
  if (runs <= 1) return null
  const clean = readSpread(raw.clean)
  if (clean === null) return null
  return {
    runs,
    clean,
    nodeF1: readSpread(raw.nodeF1),
    unstable: raw.unstable ?? raw.flips?.ids ?? [],
  }
}

/** One model row's cost, noise and stops, for any payload. */
export function telemetryOf(payload: Payload, model: string, condition: string): RowTelemetry {
  const row = (payload.report ?? []).find((r) => r.model === model && r.condition === condition)
  if (row === undefined) return { cost: null, noise: null, stops: null }
  /*
   * The denominator is the row's own `conversations`, the count `summarise`
   * defines the token sum over — not `scores.length`, which a splice or a
   * later filter can leave different. No count, no per-conversation figure.
   */
  const conversations = row.conversations ?? 0
  const cost =
    row.cost?.rounds === undefined || row.cost.tokens === undefined || conversations === 0
      ? null
      : {
          rounds: row.cost.rounds.mean,
          promptPerConversation: row.cost.tokens.prompt / conversations,
        }
  const stops = row.stops == null ? null : { maxSteps: row.stops.maxSteps, stuck: row.stops.stuck }
  return { cost, noise: noiseOf(payload, row), stops }
}

/** `telemetryOf` over the published payload. */
export function rowTelemetry(model: string, condition: string): RowTelemetry {
  return telemetryOf(PAYLOAD, model, condition)
}

/* ------------------------------ how to say it ----------------------------- */

const DASH = '—'

/** 99,884 → "100k"; 850 → "850". Prompt sizes are only meaningful to a digit or two. */
const tokens = (n: number): string => (n >= 10_000 ? `${String(Math.round(n / 1000))}k` : String(Math.round(n)))

export const costText = (cost: RowCost | null): string =>
  cost === null ? DASH : `${cost.rounds.toFixed(1)} rounds · ${tokens(cost.promptPerConversation)} tokens`

/**
 * "81 ± 1.2 · 3 unstable". A one-run payload has no band, and `noiseOf` has
 * already said so with `null`; a many-run payload whose deviation the scorer
 * withheld prints the mean and no "±", never "± 0".
 */
export const noiseText = (noise: RowNoise | null): string => {
  if (noise === null) return DASH
  const band = noise.clean.sd === null ? noise.clean.mean.toFixed(1) : `${noise.clean.mean.toFixed(1)} ± ${noise.clean.sd.toFixed(1)}`
  return `${band} · ${String(noise.unstable.length)} unstable`
}

/** Present zeros are zeros — "0 capped · 0 stuck" is a finding; "—" is its absence. */
export const stopsText = (stops: RowStops | null): string =>
  stops === null ? DASH : `${String(stops.maxSteps)} capped · ${String(stops.stuck)} stuck`

/** The loop's `stoppedBy`, in the words the guide uses for it. */
export const STOPPED: Readonly<Record<string, string>> = {
  answered: 'answered',
  maxSteps: 'hit the step cap',
  stuck: 'stopped as stuck',
  aborted: 'aborted',
  error: 'errored',
}

export const stoppedText = (stoppedBy: string): string => STOPPED[stoppedBy] ?? stoppedBy
