import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Graph } from '@/lib/graph/model'
import type { QueryResult } from '@/lib/graph/query'
import { neighbourhood } from '@/lib/graph/traversal'
import { useReducedMotion } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'
import { NodeMark } from './canvas/NodeMark'
import { placeLabels } from './canvas/labels'
import { useNodeDrag } from './canvas/use-node-drag'
import { createSim, positionsOf, settle, step } from './force'
import type { Sim } from './force'
import { structureOf } from './structure'

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
 *
 * Three things are split out of here: `canvas/labels` decides which names fit,
 * `canvas/use-node-drag` tells a placement from a click, and `canvas/NodeMark`
 * is one node's markup. What is left is the wiring — the simulation's life
 * cycle, the paint loop, and what is lit.
 *
 * TWO RULES ABOUT REBUILDING, both learned the same way. `createSim` sets
 * `alpha` to 1, so anything that reaches it costs 192 ticks of an O(n²)
 * repulsion — 15ms at the demo store, 1.56 seconds at two thousand records (the
 * table in `force.ts`). So:
 *
 *   1. Nothing that is not a change to the SHAPE of the graph may reach it.
 *      `graph` is a fresh object on every commit anywhere in the app, and
 *      `filterGraph` mints another on every legend toggle, so depending on its
 *      identity re-simulated the whole canvas when a record on another page
 *      changed a field. The effect below is keyed on `structure` instead —
 *      the ids, the sizes and the links, which is the entire input `createSim`
 *      reads. The note under `litRef` describes this same failure for hover and
 *      selection and fixed it there; `graph` was the dependency it left behind.
 *   2. When it IS reached, the work is budgeted. See `reduced` below.
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

/**
 * The reduced-motion solve, in slices.
 *
 * `SETTLE_ITERATIONS` is the safety net `settle` has always carried — the
 * layout reports itself settled at tick 192, so this is never what stops it.
 * The two budgets are what is new: one frame for the first slice, because at
 * the demo store the whole solve fits inside it and its behaviour should not
 * change at all, then half-frame slices so the page keeps answering while a
 * large graph converges.
 */
