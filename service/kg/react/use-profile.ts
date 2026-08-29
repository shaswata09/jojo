/**
 * L4 — useProfile(). Signature frozen; the façade that re-exported it is gone.
 *
 * The profile record, and the one write it takes.
 *
 * In the graph rather than in route state because the page was losing everything
 * typed into it on the first navigation while its own save bar said the opposite.
 * The page saves ten fields behind one button, so the write is one tool and one
 * journal row — ten `profile.text.set` calls would be ten Undos for one Save.
 */

import { useCallback, useMemo } from 'react'
import { profileIsBlank } from '../core/profile'
import type { Profile } from '../core/model'
import { useGraph, useKg } from './kg-context'
import { useRun } from './use-tool'
import { present } from './patch'

/**
 * The patch a page hands `update()`, as `profile.set`'s input.
 *
 * Lifted out of the callback so it can be asserted without mounting anything
 * (D20), and that is not incidental: the audit found the target-roles panel
 * writing nothing at all, because `roles` was missing from this mapping AND
 * from the patch `tools/profile.ts`'s `run` applies. Both pages call
 * `update({ roles })`, the tool returned `ok: true`, and the stored list never
 * moved — measured against a real repository and tool runtime.
 *
 * EVERY field of `Partial<Profile>` has to be spelled out below. `present`
 * cannot spread what it is not asked for, so a field left out here is dropped
 * in silence by a call that reports success. `use-profile.test.ts` compares
 * this function's output keys against a complete `Profile`, so the next field
 * added to the record fails a test instead of a panel.
 */
export function profileSetInput(patch: Partial<Profile>) {
  return {
    ...present('text', patch.text),
    ...present('matchTerms', patch.matchTerms),
    ...present('roles', patch.roles),
    ...present('includeAcademia', patch.includeAcademia),
    ...present('includeIndustry', patch.includeIndustry),
  }
}

export function useProfile() {
  const graph = useGraph()
  const { projections } = useKg()
  const run = useRun()

  const profile = projections.profile(graph)

  const update = useCallback(
    (patch: Partial<Profile>) => {
      run('profile.set', profileSetInput(patch))
    },
    [run],
  )

  const isBlank = useMemo(() => profileIsBlank(profile), [profile])

  return useMemo(() => ({ profile, update, isBlank }), [profile, update, isBlank])
}
