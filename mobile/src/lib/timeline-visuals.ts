import type { TimelineKind } from '@jojo/service/data/timeline'
import type { FeatherIconName } from '@react-native-vector-icons/feather/static'

/**
 * How a dated item LOOKS on a phone — and the phone's import path for how it
 * reads.
 *
 * The file used to hold both halves. The half that is a rule — what each kind is
 * called, and the order a legend lists them in — is
 * `@jojo/service/core/timeline-view` and is re-exported below rather than
 * declared again. What stays is the half that names a renderer: `KIND_ICON` is
 * Feather, and Feather means nothing to the web app. That is the same cut
 * `web/src/lib/timeline-visuals.ts` makes.
 *
 * Five surfaces render the same timeline item — the week ahead, the glance
 * month, the calendar grid, the record's own list and the Vault's reminders —
 * and each used to carry its own copy of these maps against its own narrower
 * kind union. A kind added to `TimelineKind` then compiled everywhere and
 * rendered nothing as an icon in whichever copy had been missed.
 */
// Named rather than derived. This used to be
// `React.ComponentProps<typeof import(...).Feather>['name']` — a type-position
// dynamic import that `tsc` resolved and `vitest` never saw, so the two tools
// disagreed about what this file depended on. The icon package exports the
// union directly, so the indirection had nothing left to buy.
export type FeatherName = FeatherIconName

/**
 * `TIMELINE_KINDS` comes with them, and it is no longer `Object.keys(KIND_ICON)`.
 *
 * The legend order is a fact about the domain and had no business depending on
 * which icon set is installed — which is exactly what the shared module's own
 * comment says, having been moved off the web's lucide map for the same reason.
 * With both platforms deriving it from their own icons, an eighth
 * `TimelineKind` would have ordered the legend by whoever remembered to add a
 * glyph. The exhaustive `Record` below is what still makes a missing icon a
 * compile error here rather than a blank on a row.
 */
export { KIND_LABEL, TIMELINE_KINDS } from '@jojo/service/core/timeline-view'

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
