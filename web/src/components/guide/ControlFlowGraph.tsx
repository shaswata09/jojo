import { useMemo } from 'react'
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
import type { ControlFlow, FlowNode as FlowNodeData } from '@/components/guide/flow-map'
import { FLOW_NODE, flowBoxHeight, layoutControlFlow } from '@/components/guide/flow-layout'
import { useTheme } from '@/lib/theme-context'
import { cn } from '@/lib/utils'

/**
 * One journey as a flowchart. Decisions are amber and every way out of one is
 * labelled; stops are red; loops back to an earlier step are dashed and run
 * down the right-hand side so they never cross the chart. Each box names the
 * file that makes that step or decision.
 */

const HANDLE = 'h-1.5! w-1.5! border-0! bg-[color:var(--hairline-strong)]!'

const KIND_STYLE: Record<FlowNodeData['kind'], string> = {
  start: 'rounded-full border-accent-border bg-accent-soft',
  step: 'rounded-md border-hairline-strong bg-panel',
  decision: 'rounded-md border-warning-border bg-warning-soft',
  stop: 'rounded-md border-danger-border bg-danger-soft',
  end: 'rounded-full border-success-border bg-success-soft',
}

const KIND_WORD: Record<FlowNodeData['kind'], string> = {
  start: 'Start',
  step: '',
  decision: 'Decision',
  stop: 'Stops here',
  end: 'End',
}

function FlowBox({ data }: NodeProps<Node<FlowNodeData>>) {
  return (
    <div
      className={cn('border px-3 py-1.5 shadow-sm', KIND_STYLE[data.kind])}
      style={{ width: FLOW_NODE.width, minHeight: FLOW_NODE.height }}
      title={data.path}
    >
      <Handle type="target" position={Position.Top} className={HANDLE} />
      <Handle id="loop-in" type="target" position={Position.Right} className={HANDLE} />
      {KIND_WORD[data.kind] ? (
        <div className="text-[9px] font-medium tracking-wide text-text-3 uppercase">{KIND_WORD[data.kind]}</div>
      ) : null}
      <div className="text-[12px] leading-snug text-text-1">{data.label}</div>
      <div className="mt-0.5 truncate font-mono text-[9.5px] text-text-3">{data.path.split('/').slice(-2).join('/')}</div>
      <Handle type="source" position={Position.Bottom} className={HANDLE} />
      <Handle id="loop-out" type="source" position={Position.Right} className={HANDLE} />
    </div>
  )
}

const NODE_TYPES = { flow: FlowBox }

export function ControlFlowGraph({ flow }: { flow: ControlFlow }) {
  const { theme } = useTheme()
  const placed = useMemo(() => layoutControlFlow(flow), [flow])
  const byId = new Map(flow.nodes.map((n) => [n.id, n]))

  const nodes: Node[] = placed.map((p) => ({
    id: p.id,
    type: 'flow',
    position: { x: p.x, y: p.y },
    data: byId.get(p.id) as FlowNodeData,
  }))

  const edges: Edge[] = flow.edges.map((e, i) => {
    const loop = e.back === true
    const from = byId.get(e.from)
    return {
      id: `${String(i)}:${e.from}->${e.to}`,
      source: e.from,
      target: e.to,
      ...(loop ? { sourceHandle: 'loop-out', targetHandle: 'loop-in', type: 'smoothstep' } : {}),
      ...(e.label ? { label: e.label, labelStyle: { fontSize: 10 }, labelBgPadding: [4, 2] as [number, number] } : {}),
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
      style: {
        stroke: from?.kind === 'decision' ? 'var(--warning)' : 'var(--hairline-strong)',
        strokeWidth: 1.4,
        ...(loop ? { strokeDasharray: '5 4' } : {}),
      },
    }
  })

  return (
    <div
      className="overflow-hidden rounded-lg border border-hairline bg-well"
      style={{ height: flowBoxHeight(placed) }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        colorMode={theme}
        fitView
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        minZoom={0.2}
        maxZoom={1.8}
        // The wheel scrolls the page: the chart is drawn tall enough to read,
        // so the page, not the canvas, is what a reader is scrolling through.
        zoomOnScroll={false}
        preventScrolling={false}
        fitViewOptions={{ padding: 0.06, maxZoom: 0.95 }}
      >
        <Background gap={18} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