const SETTLE_ITERATIONS = 420
const FIRST_SLICE_MS = 16
const SLICE_MS = 8

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
   * The graph the paint loop reads, in a ref for the reason rule 1 gives.
   *
   * `paint` and `layoutLabels` closed over `graph`, so their identity changed
   * whenever it did, and they are dependencies of the effect that builds the
   * simulation — which made every commit in the app a full rebuild. Read
   * through a ref they never change identity, and they always paint the current
   * graph, because a ref is read at call time rather than captured.
   *
   * Synced in a layout effect declared ABOVE the ones that read it, rather than
   * assigned during render: React may render and throw a commit away, and a ref
   * written on that pass would point at a graph that never mounted. Effects run
   * in declaration order, so by the time the simulation effect below paints,
   * this has already caught up, and the initialiser covers the first mount.
   */
  const graphRef = useRef(graph)

  const layoutLabels = useCallback(() => {
    const sim = simRef.current
    if (!sim) return
    placeLabels({
      nodes: graphRef.current.nodes,
      sim,
      labelEls: labelEls.current,
      labelWidths: labelWidths.current,
      lit: litRef.current,
      selected: selectedRef.current,
      active: activeRef.current,
      labelAll: labelAllRef.current,
    })
  }, [])

  const paint = useCallback(() => {
    const sim = simRef.current
    if (!sim) return

    for (const node of sim.nodes) {
      const el = nodeEls.current.get(node.id)
      if (el) el.setAttribute('transform', `translate(${node.x.toFixed(1)} ${node.y.toFixed(1)})`)
    }

    for (const edge of graphRef.current.edges) {
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
  }, [layoutLabels])

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

  /**
   * Everything `createSim` reads, and nothing else — rule 1 at the top. A record
   * renamed on another page changes `graph` and does not change this, so the
   * layout it is already showing stays where it is.
   */
  const structure = useMemo(() => structureOf(graph), [graph])

  /**
   * Read through a ref for the same reason as `graphRef`: the effect below must
   * not list `structure` as a dependency, because the object is new on every
   * commit even when its `key` is not — and `key` is the whole question.
   */
  const structureRef = useRef(structure)
  const structureKey = structure.key

  // Declared before every effect that reads either ref. No dependency array:
  // both are mirrors of a value this component was rendered with, so there is
  // no commit on which they should be allowed to fall behind.
  useLayoutEffect(() => {
    graphRef.current = graph
    structureRef.current = structure
  })

  // Layout effect, not effect: the nodes are rendered before the first tick has
  // run, and without this they would paint at the origin for one frame — every
  // node stacked in the top-left corner, which reads as a broken component.
  useLayoutEffect(() => {
    const { spec, index, links } = structureRef.current

    const reshuffle = nonceRef.current !== layoutNonce
    nonceRef.current = layoutNonce
    if (reshuffle) positionsRef.current = new Map()

    const sim = createSim(spec, links, width, HEIGHT, positionsRef.current)
    simRef.current = sim
    indexRef.current = index

    if (reduced) {
      /*
       * Reduced motion means the layout arrives already solved rather than
       * crawling into place — the same answer, without the movement. The answer
       * is the same as it always was; what changed is where the thread is while
       * it is being worked out.
       *
       * All 192 ticks used to run right here. That is 15ms at the demo store
       * and 1.56 seconds at two thousand records, on the main thread, inside a
       * layout effect — so a user who had asked for less motion got a frozen
       * page instead of a moving one, and got it again on every rebuild.
       *
       * One frame's worth is spent synchronously, which finishes the demo store
       * outright and leaves its behaviour exactly as it was — one paint, the
       * solved layout, no spiral flashing up first.
       *
       * A layout that needs longer is painted TWICE and not more: once here,
       * because the nodes are already in the DOM and nothing has written a
       * transform to them yet, so leaving the paint until convergence stacks
       * every node in the top-left corner for as long as that takes — which is
       * the exact failure the "layout effect, not effect" note above this one
       * was written about, at a hundred times the duration. Then once at the
       * end. Two positions is a correction; painting each slice would be an
       * animation, which is the thing the user asked not to have.
       */
      const solved = settle(sim, SETTLE_ITERATIONS, FIRST_SLICE_MS)
      paint()
      if (!solved) {
        /*
         * `alpha` decays on every tick whatever else happens, so `step` reports
         * settled by tick 192 and every slice makes at least one tick of
         * progress — the resumption terminates on the physics. `slices` is the
         * belt-and-braces on top of that, and it is here rather than absent for
         * the same reason `settle` carries an iteration cap: a loop that
         * reschedules itself has to have a way to stop that does not depend on
         * the thing it is waiting for being correct.
         */
        let slices = SETTLE_ITERATIONS
        const finish = () => {
          if (simRef.current !== sim) return
          slices -= 1
          if (settle(sim, SETTLE_ITERATIONS, SLICE_MS) || slices <= 0) {
            framesRef.current = 0
            paint()
            return
          }
          framesRef.current = requestAnimationFrame(finish)
        }
        framesRef.current = requestAnimationFrame(finish)
      }
    } else {
      paint()
      run()
    }

    return () => {
      if (framesRef.current !== 0) cancelAnimationFrame(framesRef.current)
      framesRef.current = 0
      positionsRef.current = positionsOf(sim)
    }
  }, [structureKey, layoutNonce, reduced, width, paint, run])

  const drag = useNodeDrag({
    svgRef,
    simRef,
    indexRef,
    reduced,
    paint,
    run,
    selectedId,
    onSelect,
  })

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
          {graph.nodes.map((node) => (
            <NodeMark
              key={node.id}
              node={node}
              lit={lit}
              labelEverything={labelEverything}
              selectedId={selectedId}
              onSelect={onSelect}
              setHover={setHoverId}
              setFocus={setFocusId}
              drag={drag}
              groupRef={(el) => {
                nodeEls.current.set(node.id, el)
              }}
              labelRef={(el) => {
                labelEls.current.set(node.id, el)
              }}
            />
          ))}
        </g>
      </svg>
    </div>
  )
}
