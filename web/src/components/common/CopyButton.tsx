import { useEffect, useRef, useState } from 'react'
import { CopyFeedback } from '@/components/common/CopyFeedback'
import { Button } from '@/components/ui/button'

/** How long the confirmation stays up. Matches every other copy in the app. */
const COPIED_MS = 1600

/**
 * A button that copies one string, and says whether it worked.
 *
 * ## Why this exists rather than a fifth hand-rolled copy
 *
 * `CopyFeedback` already unified what the three original copy buttons LOOK
 * like. What it could not unify is the part underneath — the `writeText`, the
 * try/catch, the `failed` flag, the reset timer and the ref that clears it —
 * and so that block sits open-coded in the draft dialog, the snippet card and
 * twice in the assistant. Four transcriptions of the same fifteen lines.
 *
 * The setup commands needed two more. Writing them the same way would have made
 * six, and the sixth is where somebody eventually forgets the catch and ships a
 * green tick for a copy that silently did not happen — which is precisely the
 * failure `CopyFeedback`'s own comment describes. So the behaviour moves in
 * beside the appearance.
 *
 * The four existing sites are deliberately left alone: each is tangled with its
 * own list state (`copiedId` keyed by row, a shared timer across two lists),
 * and untangling them is a change to code that works, in a turn that is about
 * something else.
 *
 * ## The failure is shown, not swallowed
 *
 * `navigator.clipboard` is absent outside a secure context and some browsers
 * refuse it without a permission. Both arrive here as a rejected promise, and
 * both end with the button saying so — a person about to paste a command into a
 * terminal needs to know the clipboard is empty before they paste, not after.
 */
export function CopyButton({
  text,
  label,
  className,
}: {
  /** What lands on the clipboard. */
  text: string
  /** Read out to a screen reader, since the button itself is an icon and a word. */
  label: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // A timer that outlives the component sets state on something unmounted. It
  // is harmless in React 18 and still a leak, and this button lives in a panel
  // that is unmounted by a tab change two seconds after being clicked.
  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = async () => {
    clearTimeout(timer.current)
    try {
      await navigator.clipboard.writeText(text)
      setFailed(false)
    } catch {
      setFailed(true)
    }
    // Set in both branches: the button has to change either way, or a blocked
    // copy looks like a click that did nothing at all.
    setCopied(true)
    timer.current = setTimeout(() => setCopied(false), COPIED_MS)
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={label}
      onClick={() => void copy()}
      {...(className === undefined ? {} : { className })}
    >
      <CopyFeedback copied={copied} failed={failed} />
    </Button>
  )
}
