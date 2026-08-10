/**
 * L4 — useStoreAdmin(). Signature frozen; the façade that re-exported it is gone.
 *
 * `reset` and `clearAll` stay SYNCHRONOUS, against §3.5's note that they become
 * async. They do not need to be: `memory.reset` and `memory.clear` are tools, a
 * tool runs inside one synchronous transaction, and the durable write is enqueued
 * behind it (D11). Making them async here would have made two call sites await a
 * promise that resolves before it is returned, and hidden the one place a real
 * await belongs — `repo.flush()`, which arrives with IndexedDB in Wave 2.
 *
 * Neither of them carries a keyword map any more. That is D14: a keyword is a
 * node and tagging is a `TAGS` edge, so clearing the records takes their tags
 * with them in the same transaction. The bug at `store-context.ts:930-936` — a
 * cleared store still reporting "Used on 32 records" in Settings while the
 * Applications filter read 0 for the same keyword on the same screenful — is not
 * fixed here, it is unrepresentable: there is no second store to forget to
 * update.
 */

import { useCallback, useMemo } from 'react'
import { profileIsBlank } from '@/data/profile'
import { useGraph, useKg } from './kg-context'
import { useRun } from './use-tool'

/**
 * Bumped when the shape below changes in a way an importer must notice.
 *
 * It exists so `memory.import` can refuse a file it does not understand rather
 * than half-reading one. An export with no version is not a backup, it is a
 * guess that happens to have worked so far.
 */
const EXPORT_VERSION = 1

export function useStoreAdmin() {
  const graph = useGraph()
  const { repo, projections, now } = useKg()
  const run = useRun()

  /**
   * Which set of records this store holds — 'demo', 'empty' or 'user'.
   *
   * Read off `repo.meta` during render, and `repo.meta` is a getter onto a
   * mutable object that React is not subscribed to. That is safe HERE and
   * nowhere else: `useGraph()` on the line above IS the subscription, and every
   * write that can move `dataSet` goes through `land()` or `replaceAll`, both of
   * which call `notify()`. So this line runs on exactly the commits that can
   * have changed it.
   *
   * Settings used to read the same value through `sessionOf(state)?.meta` and
   * got the right answer for the wrong reason — `BootState` does not change
   * identity when the meta row does, so which of "None of it is yours yet" and
   * "Your own records" it printed depended on the component happening to
   * re-render for some other reason. It does happen to, because `isEmpty` below
   * is on this same subscription; but a reading that is correct only by that
   * coincidence is one refactor away from being silently wrong on the one page
   * whose job is to report what is in the store.
   */
  const dataSet = repo.meta.dataSet

  const reset = useCallback(() => {
    run('memory.reset', {})
  }, [run])

  const clearAll = useCallback(() => {
    run('memory.clear', {})
  }, [run])

  /**
   * Every record, keywords and tagging included.
   *
   * The old comment here read "the store only — labels live in their own
   * provider and are not part of this snapshot, so an export is not yet a full
   * backup". It is deleted because it stopped being true: there is one store,
   * and this is all of it.
   */
  const exportJSON = useCallback(() => {
    const keywords = projections.keywords(graph)
    const taggedBy: Record<string, string[]> = {}
    for (const keyword of keywords) {
      for (const edge of graph.out(keyword.id, 'TAGS')) {
        const list = taggedBy[edge.to]
        if (list) list.push(keyword.id)
        else taggedBy[edge.to] = [keyword.id]
      }
    }

    return JSON.stringify(
      {
        jojo: EXPORT_VERSION,
        exportedAt: now(),
        applications: projections.applications(graph),
        timeline: projections.timeline(graph),
        links: projections.links(graph),
        files: projections.files(graph),
        snippets: projections.snippets(graph),
        postings: projections.postings(graph),
        matches: projections.matches(graph),
        pipelines: projections.pipelines(graph),
        keywords,
        keywordsByRecord: taggedBy,
        profile: projections.profile(graph),
      },
      null,
      2,
    )
  }, [graph, projections, now])

  /**
   * Walked type by type rather than over the projections.
   *
   * The profile is not a list and an organisation is not a record the user made
   * — it is minted on first mention of an employer — so counting either would
   * make a store with nothing in it report that it has something.
   */
  const isEmpty = useMemo(
    () =>
      graph.ofType('application').length === 0 &&
      graph.ofType('timelineItem').length === 0 &&
      graph.ofType('link').length === 0 &&
      graph.ofType('file').length === 0 &&
      graph.ofType('snippet').length === 0 &&
      graph.ofType('posting').length === 0 &&
      graph.ofType('match').length === 0 &&
      graph.ofType('pipeline').length === 0 &&
      profileIsBlank(projections.profile(graph)),
    [graph, projections],
  )

  return useMemo(
    () => ({ reset, clearAll, exportJSON, isEmpty, dataSet }),
    [reset, clearAll, exportJSON, isEmpty, dataSet],
  )
}
