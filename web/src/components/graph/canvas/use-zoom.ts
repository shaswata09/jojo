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
const DRAG_SLOP = 4

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
      const v = viewRef.current
      if (v.k <= 1.001) return
      const { width, height } = boxRef.current
      const sx = p.x * v.k + v.x
      const sy = p.y * v.k + v.y
      if (sx >= pad && sx <= width - pad && sy >= pad && sy <= height - pad) return
      animateTo({ k: v.k, x: width / 2 - p.x * v.k, y: height / 2 - p.y * v.k })
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

  // Drag to pan, two pointers to pinch.
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{
    start: ZoomView
    at: { x: number; y: number }
    dist: number
    moved: boolean
  } | null>(null)
  const dragged = useRef(false)

  const begin = useCallback(() => {
    const pts = [...pointers.current.values()]
    const a = pts[0]
    const b = pts[1]
    if (!a) {
      gesture.current = null
      return
    }
    const at = b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a
    gesture.current = {
      start: viewRef.current,
      at,
      dist: b ? Math.hypot(a.x - b.x, a.y - b.y) : 0,
      moved: gesture.current?.moved ?? false,
    }
  }, [])

  const onPointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      pointers.current.set(event.pointerId, toLocal(event.clientX, event.clientY))
      dragged.current = false
      begin()
    },
    [toLocal, begin],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (!pointers.current.has(event.pointerId)) return
      pointers.current.set(event.pointerId, toLocal(event.clientX, event.clientY))
      const g = gesture.current
      if (!g) return
      const pts = [...pointers.current.values()]
      const a = pts[0]
      const b = pts[1]
      if (!a) return
      const at = b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a
      if (!g.moved && Math.hypot(at.x - g.at.x, at.y - g.at.y) < DRAG_SLOP && !b) return
      if (!g.moved) {
        g.moved = true
        dragged.current = true
        cancelAnimationFrame(glide.current)
        event.currentTarget.setPointerCapture?.(event.pointerId)
      }
      let next: ZoomView = {
        k: g.start.k,
        x: g.start.x + at.x - g.at.x,
        y: g.start.y + at.y - g.at.y,
      }
      if (b && g.dist > 0) {
        const factor = Math.hypot(a.x - b.x, a.y - b.y) / g.dist
        next = zoomAbout(next, factor, at.x, at.y, boxRef.current)
      }
      setView(next)
    },
    [toLocal, setView],
  )

  const onPointerEnd = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      pointers.current.delete(event.pointerId)
      begin()
    },
    [begin],
  )

  /** True once, right after a press that turned into a pan or a pinch — so it is not also a click. */
  const consumeDrag = useCallback(() => {
    const was = dragged.current
    dragged.current = false
    return was
  }, [])

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
