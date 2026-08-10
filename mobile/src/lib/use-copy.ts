import { useCallback, useEffect, useRef, useState } from 'react'
import * as Clipboard from 'expo-clipboard'

/** How long the copied confirmation stays up. */
const COPIED_MS = 1600

/**
 * Copy to the clipboard, and the confirmation that follows it.
 *
 * Four surfaces copy something — a snippet, a draft, an assistant reply, a
 * saved link's URL — and each had its own `copied` flag, its own timer and its
 * own 1600. The timer is the fiddly half: it has to be cleared on unmount, or a
 * `setState` lands on a screen that has gone.
 *
 * `copiedId` rather than a boolean, so a list can light up the one row that was
 * copied rather than all of them.
 */
export function useCopy() {
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = useCallback(async (text: string, id = 'default') => {
    clearTimeout(timer.current)
    await Clipboard.setStringAsync(text)
    setCopiedId(id)
    timer.current = setTimeout(() => setCopiedId(null), COPIED_MS)
  }, [])

  const isCopied = useCallback((id = 'default') => copiedId === id, [copiedId])

  return { copy, isCopied, copiedId }
}
