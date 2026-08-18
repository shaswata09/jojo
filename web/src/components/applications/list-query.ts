/**
 * What the Applications page shows, and why it is sometimes showing nothing.
 *
 * Four rules used to sit inline in `routes/Applications.tsx`, each inside its
 * own `useMemo`: which fields the search box looks at, how the stage counts are
 * taken, how the three sort keys order rows, and which of the four filters is
 * holding the list empty. They are the page's whole answer to "what am I
 * looking at", and none of them was reachable without rendering the route.
 *
 * The concrete task this unblocks: the board and the table disagreed once
 * already — the board read straight from `all` while the table read the
 * filtered pool, so a search that emptied the table left the board showing
 * every record. That class of bug is a second reader of the rule, and there is
 * now exactly one. It also puts `localeCompare` (see the note on
 * `compareApplications`) in one greppable place instead of inside a route.
 *
 * WHERE THIS SHOULD END UP: the service layer — `kg/react` as a projection, or
 * `kg/core` as a pure filter the projection calls. Everything here is domain
 * vocabulary a second front end restates verbatim; nothing in it is web.
 */

import { listJoin } from '@/components/common/text'
import { STAGES, STAGE_LABEL, displayName } from '@/data/seed'
import type { Application, Stage } from '@/data/seed'

/**
 * The sort keys the table header offers.
 *
 * Spelled out rather than imported from `lib/links`, which owns the URL codec
 * for them: that module pulls in react-router, and this one has no business
 * knowing the app has routes. The three strings have to match, and they are
 * three strings.
 */
export type ApplicationSort = { key: 'daysAgo' | 'stage' | 'role'; dir: 'asc' | 'desc' }

/**
 * Everything the page filters by *except* the stage — the pool both views draw
 * from. Stage is the exception because the board is already grouped by it.
 *
 * The role and keyword tests arrive as predicates rather than as sets: both
 * live in a React context whose selection is UI state, and neither belongs in a
 * rule about what a record says.
 */
export function filterApplications({
  all,
  query,
  matchesRole,
  matchesKeyword,
}: {
  all: readonly Application[]
  query: string
  matchesRole: (roleTag: Application['roleTag']) => boolean
  matchesKeyword: (application: Application) => boolean
}): Application[] {
  const q = query.trim().toLowerCase()
  return all.filter((a) => {
    if (!matchesRole(a.roleTag)) return false
    if (!matchesKeyword(a)) return false
    if (!q) return true
    // Searches what is on screen plus the stage name, so typing "offer" finds
    // the row whose only mention of it is a chip. Joined before the test rather
    // than tested per field, which is deliberate: "rice stat" finds "Rice —
    // Statistics" because the query is allowed to span the gap between two
    // fields. The Vault's `matchesQuery` does NOT do this, and folds accents,
    // which this does not — see the note at the top of `vault/search.ts`.
    return [a.org, a.role, a.note, a.roleTag, STAGE_LABEL[a.stage]]
      .join(' ')
      .toLowerCase()
      .includes(q)
  })
}

/**
 * Stage counts over the pool, not over everything.
 *
 * They were counted before the search and the keyword chips ran, so `All 8` sat
 * above four rows and each stage chip promised records the table would not
 * show.
 */
export function countByStage(pool: readonly Application[]): Record<string, number> {
  const map: Record<string, number> = {}
  for (const a of pool) map[a.stage] = (map[a.stage] ?? 0) + 1
  return map
}

/**
 * HERMES NOTE, carry it if this moves below the seam: `localeCompare` without
 * full ICU does not throw — it silently sorts differently. A name sort that
 * disagrees between two clients on the same data is the failure that never gets
 * a bug report.
 */
export function compareApplications(sort: ApplicationSort) {
  const dir = sort.dir === 'asc' ? 1 : -1
  const stageRank = (stage: Stage) => STAGES.findIndex((s) => s.id === stage)

  return (a: Application, b: Application) => {
    if (sort.key === 'daysAgo') return (a.daysAgo - b.daysAgo) * dir
    if (sort.key === 'stage') return (stageRank(a.stage) - stageRank(b.stage)) * dir
    // 'role' sorts by the record's display name — employer first, then role —
    // because that is the column's text, and sorting a column by something
    // other than what it prints is the sort nobody trusts twice.
    return displayName(a).localeCompare(displayName(b)) * dir
  }
}

/**
 * Which filters are holding the list empty, named out loud.
 *
 * Four controls can blank it — the search box, the stage chips, the keyword row
 * and the role filter — and "nothing matches" without saying which one is doing
 * it leaves the reader hunting across the toolbar for the switch to flip. The
 * role filter is the one that used to be unnameable here: it lived in the top
 * bar, so the page could say "nothing carries the Offer stage" while ten
 * records sat hidden behind a control this page could not reach.
 */
export function emptyReason({
  query,
  stageFilter,
  keywordCount,
  roleCount,
}: {
  query: string
  stageFilter: Stage | 'all'
  keywordCount: number
  roleCount: number
}): string {
  const on = [
    query.trim() ? 'that search' : '',
    stageFilter === 'all' ? '' : `the ${STAGE_LABEL[stageFilter]} stage`,
    keywordCount > 0 ? 'the selected keywords' : '',
    roleCount > 0 ? 'the selected roles' : '',
  ].filter(Boolean)
  if (on.length === 0) return 'Nothing here to show.'
  return `Nothing carries ${listJoin(on)}.`
}
