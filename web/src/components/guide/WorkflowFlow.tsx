import { useMemo } from 'react'
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import type { Conversation } from '@jojo/service/agent/bench-conversations'
import { useTheme } from '@/lib/theme-context'
import { shapeOf } from '@jojo/service/agent/bench-workflow'
import { layoutOf, type FlowNode } from '@/components/guide/bench-flow'

/**
 * The gold workflow, drawn with arrows.
 *
 * ## Why arrows and not columns
 *
 * The tab this replaces drew a column per turn, and the note in it said arrows
 * would add ink and no information — true of THAT graph, where every edge ran
 * turn-to-turn and could be inferred from the order. It is not true of this
 * one. A workflow's edges carry the only fact that matters about it: that
 * `application.stage.set` cannot run until `memory.search` has produced the id,
 * and that two reads with no edge between them may happen in either order. That
 * is a dependency graph, and a list cannot show it.
 *
 * ## The layout is not here
 *
 * `bench-flow.ts` computes every coordinate; this only paints. Components are
 * never mounted in this app's tests (D20), so a layout bug hiding in JSX would
 * be a bug nothing could catch.
 */

const HANDLE = 'h-1.5! w-1.5! border-0! bg-[color:var(--hairline-strong)]!'

function WorkflowNodeBox({ data }: NodeProps<Node<FlowNode['data']>>) {
  return (
    <div
      className="w-52 rounded-md border border-hairline bg-panel px-2.5 py-2 shadow-sm"
      title={data.why}
    >
      <Handle type="target" position={Position.Left} className={HANDLE} />
      <div className="font-mono text-[11px] leading-tight break-all text-text-1">{data.tool}</div>
      {data.args.length > 0 ? (
        <dl className="mt-1.5 space-y-0.5">
          {data.args.map((arg) => (
            <div key={arg.name} className="flex gap-1 text-[10px] leading-tight">
              <dt className="shrink-0 text-text-3">{arg.name}</dt>
              <dd
                className={
                  arg.value.startsWith('$')
                    ? 'truncate text-text-3 italic'
                    : 'truncate font-mono text-text-2'
                }
              >
                {arg.value.startsWith('$') ? `from ${arg.value.slice(1)}` : arg.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <Handle type="source" position={Position.Right} className={HANDLE} />
    </div>
  )
}

const NODE_TYPES = { workflow: WorkflowNodeBox }

export function WorkflowFlow({ conversation }: { conversation: Conversation }) {
  const { theme } = useTheme()
  const layout = useMemo(() => layoutOf(conversation.workflow), [conversation])

  if (layout.problem !== null) {
    return <p className="text-sm text-warning">This workflow cannot be drawn: {layout.problem}.</p>
  }

  if (layout.nodes.length === 0) {
    return (
      <p className="text-sm text-text-3">
        No tool call is required. That is the expectation, not a gap: this case is correct only when
        the agent asks rather than acts.
      </p>
    )
  }

  const nodes: Node[] = layout.nodes.map((n) => ({ ...n, data: { ...n.data } }))
  const edges: Edge[] = layout.edges.map((e) => ({ ...e, animated: false, style: { strokeWidth: 1.5 } }))
  const drawn = conversation.workflow === undefined ? 'none' : shapeOf(conversation.workflow)

  return (
    <div className="space-y-2">
      <div
        className="h-[26rem] overflow-hidden rounded-lg border border-hairline bg-well"
        // ReactFlow measures its container, so the height has to be real.
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          colorMode={theme}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable={false}
          minZoom={0.3}
          maxZoom={1.6}
        >
          <Background gap={18} size={1} />
          <Controls showInteractive={false} />
          {layout.nodes.length > 6 ? <MiniMap pannable zoomable /> : null}
        </ReactFlow>
      </div>

      <p className="text-xs text-text-3">
        {layout.nodes.length} call{layout.nodes.length === 1 ? '' : 's'} in {layout.depth} step
        {layout.depth === 1 ? '' : 's'}; an arrow means the target consumes the source's result, so
        anything unconnected may run in either order. Scored as node F1 on the tools, edge F1 on the
        arrows, and an exact match on every argument not marked <em>from</em> another call.
        {drawn === conversation.workflow?.shape ? null : (
          <span className="text-warning"> Declared {conversation.workflow?.shape}, draws {drawn}.</span>
        )}
      </p>
    </div>
  )
}
