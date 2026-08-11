import { Ban, Check, Copy } from 'lucide-react'

/**
 * The icon and word a copy button shows, for all three of them.
 *
 * There are three copy buttons in the app — a Vault snippet, the draft dialog,
 * an assistant message — and all three had written the same conditional by
 * hand:
 *
 *     {isCopied ? <Check/> : <Copy/>}
 *     {isCopied ? (failed ? 'Blocked' : 'Copied') : 'Copy'}
 *
 * Read it in the failure case. Clipboard access denied, or `navigator.clipboard`
 * absent because the page is not in a secure context, and the button renders a
 * green tick next to the word "Blocked". The text was honest and the icon
 * contradicted it, which is worse than either alone: a tick is the thing people
 * actually scan for, and it says the copy worked. Someone pasting into an email
 * finds out it did not.
 *
 * So the three states get three appearances, in one place where they cannot
 * drift apart again — and the failure is `Ban` in the danger colour, because
 * the failure of a copy is not a neutral event when the user is about to paste.
 */
export function CopyFeedback({ copied, failed }: { copied: boolean; failed?: boolean }) {
  if (copied && failed) {
    return (
      <>
        <Ban className="size-3.5 text-danger" strokeWidth={2} aria-hidden />
        <span className="text-danger">Blocked</span>
      </>
    )
  }

  return (
    <>
      {copied ? (
        <Check className="size-3.5" strokeWidth={2} aria-hidden />
      ) : (
        <Copy className="size-3.5" strokeWidth={1.8} aria-hidden />
      )}
      {copied ? 'Copied' : 'Copy'}
    </>
  )
}
