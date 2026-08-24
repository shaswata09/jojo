import { useMemo } from 'react'
import { roleVocabulary } from '../core/model'
import { useApplications } from './use-applications'
import { useProfile } from './use-profile'

/**
 * Every role tag this store should offer, in the order it offers them.
 *
 * WHY A HOOK AND NOT A CONSTANT. `ROLES` used to be five strings in
 * `core/model.ts`, and `roleTag` is required on every application and drives
 * both the role filter and every per-role figure in Statistics — so those five
 * were not a starting point, they were the only shapes a job search was allowed
 * to take. Anyone outside academic CS had to file under a label that was not
 * true, and the charts then read that label back as if it were.
 *
 * The list is the profile's now, and this is what reads it. Shared rather than
 * written twice because the two apps must offer the same vocabulary: a role
 * added on the phone has to appear in the web app's picker, and it does, because
 * the list travels with the profile like everything else in the store.
 *
 * WHY THE APPLICATIONS ARE MIXED IN. Deleting a role from the profile must not
 * rewrite the records that carry it. Without the union, removing "Lecturer"
 * would drop every lecturer application out of the filter and out of the
 * per-role table — the records would still be there and the app would simply
 * have stopped mentioning them. `roleVocabulary` keeps a tag that is in use
 * visible whether or not it is still on the list.
 */
export function useRoleVocabulary(): string[] {
  const { profile } = useProfile()
  const { all } = useApplications()

  return useMemo(() => roleVocabulary(profile.roles, all), [profile.roles, all])
}
