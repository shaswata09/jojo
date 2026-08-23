/**
 * The palette's ⌘K, on its own.
 *
 * Split out of `SpotlightSearch.tsx` for the same reason `create-actions.ts`
 * was split out of `NewMenu.tsx`: a module that exports both a component and a
 * hook cannot be hot-replaced, so editing the palette reloaded the whole app.
 *
 * It also reads better here. `Topbar` owns the open state and passes it down —
 * it imports the hook and the component from two places now, which is the
 * honest shape, because the hook is a keyboard listener and the component is a
 * dialog and neither needs the other.
 */

import { useEffect, useState } from 'react'
import { isTypingTarget } from '@/components/common/typing-target'

/** Opens on ⌘K / Ctrl-K, and ignores the shortcut while you are typing. */
export function useSpotlight() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'k' || !(e.metaKey || e.ctrlKey)) return
      // The docstring above has always claimed this guard and the check was
      // never written, so ⌘K fired over the applications search box and over
      // the note editor, where it is the browser's or the field's to handle.
      // The trade is that the palette no longer toggles shut from inside its
      // own input — Escape is what closes it.
      if (isTypingTarget(e.target)) return
      if (e.isComposing || e.defaultPrevented) return
      e.preventDefault()
      setOpen((prev) => !prev)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return { open, setOpen }
}
