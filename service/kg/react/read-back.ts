/**
 * L4 — reading back a record the same handler just created.
 *
 * This was two identical copies, in `use-vault.ts` and `use-scout.ts`, of which
 * only the vault's carried the explanation. That is the dangerous shape for this
 * particular helper: the whole of it is one non-obvious word — `repo.getSnapshot()`
 * where the surrounding hook already has a perfectly good `graph` in scope — and
 * a copy with no comment on it is a copy a simplifier deletes.
 *
 * `use-applications.ts` open-codes a third variant. It is deliberately not routed
 * through here: it reads back through `projections.application`, a single-record
 * projector rather than a list, so it has no `list`/`find` to hand over. Same
 * rule, different shape — see the note there.
 */

import { useCallback } from 'react'
import type { GraphSnapshot } from '../core/snapshot'
import { useKg } from './kg-context'

/**
 * The record just written, read back off the COMMITTED snapshot.
 *
 * `graph` in the calling hook is the reading that render was given, and a create
 * inside a handler commits after it — so looking the new id up there would return
 * undefined and every card that navigates to what it just made would land on
 * "this no longer exists". Hence `repo.getSnapshot()`, which mints a fresh
 * reading per commit.
 *
 * Throws rather than returning undefined: every caller has just been handed an id
 * by a tool that reported success, so a miss is a broken projection, not a user
 * error, and the callers' signatures promise a record back.
 */
export function useReadBack(): <R extends { id: string }>(
  list: (g: GraphSnapshot) => readonly R[],
  id: string,
) => R {
  const { repo } = useKg()
  return useCallback(
    <R extends { id: string }>(list: (g: GraphSnapshot) => readonly R[], id: string): R => {
      const found = list(repo.getSnapshot()).find((r) => r.id === id)
      if (!found) throw new Error('The record was created and could not be read back.')
      return found
    },
    [repo],
  )
}
