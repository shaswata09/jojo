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
 * This module owns the `visibility` and `y` attributes of every label element
 * from mount onwards. Nothing else may set them — see the note beside the
 * <text> in `NodeMark`.
 */

import type { Sim } from '@/components/graph/force'
import type { GraphNode } from '@/lib/graph/model'

/**
 * Label geometry, in the layout's own units.
 *
 * `LABEL_SIZE` and `LABEL_DY` have to agree with the <text> in `NodeMark` —
 * they are used to build the box a label occupies, and a box that disagrees
 * with what is drawn either lets labels touch or hides ones that would have
 * fitted. The ascent and descent are fractions of the size rather than
 * measured: the exact metrics differ per font and per platform, and the
 * collision test only needs a box the eye agrees with.
 */
export const LABEL_SIZE = 9.5
export const LABEL_DY = 11
const LABEL_ASCENT = LABEL_SIZE * 0.78
const LABEL_DESCENT = LABEL_SIZE * 0.24
/** The gap `LABEL_DY` leaves under a node, reused above it so both look alike. */
const LABEL_CLEARANCE = LABEL_DY - LABEL_ASCENT
/** Breathing room, so two labels that clear each other by a hair still read. */
const LABEL_GAP_X = 3
const LABEL_GAP_Y = 1.5

const LABEL_MAX_CHARS = 22

export const truncate = (s: string) =>
  s.length > LABEL_MAX_CHARS ? `${s.slice(0, LABEL_MAX_CHARS - 1)}…` : s

type Box = { left: number; right: number; top: number; bottom: number }

const overlaps = (a: Box, b: Box) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

export type LabelPass = {
  /** Parallel to `sim.nodes`, index for index. */
  nodes: readonly GraphNode[]
  sim: Sim
  labelEls: ReadonlyMap<string, SVGTextElement | null>
  /** Measured once per distinct string, because measuring forces a layout. */
  labelWidths: Map<string, number>
  lit: { nodes: ReadonlySet<string>; edges: ReadonlySet<string> } | null
  selected: string | null
  active: string | null
  /**
   * Skips the whole pass. The `showAllLabels` switch is the escape hatch for
   * hunting one record, and its own doc says it labels everything "past the
   * point where they start to collide".
   */
  labelAll: boolean
}

/**
 * Greedy in priority order, so what survives a crowd is what you are looking
 * at: the selection first, then the node under the pointer, then the lit
 * neighbourhood or query answer, then hubs by degree. Ties break on node
 * index, never on iteration order, so the same picture resolves the same way
 * twice — a label that flickered as the physics jittered would be worse than
 * one that is simply absent.
 */
export function placeLabels({
  nodes,
  sim,
  labelEls,
  labelWidths,
  lit,
  selected,
  active,
  labelAll,
}: LabelPass) {
  if (labelAll) {
    // The resting offset goes back on with the label. Without it a node whose
    // name the pass had moved above it keeps sitting up there after the switch
    // is thrown, and one label out of line reads as a rendering fault rather
    // than as the deliberate placement it was a moment ago.
    for (let at = 0; at < nodes.length; at++) {
      const node = nodes[at]
      const body = sim.nodes[at]
      const el = node && labelEls.get(node.id)
      if (!el || !body) continue
      el.setAttribute('y', (body.radius + LABEL_DY).toFixed(1))
      el.removeAttribute('visibility')
    }
    return
  }

  const nodeBoxes: Box[] = []
  const candidates: {
    el: SVGTextElement
    /** Below the node first, then above it. Both, or neither. */
    slots: { dy: number; box: Box }[]
    rank: number
    at: number
  }[] = []

  for (let at = 0; at < nodes.length; at++) {
    const node = nodes[at]
    const body = sim.nodes[at]
    if (!node || !body) continue
    const r = body.radius
    nodeBoxes.push({ left: body.x - r, right: body.x + r, top: body.y - r, bottom: body.y + r })

    const el = labelEls.get(node.id)
    if (!el) continue

    const text = el.textContent ?? ''
    let width = labelWidths.get(text)
    if (width === undefined) {
      // Falls back to an estimate when the SVG has no layout yet — a measured
      // 0 would let every label through and stack them all on top of another.
      const measured = el.getComputedTextLength()
      width = measured > 0 ? measured : text.length * LABEL_SIZE * 0.55
      labelWidths.set(text, width)
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
    // effect in `GraphCanvas` re-runs the pass after any render that would
    // undo it.
    candidate.el.setAttribute('y', free.dy.toFixed(1))
    candidate.el.removeAttribute('visibility')
    placed.push(free.box)
  }
}
