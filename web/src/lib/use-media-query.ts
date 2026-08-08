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
