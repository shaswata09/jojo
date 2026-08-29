/**
 * How the Applications list orders its rows, out where it can be run.
 *
 * It was four lines inside the `rows` memo in `ApplicationsScreen.tsx`, and it
 * had been wrong there for as long as the toolbar has had a direction control:
 * `dir` was drawn on the icon and read out in the menu, and never reached the
 * comparator OR the memo's dependency list. Tapping "Oldest first" changed the
 * arrow, changed the sentence under it, and left every row exactly where it was.
 * That is not a bug a screen test would have caught first — nothing renders in
 * this app's suite (D20) — so the rule moved here, which is the only place it
 * can be checked at all.
 *
 * The web app states the same rule in `components/applications/list-query.ts`
 * and states it correctly. The two are deliberately not shared yet: that module
 * carries the search, the counts and the empty-reason wording as well, and web's
 * search joins fields while this screen's `matchesQuery` folds accents and does
 * not. Sharing the sort alone is what is honest to share today; the note at the
 * head of web's file already names the service layer as where both should end
 * up.
 *
 * HERMES NOTE, carried from that file: `localeCompare` without full ICU does not
 * throw, it silently sorts differently. A name order that disagrees between the
 * phone and the browser on the same records is the failure nobody reports.
 */

import { STAGES, displayName } from '@jojo/service/data/seed'
import type { Application, Stage } from '@jojo/service/data/seed'

export type SortKey = 'role' | 'stage' | 'daysAgo'
export type SortDir = 'asc' | 'desc'

const stageRank = (stage: Stage) => STAGES.findIndex((s) => s.id === stage)

/**
 * The comparator for one key in one direction.
 *
 * Direction is a factor on the result rather than a branch per key, because a
 * branch per key is three chances to forget one — and forgetting one is the
 * shape the original bug had, at the scale of all three.
 */
export function compareApplications(key: SortKey, dir: SortDir) {
  const sign = dir === 'asc' ? 1 : -1

  return (a: Application, b: Application) => {
    if (key === 'daysAgo') return (a.daysAgo - b.daysAgo) * sign
    if (key === 'stage') return (stageRank(a.stage) - stageRank(b.stage)) * sign
    // 'role' orders by the row's DISPLAY name — employer then role — because
    // that is the text on the row, and a column sorted by something other than
    // what it prints is the sort nobody trusts twice.
    return displayName(a).localeCompare(displayName(b)) * sign
  }
}

/** The rows, sorted. A copy: `sort` mutates, and the pool is shared with the board. */
export function sortApplications(
  pool: readonly Application[],
  key: SortKey,
  dir: SortDir,
): Application[] {
  return [...pool].sort(compareApplications(key, dir))
}
