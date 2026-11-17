/**
 * The thirteen sections, declared once.
 *
 * The ids are read twice — by the jump list at the top and by the `id` on each
 * panel — so they come from one object rather than being typed out in both
 * places. A hand-written contents list on a page this long fails the same way
 * every time: someone renames a section and the anchor above it goes on
 * pointing at a fragment that no longer exists, which scrolls nowhere and looks
 * like a broken page rather than a stale link.
 */
export const S = {
  doors: 'doors',
  dashboard: 'dashboard',
  applications: 'applications',
  calendar: 'calendar',
  vault: 'vault',
  scout: 'scout',
  statistics: 'statistics',
  graph: 'graph',
  transfer: 'transfer',
  profile: 'profile',
  assistant: 'assistant',
  settings: 'settings',
  guide: 'guide',
} as const

/** The jump list, in page order. Each label is `guide:screens.sections.<id>`. */
export const SECTIONS: readonly { id: string }[] = [
  { id: S.doors },
  { id: S.dashboard },
  { id: S.applications },
  { id: S.calendar },
  { id: S.vault },
  { id: S.scout },
  { id: S.statistics },
  { id: S.graph },
  { id: S.transfer },
  { id: S.profile },
  { id: S.assistant },
  { id: S.settings },
  { id: S.guide },
]
