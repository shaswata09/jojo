import { Link } from 'react-router'
import type { ReactNode } from 'react'

/**
 * A link into the app, styled once.
 *
 * This page sends the reader somewhere in almost every paragraph — that is the
 * point of it, a guide you can act on rather than one you finish — and the
 * accent-underline class trio was written out eleven times in the first draft.
 * Eleven copies is eleven chances for one of them to lose `underline-offset-4`
 * and read as a different kind of link than the one beside it.
 */
export function Go({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="text-accent underline-offset-4 hover:underline">
      {children}
    </Link>
  )
}
