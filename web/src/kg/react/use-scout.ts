/**
 * L4 — useScout(). Signature frozen; the façade that re-exported it is gone.
 *
 * The two promotions used to be `addApplication` followed by `updateMatch` in
 * one tick with nothing making them atomic (`store-context.ts:790-813`,
 * `:830-857`): a failure between them produced an application nothing pointed at,
 * and the match still offering "Add to applications" for a job you had already
 * added. They are one tool and one transaction now, and one Undo.
 *
 * `linked` is not passed anywhere below. It was the `BECAME` edge rendered as a
 * boolean and needed four write sites to stay honest; it is derived in the
 * projection, so a posting cannot claim a link to an application that is gone.
 */

import { useCallback, useMemo } from 'react'
import type { Match, Pipeline, RoleTag, SavedPosting } from '@/kg/core/model'
import { useGraph, useKg } from './kg-context'
import { useRun } from './use-tool'
import { asNull, nothingToRestore, present } from './patch'

type PostingDraft = Omit<SavedPosting, 'id' | 'savedOn' | 'linked'> & {
  savedOn?: string
  linked?: boolean
}

export function useScout() {
  const graph = useGraph()
  const { repo, projections } = useKg()
  const run = useRun()

  const matches = projections.matches(graph)
  const postings = projections.postings(graph)
  const pipelines = projections.pipelines(graph)

  const readBack = useCallback(
    <R extends { id: string }>(
      list: (g: ReturnType<typeof repo.getSnapshot>) => readonly R[],
      id: string,
    ): R => {
      const found = list(repo.getSnapshot()).find((r) => r.id === id)
      if (!found) throw new Error('The record was created and could not be read back.')
      return found
    },
    [repo],
  )

  const application = useCallback(
    (id: string) => projections.application(repo.getSnapshot(), id),
    [repo, projections],
  )

  /* -------------------------------- matches ------------------------------- */

  const addMatch = useCallback(
    (draft: Omit<Match, 'id'>): Match => {
      const result = run('scout.match.save', {
        role: draft.role,
        detail: draft.detail,
        fit: draft.fit,
        ...present('applicationId', draft.applicationId),
      })
      if (!result.ok) throw new Error(result.errors[0]?.message ?? 'Could not add the match.')
      return readBack(projections.matches, result.output)
    },
    [run, readBack, projections],
  )

  const updateMatch = useCallback(
    (id: string, patch: Partial<Match>) => {
      run('scout.match.update', {
        id,
        ...present('role', patch.role),
        ...present('detail', patch.detail),
        ...present('fit', patch.fit),
        ...asNull('applicationId', patch, 'applicationId'),
      })
    },
    [run],
  )

  const removeMatch = useCallback(
    (id: string) => {
      const result = run('scout.match.dismiss', { id })
      return { restore: (result.ok && result.undo) || nothingToRestore }
    },
    [run],
  )

  /* ------------------------------- postings ------------------------------- */

  const addPosting = useCallback(
    (draft: PostingDraft): SavedPosting => {
      const result = run('scout.posting.save', {
        url: draft.url,
        title: draft.title,
        ...present('size', draft.size),
        ...present('savedOn', draft.savedOn),
      })
      if (!result.ok) throw new Error(result.errors[0]?.message ?? 'Could not save the posting.')
      // The application link is a second, typed write rather than a field on the
      // create: `BECAME` is an edge, and a posting saved with a pointer nobody
      // followed is what `linked` used to be.
      if (draft.applicationId !== undefined) {
        run('scout.posting.update', { id: result.output, applicationId: draft.applicationId })
      }
      return readBack(projections.postings, result.output)
    },
    [run, readBack, projections],
  )

  const updatePosting = useCallback(
    (id: string, patch: Partial<SavedPosting>) => {
      run('scout.posting.update', {
        id,
        ...present('title', patch.title),
        ...present('url', patch.url),
        ...present('size', patch.size),
        ...present('savedOn', patch.savedOn),
        ...asNull('applicationId', patch, 'applicationId'),
      })
    },
    [run],
  )

  const removePosting = useCallback(
    (id: string) => {
      const result = run('scout.posting.delete', { id })
      return { restore: (result.ok && result.undo) || nothingToRestore }
    },
    [run],
  )

  /* ------------------------------- pipelines ------------------------------ */

  const addPipeline = useCallback(
    (draft: Omit<Pipeline, 'id'>): Pipeline => {
      const result = run('scout.pipeline.create', {
        name: draft.name,
        source: draft.source,
        schedule: draft.schedule,
        filter: draft.filter,
        enabled: draft.enabled,
      })
      if (!result.ok) throw new Error(result.errors[0]?.message ?? 'Could not add the pipeline.')
      return readBack(projections.pipelines, result.output)
    },
    [run, readBack, projections],
  )

  const updatePipeline = useCallback(
    (id: string, patch: Partial<Pipeline>) => {
      // `enabled` is its own tool: pausing a pipeline is a decision with its own
      // undo label, and folding it into the generic edit would announce "Pipeline
      // updated" for a switch the user flicked.
      if (patch.enabled !== undefined)
        run('scout.pipeline.enable.set', { id, enabled: patch.enabled })
      const edits = {
        ...present('name', patch.name),
        ...present('source', patch.source),
        ...present('schedule', patch.schedule),
        ...present('filter', patch.filter),
      }
      if (Object.keys(edits).length > 0) run('scout.pipeline.update', { id, ...edits })
    },
    [run],
  )

  const removePipeline = useCallback(
    (id: string) => {
      const result = run('scout.pipeline.delete', { id })
      return { restore: (result.ok && result.undo) || nothingToRestore }
    },
    [run],
  )

  /* ------------------------------ promotions ------------------------------ */

  const promoteToApplication = useCallback(
    (matchId: string, roleTag?: RoleTag) => {
      const result = run('scout.match.promote', { id: matchId, ...present('roleTag', roleTag) })
      return result.ok ? application(result.output) : undefined
    },
    [run, application],
  )

  const promotePosting = useCallback(
    (postingId: string, roleTag?: RoleTag) => {
      const result = run('scout.posting.promote', { id: postingId, ...present('roleTag', roleTag) })
      return result.ok ? application(result.output) : undefined
    },
    [run, application],
  )

  return useMemo(
    () => ({
      matches,
      addMatch,
      updateMatch,
      removeMatch,
      postings,
      addPosting,
      updatePosting,
      removePosting,
      pipelines,
      addPipeline,
      updatePipeline,
      removePipeline,
      promoteToApplication,
      promotePosting,
    }),
    [
      matches,
      addMatch,
      updateMatch,
      removeMatch,
      postings,
      addPosting,
      updatePosting,
      removePosting,
      pipelines,
      addPipeline,
      updatePipeline,
      removePipeline,
      promoteToApplication,
      promotePosting,
    ],
  )
}
