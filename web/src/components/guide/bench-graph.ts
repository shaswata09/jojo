/**
 * A benchmark conversation, as a graph you can look at.
 *
 * ## Why this is a module and not JSX
 *
 * The previewer this replaces was a list: every conversation's turns, one after
 * another, with the expectations as prose. That is readable and it is not
 * inspectable — you cannot see that a turn forbids four tools while requiring
 * one of nine, or that two turns share a required tool, or where the checks on
 * the store attach.
 *
 * The shape is a graph, so it is drawn as one. This derives it; the component
 * draws it. Components are never mounted in this app's tests (D20), so anything
 * that could be wrong has to live here, where it can be.
 *
 * ## The shape
 *
 * Turns run left to right in a column each. Every turn carries what it MAY call,
 * what it MUST NOT, and what the answer has to contain; the store checks hang
 * off the end, because they are true of the conversation rather than of a turn.
 */

import type { Conversation, StateCheck, Turn } from '@jojo/service/agent/bench-conversations'

export type BenchNodeKind =
  | 'turn'
  /** A tool the turn may call — one of these satisfies it. */
  | 'allowed'
  /** A tool the turn must not call. Failure is outright. */
  | 'forbidden'
  /** A fact the answer has to contain. */
  | 'answer'
  /** A claim about the store, after the whole conversation. */
  | 'check'

export type BenchNode = {
  readonly id: string
  readonly kind: BenchNodeKind
  readonly label: string
  /** Longer text for a tooltip or a detail line. Empty when there is none. */
  readonly detail: string
  /** Column: turn index for turn-attached nodes, last+1 for store checks. */
  readonly column: number
  /** Row within the column, from 0. */
  readonly row: number
}

export type BenchEdge = {
  readonly from: string
  readonly to: string
  /** `next` is turn-to-turn; the rest describe what a turn expects. */
  readonly kind: 'next' | 'allowed' | 'forbidden' | 'answer' | 'check'
}

export type BenchGraph = {
  readonly nodes: readonly BenchNode[]
  readonly edges: readonly BenchEdge[]
  readonly columns: number
}

/**
 * The tools a turn may call, with the read family collapsed.
 *
 * Nearly every turn appends `...READS` to its `mustCallOneOf`, so drawing each
 * one is nine near-identical boxes that say nothing — the interesting part is
 * which WRITE the turn expects. The reads are kept as one node so they are not
 * hidden, and the count goes in its label.
 */
export function allowedFor(turn: Turn): { writes: string[]; reads: string[] } {
  const all = [...(turn.mustCallOneOf ?? [])]
  const reads = all.filter((n) => n.startsWith('memory.') || n.startsWith('graph.') || n.startsWith('stats.') || n.startsWith('calc.') || n.startsWith('vault.file.read'))
  const writes = all.filter((n) => !reads.includes(n))
  return { writes, reads }
}

/** One line of what a check asserts, for a node label. */
export function describeCheck(check: StateCheck): string {
  switch (check.kind) {
    case 'count':
      return `${String(check.is)} ${check.type}`
    case 'prop':
      return `${check.type}.${check.prop} is ${check.is === null ? 'empty' : check.is}`
    case 'exists':
      return `a ${check.type} with ${check.where.prop} ~ ${check.where.contains}`
    case 'absent':
      return `no ${check.type} with ${check.where.prop} ~ ${check.where.contains}`
    case 'tagged':
      return `${check.type} tagged ${check.keyword}`
  }
}

const short = (text: string, at = 68): string => (text.length <= at ? text : `${text.slice(0, at - 1)}…`)

/**
 * The graph for one conversation.
 *
 * Deterministic: same conversation, same node ids and same order, so a caller
 * can key React children on the id and a test can assert the whole thing.
 */
export function graphOf(conversation: Conversation): BenchGraph {
  const nodes: BenchNode[] = []
  const edges: BenchEdge[] = []

  conversation.turns.forEach((turn, i) => {
    const turnId = `t${String(i)}`
    nodes.push({
      id: turnId,
      kind: 'turn',
      label: short(turn.say),
      detail: turn.why,
      column: i,
      row: 0,
    })
    if (i > 0) edges.push({ from: `t${String(i - 1)}`, to: turnId, kind: 'next' })

    let row = 1
    const { writes, reads } = allowedFor(turn)
    for (const tool of writes) {
      const id = `${turnId}-a-${tool}`
      nodes.push({ id, kind: 'allowed', label: tool, detail: 'may call', column: i, row: row++ })
      edges.push({ from: turnId, to: id, kind: 'allowed' })
    }
    if (reads.length > 0) {
      const id = `${turnId}-a-reads`
      nodes.push({
        id,
        kind: 'allowed',
        label: reads.length === 1 ? reads[0]! : `any of ${String(reads.length)} reads`,
        detail: reads.join(', '),
        column: i,
        row: row++,
      })
      edges.push({ from: turnId, to: id, kind: 'allowed' })
    }

    for (const fact of turn.answerMust ?? []) {
      const id = `${turnId}-say-${fact}`
      nodes.push({ id, kind: 'answer', label: `says “${fact}”`, detail: 'the answer must contain this', column: i, row: row++ })
      edges.push({ from: turnId, to: id, kind: 'answer' })
    }

    /*
     * Forbidden tools are SUMMARISED, not listed. `mustNotCall` is usually
     * `[...MOVES_A_STAGE, ...NEVER]` — a dozen names, all of them the same
     * point — and a dozen red boxes per turn buries the one or two that are
     * specific to this case.
     */
    const forbidden = turn.mustNotCall ?? []
    if (forbidden.length > 0) {
      const id = `${turnId}-f`
      nodes.push({
        id,
        kind: 'forbidden',
        label: forbidden.length === 1 ? `never ${forbidden[0]!}` : `never: ${String(forbidden.length)} tools`,
        detail: forbidden.join(', '),
        column: i,
        row: row++,
      })
      edges.push({ from: turnId, to: id, kind: 'forbidden' })
    }
  })

  const last = conversation.turns.length - 1
  conversation.finalState.forEach((check, i) => {
    const id = `check-${String(i)}`
    nodes.push({
      id,
      kind: 'check',
      label: describeCheck(check),
      detail: check.why,
      column: conversation.turns.length,
      row: i,
    })
    edges.push({ from: `t${String(last)}`, to: id, kind: 'check' })
  })

  return { nodes, edges, columns: conversation.turns.length + 1 }
}
