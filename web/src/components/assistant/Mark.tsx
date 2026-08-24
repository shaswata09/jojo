import { useMemo } from 'react'
import { findMatches, splitOnMatches } from '@/components/assistant/thread-search'
import type { Match } from '@/components/assistant/thread-search'

/**
 * Text with the search hits marked.
 *
 * A `<mark>` rather than a styled `<span>`, because the element carries the
 * meaning: a screen reader announces marked text as marked, and a reader who
 * cannot see the highlight is exactly the reader who most needs to be told
 * which words the list matched on.
 *
 * The default `<mark>` in every browser is a yellow that belongs to no palette
 * and is illegible on the dark theme, so it is restyled to the app's accent —
 * the same colour the active conversation row uses, which is the other "this is
 * the one you are looking at" signal on this page.
 *
 * Renders plain text when there is nothing to mark, so a caller never needs to
 * branch on whether a search is running.
 */
export function Mark({
  text,
  query,
  matches,
  className,
}: {
  text: string
  /** Searched here when `matches` is not supplied — the common case. */
  query?: string
  /** Pre-computed hits, for a caller that already searched (a snippet). */
  matches?: readonly Match[]
  className?: string
}) {
  const parts = useMemo(() => {
    const found = matches ?? (query ? findMatches(text, query) : [])
    return splitOnMatches(text, found)
  }, [text, query, matches])

  if (parts.length === 0) return null
  if (parts.length === 1 && !parts[0]?.hit) return <>{text}</>

  return (
    <>
      {parts.map((part, i) =>
        part.hit ? (
          <mark
            // Index is a safe key here and only here: the array is derived
            // from this render's text and query and has no identity of its own
            // to preserve between them.
            key={i}
            className={`rounded-[3px] bg-accent-soft px-0.5 text-text-1 ${className ?? ''}`}
          >
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  )
}
