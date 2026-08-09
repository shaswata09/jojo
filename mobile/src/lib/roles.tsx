import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ROLES, type RoleTag } from '@/data/seed'
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

  const activeRoles = useMemo(
    () => (selected.size === 0 ? [...ROLES] : ROLES.filter((r) => selected.has(r))),
    [selected],
  )

  const value = useMemo(
    () => ({ selected, toggle, setAll, clear, matches, activeRoles }),
    [selected, toggle, setAll, clear, matches, activeRoles],
  )

  return <RolesContext value={value}>{children}</RolesContext>
}
