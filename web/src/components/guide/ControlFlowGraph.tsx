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
import { FLOW_KIND_WORD, flowNodeText } from '@/components/guide/flow-map'
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

/*
 * What xyflow tells a screen reader about every box, replaced. Its own words
 * promise "press delete to remove it" and "use the arrow keys to move the
 * node", and neither does anything on a chart that cannot be edited. Both keys
 * are set because xyflow picks between them by `disableKeyboardA11y`, the
 * opposite way round to what their names say.
 */
const DESCRIBE_BOX = 'A box in this flowchart. The list of steps after the chart says where each way out of it leads.'
const ARIA_LABELS = {
  'node.a11yDescription.default': DESCRIBE_BOX,
  'node.a11yDescription.keyboardDisabled': DESCRIBE_BOX,
  'edge.a11yDescription.default': 'An arrow to the next box.',
}

function FlowBox({ data }: NodeProps<Node<FlowNodeData>>) {
  const short = data.path.split('/').slice(-2).join('/')
  return (
    <div
      className={cn('relative border px-3 py-1.5 shadow-sm', KIND_STYLE[data.kind])}
      style={{ width: FLOW_NODE.width, minHeight: FLOW_NODE.height }}
    >
      <Handle type="target" position={Position.Top} className={HANDLE} />
      <Handle id="loop-in" type="target" position={Position.Right} className={HANDLE} />
      {data.kind === 'step' ? null : (
        <div className="text-[9px] font-medium tracking-wide text-text-3 uppercase">{FLOW_KIND_WORD[data.kind]}</div>
      )}
      <div className="text-[12px] leading-snug text-text-1">{data.label}</div>
      <div className="mt-0.5 truncate font-mono text-[9.5px] text-text-3">{short}</div>
      {/* The whole path, under the box, while it is hovered OR focused — it
          was a `title`, which only a mouse can reach. `group` is on xyflow's
          wrapper (the element that takes focus), set per node below. */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-full left-0 z-10 mt-1 hidden max-w-[22rem] rounded border border-hairline-strong bg-panel px-1.5 py-0.5 font-mono text-[10px] break-all text-text-1 shadow-sm group-hover:block group-focus-visible:block"
      >
        {data.path}
      </div>
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

  const nodes: Node[] = placed.map((p) => {
    const data = byId.get(p.id) as FlowNodeData
    return {
      id: p.id,
      type: 'flow',
      position: { x: p.x, y: p.y },
      data,
      ariaLabel: `${flowNodeText(data)} File ${data.path}`,
      // `group` lets the box show its full path while focused; raised so that
      // path is drawn over the box below rather than under it (xyflow sets
      // each node's z-index inline, hence the !important).
      className: 'group hover:z-50! focus-visible:z-50!',
    }
  })

  const edges: Edge[] = flow.edges.map((e, i) => {
    const loop = e.back === true
    const from = byId.get(e.from)
    const to = byId.get(e.to)
    return {
      id: `${String(i)}:${e.from}->${e.to}`,
      // xyflow's default names the ids ("Edge from save to valid").
      ariaLabel: `From “${from?.label ?? e.from}”${e.label ? `, ${e.label}` : ''}, to “${to?.label ?? e.to}”`,
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
        // Its own id, so its description element is not the code graph's: xyflow
        // names both after this, and two charts on one page both defaulted to "1".
        id={`control-flow-${flow.id}`}
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        colorMode={theme}
        fitView
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        // Nothing here is picked or deleted: without these, Enter "selected" a
        // box to no effect and Backspace was wired to remove one.
        elementsSelectable={false}
        deleteKeyCode={null}
        ariaLabelConfig={ARIA_LABELS}
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
