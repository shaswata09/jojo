import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

/**
 * Zoom and pan for the overview: a scale and an offset applied to the layer of
 * marks, with everything drawn on top of it (lines, names, the unfolded ring)
 * placed in screen space so text stays the size it was written at.
 *
 * Fit is `k = 1`: the whole picture in the box, which is what the layout
 * already is. It zooms in to `MAX_ZOOM`, never out past fit, and the offset is
 * clamped so the picture cannot be dragged off the box.
 *
 * Inputs: the +/− and fit buttons, the + − 0 keys, a pinch (two pointers, or a
 * trackpad's pinch, which arrives as a wheel event with ctrlKey), ctrl/⌘ +
 * wheel, and dragging to pan. A plain wheel is left to the page: the canvas is
 * one panel on a long page, and a canvas that swallowed the wheel would trap
 * anyone scrolling past it. Changes from the buttons and keys glide unless the
 * person asked for reduced motion; pinches and drags follow the hand.
 */

export type ZoomView = { readonly k: number; readonly x: number; readonly y: number }

export const MAX_ZOOM = 8
const STEP = 1.6
const GLIDE_MS = 180
/** A press that moves less than this is a click, not a pan. */
export const DRAG_SLOP = 4

const IDENTITY: ZoomView = { k: 1, x: 0, y: 0 }

export function clampView(view: ZoomView, box: { width: number; height: number }): ZoomView {
  const k = Math.max(1, Math.min(MAX_ZOOM, view.k))
  return {
    k,
    x: Math.max(box.width * (1 - k), Math.min(0, view.x)),
    y: Math.max(box.height * (1 - k), Math.min(0, view.y)),
  }
}

/** The view after zooming by `factor` about the screen point (cx, cy), which stays put. */
export function zoomAbout(
  view: ZoomView,
  factor: number,
  cx: number,
  cy: number,
  box: { width: number; height: number },
): ZoomView {
  const k = Math.max(1, Math.min(MAX_ZOOM, view.k * factor))
  const ratio = k / view.k
  return clampView({ k, x: cx - (cx - view.x) * ratio, y: cy - (cy - view.y) * ratio }, box)
}

/* ------------------------------ gesture math ------------------------------ */

/**
 * A press in progress: the view when it (or its latest change of fingers)
 * began, the point it is measured from — one finger's, or the midpoint of two —
 * the fingers' spread for a pinch, and whether it has become a pan.
 */
export type Gesture = {
  readonly start: ZoomView
  readonly at: Point
  readonly dist: number
  readonly moved: boolean
}
type Point = { readonly x: number; readonly y: number }

/** One finger's point, or two fingers' midpoint and spread. */
const centroid = (pts: readonly Point[]) => {
  const a = pts[0]
  const b = pts[1]
  if (!a) return null
  return b
    ? { at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y) }
    : { at: a, dist: 0 }
}

/**
 * (Re)starts a gesture from the pointers now down, anchored on the CURRENT
 * view. Called when a finger lands and when one lifts, so the picture does not
 * jump: the remaining finger's movement is measured from where it is now, not
 * from where the pair's midpoint was. Whether the press has already panned is
 * carried over — a pinch that lost a finger is still not a click.
 */
export function gestureStart(
  view: ZoomView,
  pts: readonly Point[],
  previous: Gesture | null,
): Gesture | null {
  const c = centroid(pts)
  if (!c) return null
  return { start: view, at: c.at, dist: c.dist, moved: previous?.moved ?? false }
}

/**
 * The view for the pointers' new positions, or `view: null` while a single
 * pointer is still inside the slop (a click in the making). Panning follows the
 * point; two pointers also scale by how their spread changed, about their
 * midpoint, clamped to fit … `MAX_ZOOM`.
 */
export function gestureMove(
  g: Gesture,
  pts: readonly Point[],
  box: { width: number; height: number },
): { view: ZoomView | null; moved: boolean } {
  const c = centroid(pts)
  if (!c) return { view: null, moved: g.moved }
  const pinching = pts.length > 1
  if (!g.moved && !pinching && Math.hypot(c.at.x - g.at.x, c.at.y - g.at.y) < DRAG_SLOP) {
    return { view: null, moved: false }
  }
  let next: ZoomView = {
    k: g.start.k,
    x: g.start.x + c.at.x - g.at.x,
    y: g.start.y + c.at.y - g.at.y,
  }
  if (pinching && g.dist > 0) next = zoomAbout(next, c.dist / g.dist, c.at.x, c.at.y, box)
  return { view: clampView(next, box), moved: true }
}

/** Whether a pointer may start a gesture: any touch or pen, a mouse's main button only. */
export const startsGesture = (pointerType: string, button: number) =>
  pointerType !== 'mouse' || button === 0

/**
 * The view that brings a point of the picture on screen with `pad` round it,
 * or null when it already is — or when the view is at fit, where everything is.
 */
export function revealView(
  view: ZoomView,
  p: Point,
  box: { width: number; height: number },
  pad = 48,
): ZoomView | null {
  if (view.k <= 1.001) return null
  const sx = p.x * view.k + view.x
  const sy = p.y * view.k + view.y
  if (sx >= pad && sx <= box.width - pad && sy >= pad && sy <= box.height - pad) return null
  return clampView(
    { k: view.k, x: box.width / 2 - p.x * view.k, y: box.height / 2 - p.y * view.k },
    box,
  )
}

/**
 * Remembers that a press became a pan or a pinch, for the click that follows
 * it: `consume` answers true once, then false, so a pan is never also a select.
 */
