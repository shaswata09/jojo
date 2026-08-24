import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { RoleTag } from '@/data/seed'
import { RolesContext } from '@/lib/roles-context'

/**
 * The global job-role filter.
 *
 * Replaces the academia/industry toggle, which was too blunt to act on — a
 * postdoc and a lecturer are both "academia" and nothing like each other.
 *
 * An empty selection means "everything" rather than "nothing", so the app
 * opens unfiltered and clearing the filter is the same gesture as never
 * having set one.
 *
 * SELECTION ONLY. It used to hold `activeRoles` too, derived from the five-entry
 * `ROLES` constant — but the vocabulary is the profile's now and this provider
 * sits above the store, so it cannot read one. `useRoleVocabulary` does, and a
 * consumer that wants "the roles currently showing" filters that list through
 * `matches`. Keeping the selection out here is what lets the filter survive
 * a route change, which is why it was above the store in the first place.
 */
export function RolesProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<ReadonlySet<RoleTag>>(() => new Set<RoleTag>())

  const toggle = useCallback((role: RoleTag) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(role)) next.delete(role)
      else next.add(role)
      return next
    })
  }, [])

  const setAll = useCallback((roles: RoleTag[]) => setSelected(new Set(roles)), [])
  const clear = useCallback(() => setSelected(new Set<RoleTag>()), [])

  const matches = useCallback(
    (role: RoleTag) => selected.size === 0 || selected.has(role),
    [selected],
  )

  const value = useMemo(
    () => ({ selected, toggle, setAll, clear, matches }),
    [selected, toggle, setAll, clear, matches],
  )

  return <RolesContext value={value}>{children}</RolesContext>
}
