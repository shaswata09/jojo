import type { CodeGraph, CodeGroup, CodeTier } from '../../../scripts/code-graph.mjs'
import type { ControlFlow } from '@/components/guide/flow-map'

/**
 * Where each box goes on the two graphs of the Control flow graph page.
 *
 * Hand-rolled rather than a layout library: both graphs have a shape known in
 * advance — the code graph is a stack of layers, a control flow is a chart
 * read top to bottom — and placing them by rank keeps that shape, where a
 * force or a general layered layout would reshuffle the layers on every edit.
 */

export type Placed = { readonly id: string; readonly x: number; readonly y: number }

/* ------------------------------ code flow graph ---------------------------- */

export const CODE_NODE = { width: 156, height: 42 } as const
const COLUMN = 170
const ROW = 54
const TIER_GAP = 24
/**
 * Boxes per row inside each band before it wraps. The service is a spine of
 * one or two per layer; the apps fan out. Measured: four, two and three keep
 * the whole graph near 0.6 zoom in a laptop window, where four everywhere put
 * it under 0.5 and the labels were unreadable until zoomed.
 */
const PER_ROW: Record<(typeof BAND_ORDER)[number], number> = { web: 4, service: 2, mobile: 3 }
const BAND_GAP = 70

const BAND_ORDER = ['web', 'service', 'mobile'] as const

/** Top to bottom; a tier with nothing in it takes no space. */
export const TIER_ORDER: readonly CodeTier[] = [
  'entry',
  'screens',
  'components',
  'app-lib',
  'react',
  'agent',
  'tools',
  'repo',
  'core',
  'storage',
]

export const TIER_LABEL: Record<CodeTier, string> = {
  entry: 'Entry points',
  screens: 'Routes and screens',
  components: 'Feature components',
  'app-lib': 'App logic and platform wiring',
  react: 'L4 · hooks',
  agent: 'L3.5 · agent',
  tools: 'L3 · tools (every write)',
  repo: 'L2 · repository',
  core: 'L1 · pure domain',
  storage: 'L0 · storage ports and adapters',
}

export type CodeLayout = {
  readonly nodes: readonly Placed[]
  /** One label per non-empty tier, at the left edge, for the lane names. */
  readonly lanes: readonly { readonly tier: CodeTier; readonly y: number }[]
  readonly width: number
}

/**
 * Web on the left, the shared service down the middle, the phone on the right;
 * each tier a band of rows, aligned across all three so a tier reads as one
 * line. Groups inside a cell are sorted by name, so the drawing is stable.
 */
export function layoutCodeGraph(graph: Pick<CodeGraph, 'groups'>): CodeLayout {
  const cell = new Map<string, CodeGroup[]>()
  for (const g of graph.groups) {
    const key = `${g.band}|${g.tier}`
    cell.set(key, [...(cell.get(key) ?? []), g])
  }
  for (const list of cell.values()) list.sort((a, b) => a.label.localeCompare(b.label))

  const rowsIn = (band: (typeof BAND_ORDER)[number], tier: CodeTier) =>
    Math.ceil((cell.get(`${band}|${tier}`)?.length ?? 0) / PER_ROW[band])

  const bandX = new Map<string, number>()
  let x = 0
  for (const band of BAND_ORDER) {
    bandX.set(band, x)
    x += PER_ROW[band] * COLUMN + BAND_GAP
  }
  const width = x - BAND_GAP

  const nodes: Placed[] = []
  const lanes: { tier: CodeTier; y: number }[] = []
  let y = 0
  for (const tier of TIER_ORDER) {
    const rows = Math.max(...BAND_ORDER.map((band) => rowsIn(band, tier)))
    if (rows === 0) continue
    lanes.push({ tier, y })
    for (const band of BAND_ORDER) {
      const list = cell.get(`${band}|${tier}`) ?? []
      const per = PER_ROW[band]
      list.forEach((g, i) => {
        const row = Math.floor(i / per)
        const inRow = Math.min(per, list.length - row * per)
        // Centred in its band, so a lone service layer sits under the middle.
        const offset = ((per - inRow) * COLUMN) / 2
        nodes.push({
          id: g.id,
          x: (bandX.get(band) ?? 0) + offset + (i % per) * COLUMN,
          y: y + row * ROW,
        })
      })
    }
    y += rows * ROW + TIER_GAP
  }
  return { nodes, lanes, width }
}

