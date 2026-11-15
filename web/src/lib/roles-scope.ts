import { useMemo } from 'react'
import { useApplications } from '@jojo/service/react/use-applications'
import { scopeByRoles, useRoles } from '@/lib/roles-context'

/**
 * The applications the top-bar role filter lets through, for the charts.
 *
 * The filter sits in the top bar, on every page, so every chart and count on
 * the dashboard and on Statistics has to answer to it. A number that ignored
 * it while the bar said "2 selected" would be the ambiguity that got the
 * filter moved off the bar once already. Each chart reads its records from
 * here rather than from `useApplications`, so "which records does this
 * count?" has one answer.
 *
 * `total` is the whole store, so a panel can tell "nothing tracked" from
 * "nothing under these roles": the first offers to add an application, the
 * second offers to clear the filter.
 */
export function useScopedApplications() {
  const { all, stageCounts, sourceCounts } = useApplications()
  const { selected } = useRoles()

  return useMemo(
    () => ({
      ...scopeByRoles({ all, stageCounts, sourceCounts }, selected),
      total: all.length,
      filtered: selected.size > 0,
    }),
    [all, stageCounts, sourceCounts, selected],
  )
}
