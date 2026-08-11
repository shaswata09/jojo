/**
 * The sections of this page, in the order they are rendered.
 *
 * Declared once and used twice — the jump list at the top and the `id` on each
 * panel come from the same array — because the failure mode of a hand-written
 * contents list is an anchor that points at a section somebody renamed. The
 * labels here are shorter than the headings they land on for the same reason
 * the rail's pills are shorter than the pages' titles: this is a control, and a
 * control that wraps to three lines has stopped being one.
 */
const SECTIONS = [
  { id: 'application', label: 'Track an application' },
  { id: 'dates', label: 'Dates and follow-ups' },
  { id: 'vault', label: 'The Vault' },
  { id: 'profile', label: 'Your profile' },
  { id: 'keys', label: 'Keys and undo' },
  { id: 'keywords', label: 'Keywords' },
  { id: 'graph', label: 'Ask the graph' },
  { id: 'data', label: 'Your data' },
  { id: 'ladder', label: 'Not connected yet' },
] as const

export function OnThisPage() {
  return (
    <nav aria-label="On this page" className="surface rounded-lg px-4 py-3 sm:px-5">
      <p className="mb-2 text-xs text-text-3">On this page</p>
      <ul className="flex flex-wrap gap-1.5">
        {SECTIONS.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className="pressable inline-block rounded-full border border-hairline bg-well px-2.5 py-1 text-xs text-text-2 transition-colors duration-150 hover:border-hairline-strong hover:text-text-1"
            >
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