export function dragLatch() {
  let dragged = false
  return {
    reset: () => {
      dragged = false
    },
    mark: () => {
      dragged = true
    },
    consume: () => {
      const was = dragged
      dragged = false
      return was
    },
  }
}

export function useZoom({
  svgRef,
  box,
  reduced,
  resetKey,
}: {
  svgRef: RefObject<SVGSVGElement | null>
  box: { width: number; height: number }
  reduced: boolean
  /** A new value puts the view back to fit — a new layout is a new picture. */
  resetKey: unknown
}) {
  const [view, setViewState] = useState<ZoomView>(IDENTITY)
  const viewRef = useRef(view)
  const glide = useRef(0)
  const boxRef = useRef(box)
  boxRef.current = box

  const setView = useCallback((next: ZoomView) => {
    const clamped = clampView(next, boxRef.current)
    viewRef.current = clamped
    setViewState(clamped)
  }, [])

  const animateTo = useCallback(
    (target: ZoomView) => {
      cancelAnimationFrame(glide.current)
      const to = clampView(target, boxRef.current)
      if (reduced) {
        setView(to)
        return
      }
      const from = viewRef.current
      const started = performance.now()
      const tick = () => {
        const t = Math.min(1, (performance.now() - started) / GLIDE_MS)
        const e = 1 - (1 - t) ** 3
        setView({
          k: from.k + (to.k - from.k) * e,
          x: from.x + (to.x - from.x) * e,
          y: from.y + (to.y - from.y) * e,
        })
        if (t < 1) glide.current = requestAnimationFrame(tick)
      }
      glide.current = requestAnimationFrame(tick)
    },
    [reduced, setView],
  )

  useEffect(() => {
    void resetKey
    cancelAnimationFrame(glide.current)
    setView(IDENTITY)
  }, [resetKey, setView])

  useEffect(() => () => cancelAnimationFrame(glide.current), [])

  const zoomBy = useCallback(
    (factor: number) =>
      animateTo(
        zoomAbout(
          viewRef.current,
          factor,
          boxRef.current.width / 2,
          boxRef.current.height / 2,
          boxRef.current,
        ),
      ),
    [animateTo],
  )
  const zoomIn = useCallback(() => zoomBy(STEP), [zoomBy])
  const zoomOut = useCallback(() => zoomBy(1 / STEP), [zoomBy])
  const fit = useCallback(() => animateTo(IDENTITY), [animateTo])

  /** Pans so a point of the picture is on screen with room round it; does nothing at fit. */
  const ensureVisible = useCallback(
    (p: { x: number; y: number }, pad = 48) => {
      const next = revealView(viewRef.current, p, boxRef.current, pad)
      if (next) animateTo(next)
    },
    [animateTo],
  )

  /** Client pixels → the SVG's own units (its viewBox is the box, but CSS may scale it). */
  const toLocal = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect || rect.width === 0) return { x: 0, y: 0 }
      return {
        x: ((clientX - rect.left) / rect.width) * boxRef.current.width,
        y: ((clientY - rect.top) / rect.height) * boxRef.current.height,
      }
    },
    [svgRef],
  )

  // Wheel: ctrl/⌘ + wheel, or a trackpad pinch. Non-passive, so it can stop the page zooming.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      cancelAnimationFrame(glide.current)
      const at = toLocal(event.clientX, event.clientY)
      setView(
        zoomAbout(viewRef.current, Math.exp(-event.deltaY * 0.01), at.x, at.y, boxRef.current),
      )
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [svgRef, toLocal, setView])

  // Drag to pan, two pointers to pinch. The arithmetic is `gestureStart` /
  // `gestureMove` above; this is the wiring.
  const pointers = useRef(new Map<number, Point>())
  const gesture = useRef<Gesture | null>(null)
  const [latch] = useState(dragLatch)

  const begin = useCallback(() => {
    gesture.current = gestureStart(viewRef.current, [...pointers.current.values()], gesture.current)
  }, [])

  const onPointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (!startsGesture(event.pointerType, event.button)) return
      pointers.current.set(event.pointerId, toLocal(event.clientX, event.clientY))
      latch.reset()
      begin()
    },
    [toLocal, begin, latch],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (!pointers.current.has(event.pointerId)) return
      pointers.current.set(event.pointerId, toLocal(event.clientX, event.clientY))
      const g = gesture.current
      if (!g) return
      const step = gestureMove(g, [...pointers.current.values()], boxRef.current)
      if (!step.view) return
      if (!g.moved) {
        gesture.current = { ...g, moved: true }
        latch.mark()
        cancelAnimationFrame(glide.current)
        event.currentTarget.setPointerCapture?.(event.pointerId)
      }
      setView(step.view)
    },
    [toLocal, setView, latch],
  )

  const onPointerEnd = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      pointers.current.delete(event.pointerId)
      begin()
    },
    [begin],
  )

  /*
   * Touch: at fit the canvas lets a one-finger swipe scroll the page (the
   * overview sets `touch-action: pan-y` there), so it has to claim a pinch
   * itself — a non-passive touchmove that cancels the browser's scroll while
   * two fingers are down, or while zoomed in, where a drag is a pan.
   */
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onTouchMove = (event: TouchEvent) => {
      if (event.cancelable && (event.touches.length > 1 || viewRef.current.k > 1.001)) {
        event.preventDefault()
      }
    }
    svg.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => svg.removeEventListener('touchmove', onTouchMove)
  }, [svgRef])

  /** True once, right after a press that turned into a pan or a pinch — so it is not also a click. */
  const consumeDrag = latch.consume

  return {
    view,
    zoomIn,
    zoomOut,
    fit,
    ensureVisible,
    consumeDrag,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
    },
  }
}
