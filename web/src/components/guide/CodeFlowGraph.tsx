import { useMemo, useState } from 'react'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import builtGraph from 'virtual:jojo-code-graph'
import type { CodeGraph, CodeGroup } from '../../../scripts/code-graph.mjs'
import { Chip } from '@/components/common/Chip'
import { CHANNELS } from '@/components/guide/flow-map'
import { CODE_NODE, TIER_LABEL, layoutCodeGraph } from '@/components/guide/flow-layout'
import { fileLinks, filesOf, neighboursOf, strokeFor } from '@/components/guide/code-graph-view'
import { useTheme } from '@/lib/theme-context'
import { cn } from '@/lib/utils'

/**
 * Every module of the three apps and the shared service, with the imports
 * between them, drawn from the code as it was when this page was built.
 *
 * Nothing is selected at first, and every arrow is faint: three hundred arrows
 * at full strength are a hairball. Pick a module and its own arrows light up,
 * and the panel below lists its files and what they import.
 */

/** Computed by `scripts/code-graph.mjs` when the app was built. */
const graph = builtGraph as CodeGraph

const HANDLE = 'h-1! w-1! border-0! bg-[color:var(--hairline-strong)]!'

const BAND_BORDER: Record<CodeGroup['band'], string> = {
  web: 'border-info-border',
  service: 'border-accent-border',
  mobile: 'border-success-border',
}

type GroupData = { group: CodeGroup; lit: boolean; dim: boolean }

function GroupBox({ data }: NodeProps<Node<GroupData>>) {
  const { group, lit, dim } = data
  return (
    <div
      className={cn(
        'rounded-md border bg-panel px-2.5 py-1.5 shadow-sm transition-opacity',
        BAND_BORDER[group.band],
        lit && 'ring-2 ring-accent',
        dim && 'opacity-35',
      )}
      style={{ width: CODE_NODE.width, height: CODE_NODE.height }}
      title={`${group.id} — ${String(group.files)} files, ${group.lines.toLocaleString()} lines`}
    >
      <Handle type="target" position={Position.Top} className={HANDLE} />
      <div className="truncate text-[12.5px] leading-tight font-medium text-text-1">{group.label}</div>
      <div className="text-[10.5px] text-text-3 tabular-nums">
        {group.files} files · {group.lines.toLocaleString()} lines
      </div>
      <Handle type="source" position={Position.Bottom} className={HANDLE} />
    </div>
  )
}

function LaneLabel({ data }: NodeProps<Node<{ text: string }>>) {
  return <div className="w-44 text-right text-[11px] font-medium text-text-3">{data.text}</div>
}

const NODE_TYPES = { group: GroupBox, lane: LaneLabel }

const BANDS = [
  { id: 'web', label: 'Web app' },
  { id: 'service', label: 'Shared service' },
  { id: 'mobile', label: 'Phone app' },
] as const

