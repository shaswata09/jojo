import type { Urgency } from '@/data/seed'
import type { TimelineKind } from '@/data/timeline'
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
export type FeatherName = React.ComponentProps<typeof import('@expo/vector-icons').Feather>['name']

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
