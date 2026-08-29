/**
 * A gold workflow, laid out as a directed graph.
 *
 * ## Why the layout is here and not in the component
 *
 * ReactFlow draws nodes at coordinates you give it; it does not compute them.
 * Something has to decide that `memory.search` sits left of `application.stage.set`
 * because the second consumes the first's result, and that two independent reads
 * sit side by side rather than in a line. That decision is the interesting part
 * — it is where a wrong answer looks plausible — so it lives in a module that
 * tests can call. Components are never mounted here (D20).
 *
 * ## The layout
 *
 * Layered, left to right, by LONGEST path from a source. Longest and not
 * shortest: a node whose two parents sit in layers 0 and 3 belongs after both,
 * and shortest-path would draw its edge backwards. Within a layer, rows follow
 * the order the nodes were authored in, so the same workflow always draws the
 * same picture and a screenshot means something.
 *
 * Cycles cannot be laid out this way. A gold workflow with a cycle is a bug in
 * the rubric rather than a case to render, so `layerOf` reports it instead of
 * looping forever.
 */

import type { Workflow, WorkflowLink, WorkflowNode } from '@jojo/service/agent/bench-conversations'

/** Horizontal gap between layers, in px. Wide enough for an arrow to read. */
export const COLUMN_WIDTH = 260
/** Vertical gap between rows within a layer. */
export const ROW_HEIGHT = 104

export type FlowNode = {
  readonly id: string
  readonly position: { readonly x: number; readonly y: number }
  readonly data: {
    readonly tool: string
    readonly why: string
    /** Checkable arguments, already formatted. Empty when the node has none. */
    readonly args: readonly { readonly name: string; readonly value: string }[]
    /** True when every arg is runtime-only (`$id`), so nothing is graded. */
    readonly runtimeOnly: boolean
  }
  readonly type: 'workflow'
}

export type FlowEdge = {
  readonly id: string
  readonly source: string
  readonly target: string
}

export type FlowLayout = {
  readonly nodes: readonly FlowNode[]
  readonly edges: readonly FlowEdge[]
  /** Number of layers. 0 for an empty workflow. */
  readonly depth: number
  /** Widest layer, in nodes. Drives the drawn height. */
  readonly breadth: number
  /** Set when the graph could not be laid out — a cycle, or a dangling link. */
  readonly problem: string | null
}

/** An argument whose value is only known at run time, named for its source node. */
export const isRuntimeArg = (value: string): boolean => value.startsWith('$')

/**
 * Layer per node, by longest path from a source.
 *
 * Returns `null` on a cycle or a link naming a node that does not exist —
 * either means the workflow is malformed, and drawing half of it would hide
 * that.
 */
export function layerOf(workflow: Workflow): Map<string, number> | null {
  const ids = new Set(workflow.nodes.map((n) => n.id))
  for (const link of workflow.links) {
    if (!ids.has(link.source) || !ids.has(link.target)) return null
  }

  const incoming = new Map<string, WorkflowLink[]>()
  const outgoing = new Map<string, WorkflowLink[]>()
  for (const link of workflow.links) {
    const into = incoming.get(link.target) ?? []
    into.push(link)
    incoming.set(link.target, into)
    const from = outgoing.get(link.source) ?? []
    from.push(link)
    outgoing.set(link.source, from)
  }

  /*
   * Kahn's algorithm, carrying the layer forward. Each time an edge is removed
   * the target's layer is raised to at least one past the source's, so a node
   * settles at its LONGEST distance by the time its last parent is processed.
   */
  const remaining = new Map<string, number>(workflow.nodes.map((n) => [n.id, (incoming.get(n.id) ?? []).length]))
  const layer = new Map<string, number>(workflow.nodes.map((n) => [n.id, 0]))
  const queue = workflow.nodes.filter((n) => remaining.get(n.id) === 0).map((n) => n.id)

  let seen = 0
  while (queue.length > 0) {
    const id = queue.shift()!
    seen += 1
    for (const link of outgoing.get(id) ?? []) {
      layer.set(link.target, Math.max(layer.get(link.target)!, layer.get(id)! + 1))
      const left = remaining.get(link.target)! - 1
      remaining.set(link.target, left)
      if (left === 0) queue.push(link.target)
    }
  }

  return seen === workflow.nodes.length ? layer : null
}

const formatArgs = (node: WorkflowNode): { name: string; value: string }[] =>
  Object.entries(node.args ?? {}).map(([name, value]) => ({ name, value }))

/**
 * Positions for every node, and an edge per link.
 *
 * The order within a layer is the order the nodes were authored in, which keeps
 * the drawing stable across runs and makes a diff of the rubric legible.
 */
export function layoutOf(workflow: Workflow | undefined): FlowLayout {
  if (workflow === undefined || workflow.nodes.length === 0) {
    return { nodes: [], edges: [], depth: 0, breadth: 0, problem: null }
  }

  const layers = layerOf(workflow)
  if (layers === null) {
    return {
      nodes: [],
      edges: [],
      depth: 0,
      breadth: 0,
      problem: 'the workflow has a cycle, or a link naming a node that is not there',
    }
  }

  const rows = new Map<number, number>()
  const nodes = workflow.nodes.map((node) => {
    const column = layers.get(node.id)!
    const row = rows.get(column) ?? 0
    rows.set(column, row + 1)
    const args = formatArgs(node)
    return {
      id: node.id,
      position: { x: column * COLUMN_WIDTH, y: row * ROW_HEIGHT },
      data: {
        tool: node.tool,
        why: node.why,
        args,
        runtimeOnly: args.length > 0 && args.every((a) => isRuntimeArg(a.value)),
      },
      type: 'workflow' as const,
    }
  })

  const edges = workflow.links.map((link) => ({
    id: `${link.source}->${link.target}`,
    source: link.source,
    target: link.target,
  }))

  return {
    nodes,
    edges,
    depth: Math.max(...layers.values()) + 1,
    breadth: Math.max(...rows.values()),
    problem: null,
  }
}

/*
 * `shapeOf` is NOT here. It lived here and in the rubric guard at the same
 * time, with two definitions that disagreed on the first DAG they met, so the
 * one in `@jojo/service/agent/bench-workflow` — beside the scorer that reports
 * the axis — is the only one now. Import it from there.
 */
