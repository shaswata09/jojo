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
}

export const RolesContext = createContext<RolesContextValue | null>(null)

/** The selection with `role` flipped: added if absent, removed if present. */
export function toggledRole(selected: ReadonlySet<RoleTag>, role: RoleTag): ReadonlySet<RoleTag> {
  const next = new Set(selected)
  if (next.has(role)) next.delete(role)
  else next.add(role)
  return next
}

/** Whether a record with `role` shows under `selected`. Empty means everything. */
export function roleMatches(selected: ReadonlySet<RoleTag>, role: RoleTag): boolean {
  return selected.size === 0 || selected.has(role)
}

/**
 * The records the selected roles let through, and the two count lists the
 * charts read, recounted over them.
 *
 * With nothing selected it hands back the very arrays it was given, so an
 * unfiltered dashboard is the same objects it always was and no memo
 * downstream of it breaks. The count lists keep every entry, zeros included,
 * because their order is what holds each stage's and each source's colour
 * still while the filter changes.
 */
export function scopeByRoles<
  A extends { roleTag: RoleTag; stage: string; source?: string },
  S extends { id: string; count: number },
  C extends { source: string; count: number },
>(
  base: { all: readonly A[]; stageCounts: readonly S[]; sourceCounts: readonly C[] },
  selected: ReadonlySet<RoleTag>,
): { all: readonly A[]; stageCounts: readonly S[]; sourceCounts: readonly C[] } {
  if (selected.size === 0) return base
  const all = base.all.filter((a) => roleMatches(selected, a.roleTag))
  return {
    all,
    stageCounts: base.stageCounts.map((s) => ({
      ...s,
      count: all.filter((a) => a.stage === s.id).length,
    })),
    sourceCounts: base.sourceCounts.map((c) => ({
      ...c,
      count: all.filter((a) => a.source === c.source).length,
    })),
  }
}

export function useRoles() {
  const ctx = useContext(RolesContext)
  if (!ctx) throw new Error('useRoles must be used inside <RolesProvider>')
  return ctx
}
