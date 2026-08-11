/**
 * A key, typeset as one.
 *
 * Lifted out of the old single-page guide because all four pages need it — the
 * landing page names the three keyboard doors, the reference page names them
 * again per screen, and a fourth copy of the same span was already one too
 * many. Renders a real <kbd>: the old version was a <span>, which reads as
 * ordinary prose to a screen reader and left "press Z to undo" as the only
 * thing announced.
 */
export function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded-sm border border-hairline bg-well px-1 py-0.5 font-mono text-xs whitespace-nowrap text-text-1">
      {children}
    </kbd>
  )
}
