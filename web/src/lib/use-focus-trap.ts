import { useEffect, type RefObject } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Keeps Tab inside a container while it is active.
 *
 * A container that declares `role="dialog"` + `aria-modal="true"` is promising
 * assistive tech that the rest of the page is unreachable. Without a trap that
 * promise is false — Tab walks focus behind an opaque backdrop, where the user
 * cannot see what is focused.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return
    const node = ref.current
    if (!node) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return

      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        // offsetParent is null for display:none; guards against hidden items.
        (el) => el.offsetParent !== null || el === document.activeElement,
      )
      if (items.length === 0) return

      const first = items[0]
      const last = items[items.length - 1]
      const activeEl = document.activeElement

      // Wrap at both ends, and pull focus back in if it has already escaped.
      if (event.shiftKey && (activeEl === first || !node.contains(activeEl))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (activeEl === last || !node.contains(activeEl))) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [ref, active])
}