/* ---------------------------- control flow graphs --------------------------- */

export const FLOW_NODE = { width: 220, height: 64 } as const
const FLOW_COLUMN = 250
export const FLOW_ROW = 104

/**
 * How tall to draw a chart so it reads near full size: its own height at a
 * zoom a little under one, within bounds. A fixed-height box squeezed the long
 * charts (the assistant turn is seventeen steps deep) to a third of their size.
 */
export function flowBoxHeight(placed: readonly Placed[]): number {
  const deepest = Math.max(0, ...placed.map((p) => p.y))
  return Math.round(Math.min(1500, Math.max(360, (deepest + FLOW_ROW) * 0.85 + 80)))
}

/**
 * Each node one rank below the longest chain of forward edges into it, so
 * every arrow that is not a loop points down. Within a rank, nodes keep the
 * order they were written in, centred on the chart's middle.
 */
export function layoutControlFlow(flow: Pick<ControlFlow, 'nodes' | 'edges'>): Placed[] {
  const forward = flow.edges.filter((e) => e.back !== true)
  const rank = new Map(flow.nodes.map((n) => [n.id, 0]))
  // Longest path on a DAG by relaxation; a cycle in forward edges would never
  // settle, so the pass count is capped and the test asserts there is none.
  for (let pass = 0; pass < flow.nodes.length; pass += 1) {
    let changed = false
    for (const e of forward) {
      const next = (rank.get(e.from) ?? 0) + 1
      if (next > (rank.get(e.to) ?? 0)) {
        rank.set(e.to, next)
        changed = true
      }
    }
    if (!changed) break
  }

  const byRank = new Map<number, string[]>()
  for (const n of flow.nodes) {
    const r = rank.get(n.id) ?? 0
    byRank.set(r, [...(byRank.get(r) ?? []), n.id])
  }
  const widest = Math.max(...[...byRank.values()].map((ids) => ids.length))

  const x = new Map<string, number>()
  for (const ids of byRank.values()) {
    const offset = ((widest - ids.length) * FLOW_COLUMN) / 2
    ids.forEach((id, i) => x.set(id, offset + i * FLOW_COLUMN))
  }

  /*
   * A box that a skip edge would run straight through steps aside.
   *
   * The common shape is a decision whose "yes" jumps a step its "no" takes
   * (words clear → skip the chooser). Laid out in one column, the jump is drawn
   * as a straight line down THROUGH the skipped box and reads as passing into
   * it. Measured on the assistant-turn chart before this: two such jumps, both
   * invisible. Sideways by just over half a column clears the line.
   */
  for (const ids of byRank.values()) {
    if (ids.length !== 1) continue
    const id = ids[0] as string
    const into = forward.filter((e) => e.to === id)
    if (into.length !== 1) continue
    const from = (into[0] as (typeof forward)[number]).from
    const skips = forward.some(
      (e) => e.from === from && e.to !== id && (rank.get(e.to) ?? 0) > (rank.get(id) ?? 0) && x.get(e.to) === x.get(id),
    )
    if (skips && x.get(from) === x.get(id)) x.set(id, (x.get(id) ?? 0) + FLOW_COLUMN * 0.6)
  }

  return flow.nodes.map((n) => ({ id: n.id, x: x.get(n.id) ?? 0, y: (rank.get(n.id) ?? 0) * FLOW_ROW }))
}

/** Whether forward edges alone already form a loop — a chart that cannot be ranked. */
export function hasForwardCycle(flow: Pick<ControlFlow, 'nodes' | 'edges'>): boolean {
  const next = new Map<string, string[]>()
  for (const e of flow.edges) {
    if (e.back === true) continue
    next.set(e.from, [...(next.get(e.from) ?? []), e.to])
  }
  const state = new Map<string, 'open' | 'done'>()
  const visit = (id: string): boolean => {
    if (state.get(id) === 'done') return false
    if (state.get(id) === 'open') return true
    state.set(id, 'open')
    for (const to of next.get(id) ?? []) if (visit(to)) return true
    state.set(id, 'done')
    return false
  }
  return flow.nodes.some((n) => visit(n.id))
}