export function CodeFlowGraph() {
  const { theme } = useTheme()
  const [selected, setSelected] = useState<string | null>(null)
  const [file, setFile] = useState<string | null>(null)
  const [bands, setBands] = useState<ReadonlySet<string>>(() => new Set(['web', 'service', 'mobile']))

  const layout = useMemo(() => layoutCodeGraph(graph), [])
  const groupById = useMemo(() => new Map(graph.groups.map((g) => [g.id, g])), [])
  const visible = (id: string) => bands.has(groupById.get(id)?.band ?? '')

  const touching = useMemo(() => {
    if (selected === null) return null
    const ids = new Set([selected])
    for (const e of graph.edges) {
      if (e.from === selected) ids.add(e.to)
      if (e.to === selected) ids.add(e.from)
    }
    return ids
  }, [selected])

  const nodes: Node[] = [
    ...layout.lanes.map((lane) => ({
      id: `lane:${lane.tier}`,
      type: 'lane',
      position: { x: -200, y: lane.y + 14 },
      data: { text: TIER_LABEL[lane.tier] },
      selectable: false,
      draggable: false,
    })),
    ...layout.nodes
      .filter((n) => visible(n.id))
      .map((n) => {
        const group = groupById.get(n.id) as CodeGroup
        return {
          id: n.id,
          type: 'group',
          position: { x: n.x, y: n.y },
          data: { group, lit: n.id === selected, dim: touching !== null && !touching.has(n.id) },
        }
      }),
  ]

  const edges: Edge[] = [
    ...graph.edges
      .filter((e) => visible(e.from) && visible(e.to))
      .map((e) => {
        const on = selected !== null && (e.from === selected || e.to === selected)
        return {
          id: `${e.from}->${e.to}`,
          source: e.from,
          target: e.to,
          markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
          style: {
            stroke: on ? 'var(--accent)' : 'var(--hairline-strong)',
            strokeWidth: on ? strokeFor(e.count) : 1,
            opacity: selected === null ? 0.28 : on ? 1 : 0.05,
          },
          ...(on ? { label: String(e.count), labelStyle: { fontSize: 10 } } : {}),
        }
      }),
    ...CHANNELS.filter((c) => visible(c.from) && visible(c.to)).map((c) => ({
      id: `channel:${c.from}->${c.to}`,
      source: c.from,
      target: c.to,
      label: c.label,
      labelStyle: { fontSize: 10 },
      style: { stroke: 'var(--accent)', strokeDasharray: '5 4', opacity: selected === null ? 0.7 : 0.25 },
    })),
  ]

  const chosen = selected === null ? null : groupById.get(selected)
  const near = selected === null ? null : neighboursOf(graph, selected)
  const files = selected === null ? [] : filesOf(graph, selected)
  const links = file === null ? null : fileLinks(graph, file)

  const pick = (id: string | null) => {
    setSelected(id)
    setFile(null)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Show these parts">
        {BANDS.map((band) => {
          const on = bands.has(band.id)
          return (
            <button
              key={band.id}
              type="button"
              aria-pressed={on}
              onClick={() =>
                setBands((now) => {
                  const next = new Set(now)
                  if (on) next.delete(band.id)
                  else next.add(band.id)
                  return next.size === 0 ? now : next
                })
              }
              className={cn(
                'pressable rounded-full border px-2.5 py-1 text-xs transition-colors',
                on ? 'border-accent-border bg-accent-soft text-text-1' : 'border-hairline bg-well text-text-3',
              )}
            >
              {band.label}
            </button>
          )
        })}
        <span className="text-xs text-text-3 tabular-nums">
          {graph.groups.length} modules · {graph.files.length} files · {graph.edges.length} import paths
        </span>
      </div>

      <div className="h-[52rem] max-h-[85vh] overflow-hidden rounded-lg border border-hairline bg-well">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          colorMode={theme}
          fitView
          fitViewOptions={{ padding: 0.06 }}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable={false}
          minZoom={0.15}
          maxZoom={1.8}
          // The wheel scrolls the page; zoom with the buttons, a pinch or a
          // double-click, so a reader scrolling past is never trapped in here.
          zoomOnScroll={false}
          preventScrolling={false}
          onNodeClick={(_, node) => {
            if (node.type === 'group') pick(node.id === selected ? null : node.id)
          }}
          onPaneClick={() => pick(null)}
        >
          <Background gap={18} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      {chosen && near ? (
        <section aria-label={`About ${chosen.label}`} className="rounded-lg border border-hairline bg-well/40 p-3.5">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-sm font-medium text-text-1">{chosen.label}</h3>
            <code className="font-mono text-xs text-text-2">{chosen.id}</code>
            <Chip size="sm">{TIER_LABEL[chosen.tier]}</Chip>
            <button type="button" className="ml-auto text-xs text-text-3 underline underline-offset-2" onClick={() => pick(null)}>
              Clear
            </button>
          </div>
          <div className="mt-3 grid gap-4 md:grid-cols-3">
            <LinkList title="Uses" links={near.uses} onPick={pick} />
            <LinkList title="Used by" links={near.usedBy} onPick={pick} />
            <div className="min-w-0">
              <h4 className="mb-1.5 text-xs font-medium text-text-2">Files ({files.length})</h4>
              <ul className="max-h-64 space-y-0.5 overflow-y-auto pr-1">
                {files.map((f) => (
                  <li key={f.path}>
                    <button
                      type="button"
                      aria-pressed={file === f.path}
                      onClick={() => setFile(file === f.path ? null : f.path)}
                      className={cn(
                        'flex w-full items-baseline justify-between gap-2 rounded px-1 text-left font-mono text-[11px] hover:bg-row-hover',
                        file === f.path ? 'text-text-1' : 'text-text-2',
                      )}
                    >
                      <span className="truncate">{f.path.split('/').slice(-1)[0]}</span>
                      <span className="shrink-0 text-text-3 tabular-nums">{f.lines}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          {file && links ? (
            <div className="mt-3 grid gap-4 border-t border-hairline pt-3 md:grid-cols-2">
              <PathList title={`${file.split('/').slice(-1)[0]} imports`} paths={links.imports} />
              <PathList title="Imported by" paths={links.importedBy} />
            </div>
          ) : null}
        </section>
      ) : (
        <p className="text-xs text-text-3">
          Pick a module to light up its imports and list its files. Arrows point from the code that imports to the code it uses;
          dashed lines are connections that are not imports.
        </p>
      )}
    </div>
  )
}

function LinkList({
  title,
  links,
  onPick,
}: {
  title: string
  links: readonly { id: string; count: number }[]
  onPick: (id: string) => void
}) {
  return (
    <div className="min-w-0">
      <h4 className="mb-1.5 text-xs font-medium text-text-2">
        {title} ({links.length})
      </h4>
      {links.length === 0 ? (
        <p className="text-xs text-text-3">Nothing.</p>
      ) : (
        <ul className="max-h-64 space-y-0.5 overflow-y-auto pr-1">
          {links.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                onClick={() => onPick(l.id)}
                className="flex w-full items-baseline justify-between gap-2 rounded px-1 text-left text-xs text-text-2 hover:bg-row-hover hover:text-text-1"
              >
                <span className="truncate font-mono text-[11px]">{l.id}</span>
                <span className="shrink-0 text-text-3 tabular-nums" title={`${String(l.count)} imports`}>
                  {l.count}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PathList({ title, paths }: { title: string; paths: readonly string[] }) {
  return (
    <div className="min-w-0">
      <h4 className="mb-1.5 text-xs font-medium text-text-2">
        {title} ({paths.length})
      </h4>
      {paths.length === 0 ? (
        <p className="text-xs text-text-3">Nothing.</p>
      ) : (
        <ul className="max-h-48 space-y-0.5 overflow-y-auto pr-1">
          {paths.map((p) => (
            <li key={p} className="truncate font-mono text-[11px] text-text-2" title={p}>
              {p}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
