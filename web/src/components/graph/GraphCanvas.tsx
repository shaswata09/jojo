import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { NODE_TYPE_LABEL, neighbourhood } from '@/lib/graph'
import type { Graph, QueryResult } from '@/lib/graph'
import { useReducedMotion } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'
import { NodeGlyph, nodeRadius } from './visuals'
import { createSim, positionsOf, settle, step, wake } from './force'
import type { Sim, SimLink } from './force'

/**
 * The graph, drawn.
 *
 * SVG rather than canvas so every node is a real element: focusable, hoverable,
 * nameable, and reachable by Tab. A canvas would be faster and would give a
 * keyboard user nothing at all.
 *
 * The simulation writes straight to the DOM — `transform` on each node group,
 * the four coordinates on each line — instead of going through state. React
 * still owns which elements exist and what they look like; it just does not
 * re-render ninety nodes sixty times a second to move them, and because
 * `transform` is never passed as a prop, a re-render for hover or selection
 * cannot clobber a position the simulation just wrote.
 */

/**
 * The layout's own coordinate space. The SVG scales; the physics does not.
 * Height is fixed; width is measured from the container — see `width` below.
 */
const DEFAULT_WIDTH = 960
const HEIGHT = 620
/** Quantised, so a one-pixel reflow cannot rebuild the whole layout. */
const WIDTH_STEP = 20
const MIN_ASPECT = 0.65
const MAX_ASPECT = 2.4

/** Below this, a label on every node is legible rather than noise. */
const LABEL_ALL_BELOW = 26
const LABEL_DEGREE = 4
const LABEL_MAX_CHARS = 22
/** Pointer travel that turns a click into a drag. */
const DRAG_SLOP = 3

/**
 * Label geometry, in the layout's own units.
 *
 * `LABEL_SIZE` and `LABEL_DY` have to agree with the <text> below — they are
 * used to build the box a label occupies, and a box that disagrees with what is
 * drawn either lets labels touch or hides ones that would have fitted. The
 * ascent and descent are fractions of the size rather than measured: the exact
 * metrics differ per font and per platform, and the collision test only needs a
 * box the eye agrees with.
 */
const LABEL_SIZE = 9.5
const LABEL_DY = 11
const LABEL_ASCENT = LABEL_SIZE * 0.78
const LABEL_DESCENT = LABEL_SIZE * 0.24
/** The gap `LABEL_DY` leaves under a node, reused above it so both look alike. */
const LABEL_CLEARANCE = LABEL_DY - LABEL_ASCENT
/** Breathing room, so two labels that clear each other by a hair still read. */
const LABEL_GAP_X = 3
const LABEL_GAP_Y = 1.5

type Box = { left: number; right: number; top: number; bottom: number }

const overlaps = (a: Box, b: Box) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

type Props = {
  graph: Graph
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** Highlights the answer to a query. Hovering a node overrides it. */
  result?: QueryResult | null
  /** Changing this reshuffles the layout from scratch. */
  layoutNonce?: number
  /**
   * Forces a label onto every node, past the point where they start to collide.
   *
   * Left undefined the canvas decides for itself, labelling hubs and whatever
   * the pointer is near. That keeps a busy graph readable, but it also means a
   * record you are hunting for may be one of the unlabelled dots — which is why
   * this is an escape hatch rather than a fixed rule.
   */
  showAllLabels?: boolean
  className?: string
}

const truncate = (s: string) =>
  s.length > LABEL_MAX_CHARS ? `${s.slice(0, LABEL_MAX_CHARS - 1)}…` : s

