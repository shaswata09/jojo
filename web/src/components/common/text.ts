/**
 * The two counting phrases the app speaks, in one place.
 *
 * They lived under `applications/detail/`, where the record header prints
 * "3 days ago" and the delete confirmation lists "2 reminders, 1 event and 4
 * saved items". But `dashboard/OwedThisWeek.tsx` had written `plural` out a
 * second time with a different body reaching the same answer, and
 * `routes/Applications.tsx` had hand-rolled the "a, b and c" join inline for
 * its empty-state reason. Three features say these sentences, so they belong
 * in the folder that crosses features rather than in one feature's subfolder.
 *
 * WHERE THIS SHOULD END UP: the service layer, next to whatever else formats a
 * sentence about the graph. `src/data/statistics.ts` holds a fourth `plural`
 * below the seam that this file cannot reach from up here, and every tool's
 * `describe` builds sentences of the same kind. Pure, no DOM, no clock.
 */

export const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** 'a', 'a and b', 'a, b and c'. */
export function listJoin(parts: string[]) {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}
