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

export function useProfile() {
  const graph = useGraph()
  const { projections } = useKg()
  const run = useRun()

  const profile = projections.profile(graph)

  const update = useCallback(
    (patch: Partial<Profile>) => {
      run('profile.set', {
        ...present('text', patch.text),
        ...present('matchTerms', patch.matchTerms),
        ...present('includeAcademia', patch.includeAcademia),
        ...present('includeIndustry', patch.includeIndustry),
      })
    },
    [run],
  )

  const isBlank = useMemo(() => profileIsBlank(profile), [profile])

  return useMemo(() => ({ profile, update, isBlank }), [profile, update, isBlank])
}
