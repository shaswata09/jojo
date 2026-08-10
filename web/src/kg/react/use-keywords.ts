/**
 * L4 — keywords as graph reads and writes, for `src/lib/labels.tsx` to bind.
 *
 * D14: a keyword is a node and tagging is a `TAGS` edge. What used to be a
 * `Record<recordId, labelId[]>` in a provider ABOVE the store is now edges
 * inside it, which deletes a whole class of bug rather than fixing an instance
 * of it — every write that touched records had to carry the keyword map by hand,
 * fifteen sites did, and the ones that did not left edges outliving the records
 * they pointed at.
 *
 * `countFor` is a set-size read instead of the O(labels × records) scan
 * `labels.tsx:219-229` ran on every render (R-10).
 *
 * The filter SELECTION does not live here. It is UI state — which chips are lit
 * on this screen, in this tab — and it stays in `labels.tsx`, which is the whole
 * of what that file is now.
 */

import { useCallback } from 'react'
import type { Label, LabelTone, NodeId } from '@/kg/core/model'
import { isNodeId } from '@/kg/core/ref'
import { useGraph, useKg } from './kg-context'
import { useRun } from './use-tool'
import { nothingToRestore } from './patch'

/**
 * A record key from a card, as a NodeId.
 *
 * Cards still spell an application's key `refKey('app', a.id)` — the wrapper
 * that used to disambiguate the six seeded records answering to 'stripe'. With
 * type-prefixed ids the id already says which, so the wrapper is redundant, and
 * `'app:' + 'app:0192…'` is what arrives. Unwrapping it here rather than editing
 * nineteen call sites keeps Wave 1's promise that no consumer file changes;
 * Wave 4's codemod deletes the wrapper and this function with it.
 */
export function recordKey(key: string): NodeId | undefined {
  // Both halves are read BEFORE the guard. `isNodeId` is a predicate over
  // `unknown`, so its false branch narrows a `string` to `never` and every
  // subsequent `key.slice` stops compiling — a fact worth writing down, because
  // the obvious fix is to weaken the predicate and that would cost the checks
  // it does everywhere else.
  const at = key.indexOf(':')
  const wrapped = at === -1 ? '' : key.slice(at + 1)
  if (isNodeId(key)) return key
  return isNodeId(wrapped) ? wrapped : undefined
}

const EMPTY: readonly Label[] = []

export function useKeywords() {
  const graph = useGraph()
  const { repo, projections } = useKg()
  const run = useRun()

  const labels = projections.keywords(graph)

  /**
   * The keywords on one record, in the order the keywords themselves are in.
   *
   * Display order follows the keyword list rather than the order they were
   * attached, which is what the old `labelsOf` did by filtering the labels array
   * — so a chip does not move when someone re-tags a record.
   */
  const labelsOf = useCallback(
    (key: string): Label[] => {
      const record = recordKey(key)
      if (record === undefined) return [...EMPTY]
      const mine = new Set(graph.in(record, 'TAGS').map((e) => e.from))
      return mine.size === 0 ? [...EMPTY] : labels.filter((l) => mine.has(l.id))
    },
    [graph, labels],
  )

  const labelIdsOf = useCallback((key: string) => labelsOf(key).map((l) => l.id), [labelsOf])

  const addLabel = useCallback(
    (name: string) => {
      // '' for a blank name is the one input that creates nothing, and it is the
      // documented contract: the picker calls this on every keystroke.
      if (!name.trim()) return ''
      const result = run('keyword.create', { name })
      return result.ok ? result.output : ''
    },
    [run],
  )

  const renameLabel = useCallback(
    (id: string, name: string) => {
      if (!name.trim()) return false
      return run('keyword.rename', { id, name }).ok
    },
    [run],
  )

  const setTone = useCallback(
    (id: string, tone: LabelTone) => {
      run('keyword.tone.set', { id, tone })
    },
    [run],
  )

  /**
   * Delete, and the generic undo that replaced a hand-rolled three-part one.
   *
   * `labels.tsx:86-146` stashed the chip's slot, the records it was on and
   * whether it was filtering, then put all three back. Two of those are edges
   * and the journal captures them; the third is the filter selection, which is
   * UI state and is restored by the caller in `labels.tsx`.
   */
  const removeLabel = useCallback(
    (id: string) => {
      const result = run('keyword.delete', { id })
      return { restore: (result.ok && result.undo) || nothingToRestore }
    },
    [run],
  )

  const toggleOn = useCallback(
    (key: string, labelId: string) => {
      const record = recordKey(key)
      if (record === undefined) return
      // Read then asked for a state, not toggled in the tool. `keyword.attach`
      // and `keyword.detach` are two verbs for the reason §4 gives: an undo
      // firing after the chip was cleared elsewhere would put it back on.
      const on = repo
        .getSnapshot()
        .out(labelId, 'TAGS')
        .some((e) => e.to === record)
      if (on) run('keyword.detach', { record, keyword: labelId })
      else run('keyword.attach', { record, keyword: labelId })
    },
    [repo, run],
  )

  const setRecord = useCallback(
    (key: string, labelIds: readonly string[]) => {
      const record = recordKey(key)
      if (record === undefined) return
      run('keyword.record.set', { record, keywords: [...labelIds] })
    },
    [run],
  )

  /**
   * Forgets a record's tagging without touching the keywords themselves.
   *
   * Now the same call as "set it to nothing", because there is no longer a map
   * with a key in it that could be absent rather than empty — the distinction
   * `removeRecord` existed to preserve was an artefact of the map.
   */
  const removeRecord = useCallback(
    (key: string) => {
      const record = recordKey(key)
      if (record === undefined) return
      run('keyword.record.set', { record, keywords: [] })
    },
    [run],
  )

  const countFor = useCallback((labelId: string) => graph.out(labelId, 'TAGS').length, [graph])

  const countWithin = useCallback(
    (labelId: string, ids: readonly string[]) => {
      const tagged = new Set(graph.out(labelId, 'TAGS').map((e) => e.to))
      let n = 0
      for (const id of ids) {
        const record = recordKey(id)
        if (record !== undefined && tagged.has(record)) n += 1
      }
      return n
    },
    [graph],
  )

  const carries = useCallback(
    (key: string, selected: ReadonlySet<string>) => {
      const record = recordKey(key)
      if (record === undefined) return false
      return graph.in(record, 'TAGS').some((e) => selected.has(e.from))
    },
    [graph],
  )

  return {
    labels,
    labelsOf,
    labelIdsOf,
    addLabel,
    renameLabel,
    setTone,
    removeLabel,
    toggleOn,
    setRecord,
    removeRecord,
    countFor,
    countWithin,
    carries,
  }
}
