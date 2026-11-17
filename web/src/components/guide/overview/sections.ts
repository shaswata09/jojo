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
 *
 * Each label is the catalog key `guide:overview.sections.<id>`, translated
 * where the list is rendered rather than here.
 */
export const SECTIONS = [
  { id: 'application' },
  { id: 'dates' },
  { id: 'vault' },
  { id: 'profile' },
  { id: 'keys' },
  { id: 'keywords' },
  { id: 'graph' },
  { id: 'data' },
  { id: 'ladder' },
] as const
