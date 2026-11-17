import { createContext, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { ScrollView, View } from 'react-native'
import { nearestFocus } from '@/lib/focus-id'
import { space } from '@/theme/tokens'

/**
 * The screen half of `FocusTarget`: the targets a screen holds, and how it
 * scrolls to one. Apart from the component so the component file exports
 * only components (fast refresh), as the tour keeps `registry.ts` apart from
 * `TourTarget`.
 */

type Light = () => void

export type FocusScope = {
  /** Registers a target under `id`; returns the matching unregister. */
  register: (id: string, light: Light) => () => void
  /** Scrolls the screen so `node` is in view. */
  reveal: (node: View, reduced: boolean) => void
}

/** Provided by `Screen`; read by every `FocusTarget` inside it. */
export const FocusScopeContext = createContext<FocusScope | null>(null)

/** How long to wait for the target to mount, and how often to look. */
const LOOK_EVERY_MS = 120
const LOOKS = 8

/** Clear of the row above, so the lit row does not sit flush with the top. */
const LEAD = space[6]

/**
 * The screen half: holds the registered targets and, when `focus` arrives,
 * lights it — or its nearest registered ancestor if the row itself is not
 * drawn right now (see `nearestFocus`).
 *
 * `onArrived` runs as soon as the focus is taken, so the caller can clear the
 * route param: the arrival is one-shot, and a later visit to the screen is an
 * ordinary one. The focus is latched first, so clearing it does not cancel
 * the scroll it asked for.
 */
export function useFocusScope(
  focus: string | undefined,
  onArrived: (() => void) | undefined,
  scroll: RefObject<ScrollView | null>,
  inner: RefObject<View | null>,
): FocusScope {
  const targets = useRef(new Map<string, Light>())
  const [arrival, setArrival] = useState<{ id: string } | null>(null)
  const arrived = useRef(onArrived)
  arrived.current = onArrived

  useEffect(() => {
    if (!focus) return
    // A fresh object each time, so arriving twice at the same row lights it twice.
    setArrival({ id: focus })
    arrived.current?.()
  }, [focus])

  useEffect(() => {
    if (!arrival) return
    let looks = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    // Rows mount with the screen, but a screen that is still pushing in, or a
    // panel that loads a beat later, may not have laid out on the first look.
    const look = () => {
      const exact = targets.current.get(arrival.id)
      if (exact) return exact()
      if (++looks < LOOKS) {
        timer = setTimeout(look, LOOK_EVERY_MS)
        return
      }
      const near = nearestFocus(arrival.id, (id) => targets.current.has(id))
      if (near) targets.current.get(near)?.()
    }
    timer = setTimeout(look, LOOK_EVERY_MS)
    return () => clearTimeout(timer)
  }, [arrival])

  return useMemo<FocusScope>(
    () => ({
      register: (id, light) => {
        targets.current.set(id, light)
        return () => {
          if (targets.current.get(id) === light) targets.current.delete(id)
        }
      },
      reveal: (node, reduced) => {
        const content = inner.current
        if (!content) return
        // Against the scroll content's own view, not the window: the row may be
        // nested inside a column inside a panel, and only the content view's
        // origin is the y the ScrollView scrolls to.
        node.measureLayout(
          content,
          (_x, y) => scroll.current?.scrollTo({ y: Math.max(0, y - LEAD), animated: !reduced }),
          () => undefined,
        )
      },
    }),
    [scroll, inner],
  )
}
