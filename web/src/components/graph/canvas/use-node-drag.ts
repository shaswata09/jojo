/**
 * Dragging a node, and the click that is not a drag.
 *
 * One gesture serves two purposes — move a node, or select it — so the
 * distinction has to be made from how far the pointer travelled rather than
 * from which handler fired. A press that never moves further than `DRAG_SLOP`
 * is a click and toggles the selection; anything further is a placement.
 *
 * The simulation is written to directly here, not through state: the node's
 * `x`/`y` are set on the body and the caller's `paint` puts them on screen.
 */

import { useCallback, useRef } from 'react'
import { wake } from '@/components/graph/force'
import type { Sim } from '@/components/graph/force'

/** Pointer travel that turns a click into a drag. */
const DRAG_SLOP = 3

export type NodeDragHandlers = {
  onPointerDown: (event: React.PointerEvent<SVGGElement>, id: string) => void
  onPointerMove: (event: React.PointerEvent<SVGGElement>) => void
  onPointerUp: (event: React.PointerEvent<SVGGElement>, id: string) => void
  onPointerCancel: () => void
}

export function useNodeDrag({
  svgRef,
  simRef,
  indexRef,
  reduced,
  paint,
  run,
  selectedId,
  onSelect,
}: {
  svgRef: React.RefObject<SVGSVGElement | null>
  simRef: React.RefObject<Sim | null>
  /** Node id → its index in `sim.nodes`. */
  indexRef: React.RefObject<Map<string, number>>
  reduced: boolean
  paint: () => void
  run: () => void
  selectedId: string | null
  onSelect: (id: string | null) => void
}): NodeDragHandlers {
  const drag = useRef<{
    id: string
    pointerId: number
    dx: number
    dy: number
    moved: boolean
  } | null>(null)

  const toLocal = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current
      const ctm = svg?.getScreenCTM()
      if (!svg || !ctm) return { x: 0, y: 0 }
      return new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
    },
    [svgRef],
  )

  const simNodeOf = (id: string) => {
    const at = indexRef.current.get(id)
    return at === undefined ? undefined : simRef.current?.nodes[at]
  }

  const onPointerDown = (event: React.PointerEvent<SVGGElement>, id: string) => {
    // Secondary buttons belong to the browser's context menu, not to a drag.
    if (event.button !== 0) return
    const node = simNodeOf(id)
    if (!node) return
    const point = toLocal(event.clientX, event.clientY)
    // Capture keeps a fast drag from escaping the node it started on. It throws
    // when the pointer is not actually active — a synthetic event, or a pointer
    // released between the press and this line — and losing capture is not a
    // reason to lose the drag.
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* capture is an optimisation, not the mechanism */
    }
    drag.current = {
      id,
      pointerId: event.pointerId,
      dx: node.x - point.x,
      dy: node.y - point.y,
      moved: false,
    }
    node.pinned = true
  }

  const onPointerMove = (event: React.PointerEvent<SVGGElement>) => {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    const node = simNodeOf(state.id)
    const sim = simRef.current
    if (!node || !sim) return

    const point = toLocal(event.clientX, event.clientY)
    const nextX = point.x + state.dx
    const nextY = point.y + state.dy
    if (Math.hypot(nextX - node.x, nextY - node.y) > DRAG_SLOP) state.moved = true
    node.x = nextX
    node.y = nextY
    node.vx = 0
    node.vy = 0

    // The dragged node is fixed, but everything attached to it has to give way.
    wake(sim)
    if (reduced) paint()
    else run()
  }

  const endDrag = (event: React.PointerEvent<SVGGElement>, id: string) => {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    drag.current = null
    const node = simNodeOf(id)

    if (state.moved) {
      // A node you placed stays where you put it — releasing the pin would drag
      // it back to where the physics wanted it and undo the gesture.
      return
    }

    if (node) node.pinned = false
    onSelect(selectedId === id ? null : id)
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: () => {
      drag.current = null
    },
  }
}
