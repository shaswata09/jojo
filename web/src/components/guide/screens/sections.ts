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

export const SECTIONS: { id: string; label: string }[] = [
  { id: S.doors, label: 'Where each page is' },
  { id: S.dashboard, label: 'Today' },
  { id: S.applications, label: 'Applications' },
  { id: S.calendar, label: 'Calendar' },
  { id: S.vault, label: 'Vault' },
  { id: S.scout, label: 'Job scout' },
  { id: S.statistics, label: 'Statistics' },
  { id: S.graph, label: 'Graph' },
  { id: S.transfer, label: 'Transfer' },
  { id: S.profile, label: 'My profile' },
  { id: S.assistant, label: 'Assistant' },
  { id: S.settings, label: 'Settings' },
  { id: S.guide, label: 'This guide' },
]
