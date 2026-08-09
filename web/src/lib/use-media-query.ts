import { useCallback, useSyncExternalStore } from 'react'

/**
 * Subscribes to a CSS media query.
 *
 * Layout is driven by Tailwind classes wherever possible; this exists only for
 * the cases where behaviour differs too, such as the sidebar being a modal
 * dialog on small screens and a plain landmark on large ones.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query)
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    },
    [query],
  )

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false, // server snapshot; never rendered on a server today
  )
}

/** Matches Tailwind's `lg` breakpoint — the point the sidebar becomes permanent. */
export const DESKTOP_QUERY = '(min-width: 64rem)'

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/**
 * Whether the reader has asked for less movement.
 *
 * `index.css` already flattens every CSS animation and transition under this
 * preference, so most components need nothing. This hook exists for the motion
 * that stylesheet cannot reach: dnd-kit's drop animation and the dialog's
 * cross-fade are Web Animations API keyframes applied to a cloned node from
 * script, and no `*` rule touches them. Anything driven by `element.animate()`
 * or handed to a library as a duration has to ask here instead.
 *
 * Read through `useMediaQuery`, so the first paint already has the right
 * answer rather than flashing the full animation and correcting in an effect.
 */
export function useReducedMotion(): boolean {
  return useMediaQuery(REDUCED_MOTION_QUERY)
}
