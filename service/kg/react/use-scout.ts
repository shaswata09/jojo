/**
 * L4 — useScout().
 *
 * No longer "signature frozen": that constraint existed to let the removed
 * `store-context.ts` façade keep re-exporting this unchanged, and the façade is
 * gone. `addMatch` was dropped on that basis — see below.
 *
 * The two promotions used to be `addApplication` followed by `updateMatch` in
 * one tick with nothing making them atomic (both in the removed
 * `store-context.ts`): a failure between them produced an application nothing pointed at,
 * and the match still offering "Add to applications" for a job you had already
 * added. They are one tool and one transaction now, and one Undo.
 *
 * `linked` is not passed anywhere below. It was the `BECAME` edge rendered as a
 * boolean and needed four write sites to stay honest; it is derived in the
 * projection, so a posting cannot claim a link to an application that is gone.
 */

import { useCallback, useMemo } from 'react'
import type { Match, Pipeline, RoleTag, SavedPosting } from '../core/model'
import { useGraph, useKg } from './kg-context'
import { useReadBack } from './read-back'
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

  const readBack = useReadBack()

  const application = useCallback(
    (id: string) => projections.application(repo.getSnapshot(), id),
    [repo, projections],
  )

  /* -------------------------------- matches ------------------------------- */

  // `addMatch` was here and is deleted: nothing in the app ever called it. It
  // was retained on the strength of a note in `kg/tools/scout.ts` claiming it was
  // "part of a signature 36 files compile against" — that count belonged to the
  // removed `store-context.ts` façade, not to this hook, and `useScout` has six
  // consumers, none of which destructures it. Matches are created by
  // `scout.match.save` from the tools layer and promoted from here; the app has
  // no hand-authored-match surface. If one lands, this is four lines.

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
      //
      // The consequence, which is the part that bites: this is TWO commits, so
      // it lands two journal entries and two undo entries. That is safe only
      // because `undoableWith` (in `undo.ts`) reverts every entry a handler
      // committed rather than just the last one — otherwise one ⌘Z would strip
      // the link and leave the posting behind. Anyone folding these back into a
      // single `scout.posting.save` input should do it for atomicity, and should
      // know that the two-entry path is currently load-bearing on that rule.
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
        ...(draft.kind === undefined ? {} : { kind: draft.kind }),
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