export function GraphCanvas({
  graph,
  selectedId,
  onSelect,
  result = null,
  layoutNonce = 0,
  showAllLabels = false,
  className,
}: Props) {
  const reduced = useReducedMotion()
  const svgRef = useRef<SVGSVGElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  /**
   * The layout's own width, in its own units, tracking the container's shape.
   *
   * Height is fixed and width follows the aspect ratio, so the simulation
   * spreads into the box it is actually drawn in. With a constant viewBox the
   * SVG letterboxes instead — at a narrow width the whole graph packs into a
   * band across the middle with dead space above and below it.
   */
  const [width, setWidth] = useState(DEFAULT_WIDTH)

  const simRef = useRef<Sim | null>(null)
  const indexRef = useRef<Map<string, number>>(new Map())
  const framesRef = useRef(0)
  /** Survives a rebuild, so hiding a legend row does not reshuffle the world. */
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  const nodeEls = useRef(new Map<string, SVGGElement | null>())
  const edgeEls = useRef(new Map<string, SVGLineElement | null>())
  const labelEls = useRef(new Map<string, SVGTextElement | null>())
  /** Measured once per distinct string, because measuring forces a layout. */
  const labelWidths = useRef(new Map<string, number>())
  const nonceRef = useRef(layoutNonce)

  /**
   * State the label pass reads, kept in refs rather than closed over.
   *
   * `paint` runs from a rAF loop and is a dependency of the effect that builds
   * the simulation. If it closed over the hover, focus or query state, its
   * identity would change on every pointer move, that effect would re-run, and
   * the whole layout would be rebuilt and reshuffled by moving the mouse.
   */
  const litRef = useRef<{ nodes: ReadonlySet<string>; edges: ReadonlySet<string> } | null>(null)
  const selectedRef = useRef<string | null>(selectedId)
  const activeRef = useRef<string | null>(null)
  const labelAllRef = useRef(showAllLabels)

  /**
   * Which labels actually get drawn, decided by collision rather than by rule.
   *
   * In the dense middle the labels used to overlap each other and the nodes
   * they name — 'Read' printed through 'Research', 'Assistant Professor' across
   * 'Job scout' — which is worse than an unlabelled dot, because two names on
   * top of each other are two names you cannot read instead of one you can.
   *
   * Of the three ways out, this is the one that costs nothing elsewhere.
   * Labelling only the hovered neighbourhood would leave the resting graph
   * anonymous, and the resting graph is what the page opens on. Scaling with
   * zoom needs a zoom, and this canvas deliberately has none — it is a fixed
   * viewBox with a drag. So: keep the existing rule about which labels are
   * OFFERED, and let a greedy pass decide which of them fit.
   *
   * Greedy in priority order, so what survives a crowd is what you are looking
   * at: the selection first, then the node under the pointer, then the lit
   * neighbourhood or query answer, then hubs by degree. Ties break on node
   * index, never on iteration order, so the same picture resolves the same way
   * twice — a label that flickered as the physics jittered would be worse than
   * one that is simply absent.
   *
   * `showAllLabels` skips the whole pass. Its switch is the escape hatch for
   * hunting one record, and its own doc says it labels everything "past the
   * point where they start to collide".
   */
  const layoutLabels = useCallback(() => {
    const sim = simRef.current
    if (!sim) return

    if (labelAllRef.current) {
      // The resting offset goes back on with the label. Without it a node whose
      // name the pass had moved above it keeps sitting up there after the switch
      // is thrown, and one label out of line reads as a rendering fault rather
      // than as the deliberate placement it was a moment ago.
      for (let at = 0; at < graph.nodes.length; at++) {
        const node = graph.nodes[at]
        const body = sim.nodes[at]
        const el = node && labelEls.current.get(node.id)
        if (!el || !body) continue
        el.setAttribute('y', (body.radius + LABEL_DY).toFixed(1))
        el.removeAttribute('visibility')
      }
      return
    }

    const lit = litRef.current
    const selected = selectedRef.current
    const active = activeRef.current

    const nodeBoxes: Box[] = []
    const candidates: {
      el: SVGTextElement
      /** Below the node first, then above it. Both, or neither. */
      slots: { dy: number; box: Box }[]
      rank: number
      at: number
    }[] = []

    for (let at = 0; at < graph.nodes.length; at++) {
      const node = graph.nodes[at]
      const body = sim.nodes[at]
      if (!node || !body) continue
      const r = body.radius
      nodeBoxes.push({ left: body.x - r, right: body.x + r, top: body.y - r, bottom: body.y + r })

      const el = labelEls.current.get(node.id)
      if (!el) continue

      const text = el.textContent ?? ''
      let width = labelWidths.current.get(text)
      if (width === undefined) {
        // Falls back to an estimate when the SVG has no layout yet — a measured
        // 0 would let every label through and stack them all on top of another.
        const measured = el.getComputedTextLength()
        width = measured > 0 ? measured : text.length * LABEL_SIZE * 0.55
        labelWidths.current.set(text, width)
      }

      const half = width / 2 + LABEL_GAP_X
      const slot = (dy: number) => {
        const baseline = body.y + dy
        return {
          dy,
          box: {
            left: body.x - half,
            right: body.x + half,
            top: baseline - LABEL_ASCENT - LABEL_GAP_Y,
            bottom: baseline + LABEL_DESCENT + LABEL_GAP_Y,
          },
        }
      }

      candidates.push({
        el,
        // Below is the resting position and stays first, so a graph with room
        // reads exactly as it did. Above is the fallback, and it is worth the
        // second test: in the crowded middle it is usually the difference
        // between a named hub and an anonymous dot, and 'Baylor — CS' was one
        // of five that went missing without it.
        slots: [slot(r + LABEL_DY), slot(-r - LABEL_CLEARANCE - LABEL_DESCENT)],
        rank:
          node.id === selected
            ? 400
            : node.id === active
              ? 300
              : lit === null
                ? 100 + node.degree
                : lit.nodes.has(node.id)
                  ? 200 + node.degree
                  : node.degree,
        at,
      })
    }

    candidates.sort((a, b) => b.rank - a.rank || a.at - b.at)

    const placed: Box[] = []
    for (const candidate of candidates) {
      const free = candidate.slots.find(
        ({ box }) =>
          !placed.some((taken) => overlaps(box, taken)) &&
          !nodeBoxes.some((taken) => overlaps(box, taken)),
      )
      if (!free) {
        candidate.el.setAttribute('visibility', 'hidden')
        continue
      }
      // `y` is written here as well as by React. The JSX sets the resting offset
      // on mount and never touches it again unless the radius changes, so this
      // is the only thing moving a label to the slot above its node — and the
      // effect below re-runs the pass after any render that would undo it.
      candidate.el.setAttribute('y', free.dy.toFixed(1))
      candidate.el.removeAttribute('visibility')
      placed.push(free.box)
    }
  }, [graph])

  const paint = useCallback(() => {
    const sim = simRef.current
    if (!sim) return

    for (const node of sim.nodes) {
      const el = nodeEls.current.get(node.id)
      if (el) el.setAttribute('transform', `translate(${node.x.toFixed(1)} ${node.y.toFixed(1)})`)
    }

    for (const edge of graph.edges) {
      const el = edgeEls.current.get(edge.id)
      if (!el) continue
      const a = sim.nodes[indexRef.current.get(edge.from) ?? -1]
      const b = sim.nodes[indexRef.current.get(edge.to) ?? -1]
      if (!a || !b) continue
      el.setAttribute('x1', a.x.toFixed(1))
      el.setAttribute('y1', a.y.toFixed(1))
      el.setAttribute('x2', b.x.toFixed(1))
      el.setAttribute('y2', b.y.toFixed(1))
    }

    layoutLabels()
  }, [graph, layoutLabels])

  /**
   * The loop stops the moment the layout settles and is restarted by hand after
   * a drag or a rebuild. A rAF loop left running on a still picture costs a core
   * for as long as the tab is open.
   */
  const run = useCallback(() => {
    if (framesRef.current !== 0) return
    const tick = () => {
      const sim = simRef.current
      if (!sim) return
      const moving = step(sim)
      paint()
      framesRef.current = moving ? requestAnimationFrame(tick) : 0
    }
    framesRef.current = requestAnimationFrame(tick)
  }, [paint])

  useLayoutEffect(() => {
    const el = frameRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry.contentRect
      if (w < 1 || h < 1) return
      const aspect = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, w / h))
      const next = Math.round((HEIGHT * aspect) / WIDTH_STEP) * WIDTH_STEP
      setWidth((current) => (current === next ? current : next))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Layout effect, not effect: the nodes are rendered before the first tick has
  // run, and without this they would paint at the origin for one frame — every
  // node stacked in the top-left corner, which reads as a broken component.
  useLayoutEffect(() => {
    const spec = graph.nodes.map((n) => ({
      id: n.id,
      radius: nodeRadius(n.degree),
      degree: n.degree,
    }))
    const index = new Map(spec.map((s, i) => [s.id, i]))
    const links: SimLink[] = []
    for (const edge of graph.edges) {
      const a = index.get(edge.from)
      const b = index.get(edge.to)
      if (a !== undefined && b !== undefined) links.push({ a, b })
    }

    const reshuffle = nonceRef.current !== layoutNonce
    nonceRef.current = layoutNonce
    if (reshuffle) positionsRef.current = new Map()

    const sim = createSim(spec, links, width, HEIGHT, positionsRef.current)
    simRef.current = sim
    indexRef.current = index

    if (reduced) {
      // Reduced motion means the layout arrives already solved rather than
      // crawling into place — the same answer, without the movement.
      settle(sim)
      paint()
    } else {
      paint()
      run()
    }

    return () => {
      if (framesRef.current !== 0) cancelAnimationFrame(framesRef.current)
      framesRef.current = 0
      positionsRef.current = positionsOf(sim)
    }
  }, [graph, layoutNonce, reduced, width, paint, run])

  /* ------------------------------- dragging ------------------------------- */

  const drag = useRef<{
    id: string
    pointerId: number
    dx: number
    dy: number
    moved: boolean
  } | null>(null)

  const toLocal = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM()
    if (!svg || !ctm) return { x: 0, y: 0 }
    return new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
  }, [])

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

  /* ------------------------------ highlighting ---------------------------- */

  const active = hoverId ?? focusId

  const lit = useMemo(() => {
    if (active && graph.byId.has(active)) return neighbourhood(graph, active)
    // An empty answer means "nothing to light", not "light nothing". Handing the
    // empty set straight through dimmed all ninety nodes to 25% and turned the
    // page's one picture uniformly grey, which reads as a broken component
    // rather than as an answer — and the only explanation sat in the Answer
    // panel below the fold. Two of the seven worked examples land here.
    if (result && result.nodes.size > 0) return { nodes: result.nodes, edges: result.edges }
    return null
  }, [active, graph, result])

  const labelEverything = showAllLabels || graph.nodes.length <= LABEL_ALL_BELOW

  /**
   * Re-resolves the labels when what matters changes rather than where things
   * are.
   *
   * A layout effect and not an effect: hovering mounts the neighbourhood's
   * <text> elements, and this is what decides which of them are visible. Run a
   * paint later and the whole neighbourhood flashes on unresolved first — every
   * label at once, overlapping, for one frame.
   *
   * It cannot ride on `paint` alone either. The rAF loop stops the moment the
   * layout settles, which is a second after arrival and every moment after
   * that, so on a still graph nothing would ever call the pass again.
   */
  useLayoutEffect(() => {
    litRef.current = lit
    selectedRef.current = selectedId
    activeRef.current = active
    labelAllRef.current = showAllLabels
    layoutLabels()
  }, [lit, selectedId, active, showAllLabels, layoutLabels])

  // Cleared when the graph changes under them — a node id that no longer exists
  // would otherwise keep the whole canvas dimmed against nothing.
  useEffect(() => {
    setHoverId((id) => (id && graph.byId.has(id) ? id : null))
    setFocusId((id) => (id && graph.byId.has(id) ? id : null))
  }, [graph])

  return (
    <div ref={frameRef} className={cn('h-full w-full', className)}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="group"
        aria-label={`Knowledge graph — ${graph.nodes.length} records, ${graph.edges.length} connections`}
        className="h-full w-full touch-none select-none"
        onPointerDown={(event) => {
          // A press on the background clears the selection; a press on a node is
          // stopped before it gets here by the node's own handler.
          if (event.target === event.currentTarget) onSelect(null)
        }}
      >
        <desc>
          Each record is a node and each pointer between records is a line. The panels beside this
          graph list the same information as text.
        </desc>

        <g>
          {graph.edges.map((edge) => {
            const dim = lit !== null && !lit.edges.has(edge.id)
            return (
              <line
                key={edge.id}
                ref={(el) => {
                  edgeEls.current.set(edge.id, el)
                }}
                stroke={dim ? 'var(--hairline)' : 'var(--hairline-strong)'}
                strokeWidth={dim ? 0.7 : 1.2}
                opacity={dim ? 0.35 : 0.9}
              />
            )
          })}
        </g>

        <g>
          {graph.nodes.map((node) => {
            const r = nodeRadius(node.degree)
            const selected = selectedId === node.id
            const dim = lit !== null && !lit.nodes.has(node.id)
            // Hubs are labelled always; everything else earns its label by being
            // part of what you are looking at. Labelling all ninety at rest turns
            // the canvas into overlapping type and hides the shape of the graph,
            // which is the one thing it exists to show.
            const showLabel =
              labelEverything || node.degree >= LABEL_DEGREE || selected || (lit !== null && !dim)

            return (
              <g
                key={node.id}
                ref={(el) => {
                  nodeEls.current.set(node.id, el)
                }}
                tabIndex={0}
                role="button"
                aria-pressed={selected}
                aria-label={`${node.label}. ${NODE_TYPE_LABEL[node.type]}, ${node.degree} ${
                  node.degree === 1 ? 'connection' : 'connections'
                }`}
                className="cursor-pointer"
                opacity={dim ? 0.25 : 1}
                onPointerDown={(event) => onPointerDown(event, node.id)}
                onPointerMove={onPointerMove}
                onPointerUp={(event) => endDrag(event, node.id)}
                onPointerCancel={() => {
                  drag.current = null
                }}
                onPointerEnter={() => setHoverId(node.id)}
                onPointerLeave={() => setHoverId((id) => (id === node.id ? null : id))}
                onFocus={() => setFocusId(node.id)}
                onBlur={() => setFocusId((id) => (id === node.id ? null : id))}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  onSelect(selectedId === node.id ? null : node.id)
                }}
              >
                <title>{node.detail ? `${node.label} — ${node.detail}` : node.label}</title>

                {/* Selection gets a ring; keyboard focus does not need one from
                  here. The app's global `:focus-visible` rule already draws an
                  outline around this group, and that outline is the one tuned
                  to pass 3:1 — a second indicator under it only makes a
                  focused, selected node look like a bullseye. */}
                {selected ? (
                  <circle r={r + 4.5} fill="none" stroke="var(--accent)" strokeWidth={2} />
                ) : null}

                <NodeGlyph type={node.type} r={r} stroke="var(--panel)" />

                {/* Mounted by the rule above and made visible by the collision
                    pass, which owns the `visibility` attribute from here on —
                    do not set one as a prop, or a re-render for hover would put
                    back a label the pass had just hidden. */}
                {showLabel ? (
                  <text
                    ref={(el) => {
                      labelEls.current.set(node.id, el)
                    }}
                    y={r + LABEL_DY}
                    textAnchor="middle"
                    fill="var(--text-2)"
                    style={{ fontSize: LABEL_SIZE, pointerEvents: 'none' }}
                  >
                    {truncate(node.label)}
                  </text>
                ) : null}
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}
