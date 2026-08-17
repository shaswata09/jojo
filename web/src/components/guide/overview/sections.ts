/**
 * The sections of the overview page, in the order they are rendered.
 *
 * The labels are shorter than the headings they land on, for the same reason
 * the rail's pills are shorter than the pages' titles: this is a control, and a
 * control that wraps to three lines has stopped being one.
 *
 * A hand-written contents list on a page this long fails the same way every
 * time — someone renames a section, the anchor above it goes on pointing at a
 * fragment that no longer exists, and the page looks broken rather than stale.
 * `screens/sections.ts` states the same rule for page two.
 */
export const SECTIONS = [
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
