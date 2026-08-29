/**
 * What the models actually did, per conversation, from the published payload.
 *
 * `tool-bench.json` is six rows — three models by two conditions — each holding
 * a `scores` array with one entry per conversation. The table on this page
 * reads the totals; this reads the other direction, so a reader who has picked
 * ONE case can see how each model handled it.
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
  }[]
}

const ROWS = (report as { report?: Row[] }).report ?? []

/** When the published payload was measured, and under what setup. */
export const RAN_AT: string = (report as { ranAt?: string }).ranAt ?? ''
export const SETUP = (report as { setup?: { harness?: boolean; window?: number; reserve?: number } }).setup

/**
 * Every model's attempt at one conversation, in the payload's own order.
 *
 * Returns `[]` for a conversation the published run does not contain — a case
 * added since the last publish. That is a real state and the caller says so,
 * rather than showing an empty table that reads as "no model managed it".
 */
export function runsFor(conversationId: string): readonly ConversationRun[] {
  const now = CONVERSATIONS.find((c) => c.id === conversationId)
  const out: ConversationRun[] = []
  for (const row of ROWS) {
    const score = row.scores?.find((s) => s.conversation === conversationId)
    if (!score) continue
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
