import { createContext, useContext } from 'react'
import type { RoleTag } from '@/data/seed'

export type RolesContextValue = {
  /** Empty means "everything" — no filter applied. */
  selected: ReadonlySet<RoleTag>
  toggle: (role: RoleTag) => void
  setAll: (roles: RoleTag[]) => void
  clear: () => void
  /** True when a record with this role should be shown. */
  matches: (role: RoleTag) => boolean
  /** Roles actually rendered by charts: the selection, or all when empty. */
  activeRoles: RoleTag[]
}

export const RolesContext = createContext<RolesContextValue | null>(null)

export function useRoles() {
  const ctx = useContext(RolesContext)
  if (!ctx) throw new Error('useRoles must be used inside <RolesProvider>')
  return ctx
}
