import type { Urgency } from '@jojo/service/data/seed'
import type { TimelineKind } from '@jojo/service/data/timeline'
import type { FeatherIconName } from '@react-native-vector-icons/feather/static'
import type { Palette } from '@/theme/tokens'

/**
 * How a dated item looks, wherever it appears.
 *
 * Five surfaces render the same timeline item — the week ahead, the glance
 * month, the calendar grid, the record's own list and the Vault's reminders —
 * and each used to carry its own copy of these maps against its own narrower
 * kind union. A kind added to `TimelineKind` then compiled everywhere and
 * rendered nothing as an icon in whichever copy had been missed.
 *
 * The icon names are Feather's, which is the set closest in weight to the
 * lucide icons the web app draws. Where Feather has no equivalent the nearest
 * honest glyph is used and noted.
 */
// Named rather than derived. This used to be
// `React.ComponentProps<typeof import(...).Feather>['name']` — a type-position
// dynamic import that `tsc` resolved and `vitest` never saw, so the two tools
// disagreed about what this file depended on. The icon package exports the
// union directly, so the indirection had nothing left to buy.
export type FeatherName = FeatherIconName

export const KIND_ICON: Record<TimelineKind, FeatherName> = {
  deadline: 'clock',
  interview: 'video',
  // Feather has no plane; a departure is the nearest thing it draws.
  visit: 'navigation',
  call: 'users',
  prep: 'file-text',
  admin: 'bell',
  'follow-up': 'corner-up-right',
}

export const KIND_LABEL: Record<TimelineKind, string> = {
  deadline: 'Deadline',
  interview: 'Interview',
  visit: 'Visit',
  call: 'Call',
  prep: 'Prep',
  admin: 'Admin',
  'follow-up': 'Follow-up',
}

/** Derived from the icon map, so a new kind cannot be missed by a legend. */
export const TIMELINE_KINDS = Object.keys(KIND_ICON) as TimelineKind[]

export const urgencyColor = (urgency: Urgency, c: Palette) =>
  urgency === 'red' ? c.danger : urgency === 'amber' ? c.warning : c.text3
