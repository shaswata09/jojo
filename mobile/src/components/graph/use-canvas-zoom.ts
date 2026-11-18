import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Gesture } from 'react-native-gesture-handler'
import {
  Easing,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import type { GProps } from 'react-native-svg'
import { FIT, ZOOM_STEP, clampView, zoomAbout } from '@/lib/graph-canvas'
import type { ZoomView } from '@/lib/graph-canvas'

const GLIDE_MS = 180

/**
 * Pinch, pan and the +/−/fit buttons for the overview.
 *
 * The marks are one SVG group whose `matrix` is driven from the UI thread, so a
 * pinch moves and scales them every frame without React — and stays crisp,
 * because react-native-svg redraws the vectors at the new matrix rather than
 * stretching a bitmap. Everything written in screen pixels on top (group names,
 * the selected record's lines and names, the unfolded ring) is rendered by
 * React from the COMMITTED view, which changes once, when a gesture ends: it
 * fades out while the picture moves and comes back where it now belongs, the
 * same size it was written at.
 *
 * A one-finger drag pans only once zoomed in; at fit the page under it scrolls
 * as it always did. While a pinch or a pan is under way `onGesture(true)` lets
 * the screen stop its own scrolling, the way the board's drag does — a pinch
 * from its second finger, a pan (zoomed only) from touch-down.
 */
export function useCanvasZoom({
  width,
  height,
  resetKey,
  onTap,
  onGesture,
}: {
  width: number
  height: number
  /** A new value puts the view back to fit — a new layout is a new picture. */
  resetKey: unknown
  /** A tap that did not pan, at a point in the canvas. */
  onTap: (x: number, y: number) => void
  onGesture: (active: boolean) => void
}) {
  const reduced = useReducedMotion()
  const k = useSharedValue(1)
  const x = useSharedValue(0)
  const y = useSharedValue(0)
  /** 1 while the picture is moving and the screen-pixel layer is out of date. */
  const moving = useSharedValue(0)
  const last = useSharedValue({ scale: 1, tx: 0, ty: 0 })
  /** Whether the pinch has stopped the page scrolling — so only it restarts it. */
  const pinchLocked = useSharedValue(false)
  const [view, setView] = useState<ZoomView>(FIT)
  const viewRef = useRef(view)
  const box = useRef({ width, height })
  box.current = { width, height }

  const commit = useCallback((next: ZoomView) => {
    viewRef.current = next
    setView(next)
  }, [])

  // The screen-pixel layer shows again once React has drawn it for the view
  // the gesture ended on — not before, or it would flash the old names.
  useEffect(() => {
    void view
    if (moving.value === 2) moving.value = 0
  }, [view, moving])

  useEffect(() => {
    void resetKey
    k.value = 1
    x.value = 0
    y.value = 0
    moving.value = 0
    commit(FIT)
  }, [resetKey, k, x, y, moving, commit])

  const animateTo = useCallback(
    (target: ZoomView) => {
      const to = clampView(target, box.current.width, box.current.height)
      commit(to)
      if (reduced) {
        k.value = to.k
        x.value = to.x
        y.value = to.y
        return
      }
      moving.value = 1
      const timing = { duration: GLIDE_MS, easing: Easing.out(Easing.cubic) }
      k.value = withTiming(to.k, timing)
      x.value = withTiming(to.x, timing)
      y.value = withTiming(to.y, timing, (finished) => {
        if (finished) moving.value = 0
      })
    },
    [reduced, commit, k, x, y, moving],
  )

  /** About `at` (a screen point that stays put) — the selected record — else the middle. */
  const zoomBy = useCallback(
    (factor: number, at?: { x: number; y: number }) => {
      const { width: w, height: h } = box.current
      animateTo(zoomAbout(viewRef.current, factor, at?.x ?? w / 2, at?.y ?? h / 2, w, h))
    },
    [animateTo],
  )
  const zoomIn = useCallback((at?: { x: number; y: number }) => zoomBy(ZOOM_STEP, at), [zoomBy])
  const zoomOut = useCallback(
    (at?: { x: number; y: number }) => zoomBy(1 / ZOOM_STEP, at),
    [zoomBy],
  )
  const fit = useCallback(() => animateTo(FIT), [animateTo])

  /** Pans so a point of the picture is on screen with room round it; does nothing at fit. */
  const ensureVisible = useCallback(
    (p: { x: number; y: number }, pad = 40) => {
      const v = viewRef.current
      if (v.k <= 1.001) return
      const { width: w, height: h } = box.current
      const sx = p.x * v.k + v.x
      const sy = p.y * v.k + v.y
      if (sx >= pad && sx <= w - pad && sy >= pad && sy <= h - pad) return
      animateTo({ k: v.k, x: w / 2 - p.x * v.k, y: h / 2 - p.y * v.k })
    },
    [animateTo],
  )

  const zoomed = view.k > 1.001

  const gesture = useMemo(() => {
    const settle = () => {
      'worklet'
      moving.value = 2
      runOnJS(commit)({ k: k.value, x: x.value, y: y.value })
    }
    // NOT `.onBegin`: RNGH begins a pinch on the first finger, before it knows
    // a second is coming, so locking there froze the page under every one-finger
    // drag or tap that started on the canvas. The lock waits for two fingers (or
    // activation), and only a pinch that took it hands it back.
    const lockForPinch = () => {
      'worklet'
      if (pinchLocked.value) return
      pinchLocked.value = true
      runOnJS(onGesture)(true)
    }
    const pinch = Gesture.Pinch()
      .onTouchesDown((e) => {
        if (e.numberOfTouches >= 2) lockForPinch()
      })
      .onStart(() => {
        lockForPinch()
        moving.value = 1
        last.value = { ...last.value, scale: 1 }
      })
      .onUpdate((e) => {
        const factor = e.scale / last.value.scale
        last.value = { ...last.value, scale: e.scale }
        const next = zoomAbout(
          { k: k.value, x: x.value, y: y.value },
          factor,
          e.focalX,
          e.focalY,
          width,
          height,
        )
        k.value = next.k
        x.value = next.x
        y.value = next.y
      })
      .onEnd(settle)
      .onFinalize(() => {
        if (!pinchLocked.value) return
        pinchLocked.value = false
        runOnJS(onGesture)(false)
      })
    // The pan exists only while zoomed in, where locking on touch-down is the
    // point: it has to beat the page's own scroll to the finger.
    const pan = Gesture.Pan()
      .enabled(zoomed)
      .minDistance(6)
      .averageTouches(true)
      .onBegin(() => {
        runOnJS(onGesture)(true)
      })
      .onStart(() => {
        moving.value = 1
        last.value = { ...last.value, tx: 0, ty: 0 }
      })
      .onUpdate((e) => {
        const dx = e.translationX - last.value.tx
        const dy = e.translationY - last.value.ty
        last.value = { ...last.value, tx: e.translationX, ty: e.translationY }
        const next = clampView({ k: k.value, x: x.value + dx, y: y.value + dy }, width, height)
        x.value = next.x
        y.value = next.y
      })
      .onEnd(settle)
      .onFinalize(() => {
        runOnJS(onGesture)(false)
      })
    const tap = Gesture.Tap()
      .maxDistance(10)
      .onEnd((e, success) => {
        if (success) runOnJS(onTap)(e.x, e.y)
      })
    return Gesture.Race(Gesture.Simultaneous(pinch, pan), tap)
  }, [zoomed, width, height, onTap, onGesture, commit, k, x, y, moving, last, pinchLocked])

  /**
   * The marks' layer. `matrix` is react-native-svg's NATIVE transform prop —
   * what its JS `transform` is turned into — which is why the type does not
   * list it: animated props skip that conversion and go straight to the view.
   */
  const matrixProps = useAnimatedProps(
    () => ({ matrix: [k.value, 0, 0, k.value, x.value, y.value] }) as unknown as GProps,
  )

  /** The screen-pixel layer, hidden while it is out of date. */
  const overlayStyle = useAnimatedStyle(() => ({
    opacity: withTiming(moving.value === 0 ? 1 : 0, { duration: moving.value === 0 ? 140 : 60 }),
  }))

  return {
    view,
    zoomed,
    zoomIn,
    zoomOut,
    fit,
    ensureVisible,
    gesture,
    matrixProps,
    overlayStyle,
  }
}
