/**
 * L4 — useApplications(). Signature frozen; the façade that re-exported it is gone.
 *
 * Every member below returns exactly what the reducer version returned, which is
 * why Wave 1 could rewrite the store without opening a single card and Wave 4
 * could delete the façade by rewriting one import line per file. Three things
 * are different underneath and none of them is visible from a card:
 *
 * - `remove()` hands back `repo`'s own undo instead of a hand-written closure
 *   that had to remember six collections, two spellings of the keyword key, and
 *   the array index the record sat at. The `at` index is gone with it: ids are
 *   UUIDv7, so position is a function of the id (D4).
 * - `update()` no longer spreads `daysAgo: 0` into every patch. The tool stamps
 *   `lastActionAt`, and `daysAgo` is derived from it — which is the same
 *   behaviour and the only version of it that survives a reload.
 * - `add()` is one transaction covering the record, its organisation, its
 *   keywords and its deadline. It used to be four writes in a component with
 *   nothing making them atomic.
 */

import { useCallback, useMemo } from 'react'
import { resolveAddress } from '../core/address'
import type { Application, OfferApplication, Stage } from '../core/model'
import { SOURCES, STAGE_LABEL, STAGE_VALUES } from '../core/model'
import { useGraph, useKg } from './kg-context'
import { useRun } from './use-tool'
import { asNull, asText, nothingToRestore, present } from './patch'

/**
 * `lastAction` and `daysAgo` are stamped by `add`, so a caller never has to.
 *
 * `slug` is omitted rather than optional: it is minted from the employer name by
 * `application.create`, through `uniqueSlug` against the slugs already taken, so
 * a draft carrying one would be a suggestion the tool silently ignores — and the
 * URL it implied would point at nothing.
 */
export type ApplicationDraft = Omit<Application, 'id' | 'slug' | 'lastAction' | 'daysAgo'> &
  Partial<Pick<Application, 'lastAction' | 'daysAgo'>>

/** The instant that reads as `days` ago from `today`, at the same local noon. */
const agoOf = (today: string, days: number) =>
  new Date(Date.parse(`${today}T12:00:00`) - days * 86_400_000).toISOString()

export function useApplications() {
  const graph = useGraph()
  const { repo, projections, today } = useKg()
  const run = useRun()

  const all = projections.applications(graph)

  const byId = useMemo(() => new Map(all.map((a) => [a.id, a])), [all])

  /**
   * The one resolver for a URL segment: the slug a link was built from, or a
   * NodeId out of a link built before the builder emitted slugs.
   *
   * There must be exactly one of these, and everything that reads the path must
   * come through it. Three sites in `Applications.tsx` used to compare the raw
   * parameter against `a.id` themselves, so on `/applications/rice` — the URL
   * that already worked — the panel rendered the right record while the card
   * behind it was not marked open, the row never scrolled into view, and the
   * mobile sheet was titled "Application".
   *
   * The `byId` hit is not a second resolver, it is an identity preserve:
   * `createOneProjection` (in `kg/core/project.ts`) keeps its own cache, so
   * projecting the record again would hand the detail route a different object than the
   * list holds and defeat every `React.memo` keyed on it.
   */
  const get = useCallback(
    (key: string) => {
      const node = resolveAddress(graph, 'application', key)
      if (!node) return undefined
      return byId.get(node.id) ?? projections.application(graph, node.id)
    },
    [byId, graph, projections],
  )

  const project = useCallback(
    (id: string) => projections.application(repo.getSnapshot(), id),
    [repo, projections],
  )

  const add = useCallback(
    (draft: ApplicationDraft): Application => {
      const result = run('application.create', {
        org: draft.org,
        role: draft.role,
        roleTag: draft.roleTag,
        stage: draft.stage,
        note: draft.note,
        ...present('lastAction', draft.lastAction),
        ...present('source', draft.source),
        ...present('location', draft.location),
        ...present('comp', draft.comp),
        ...present('url', draft.url),
        ...present('flagged', draft.flagged),
        ...present('appliedOn', draft.appliedOn),
        ...present('submittedOn', draft.submittedOn),
        ...present('firstReplyOn', draft.firstReplyOn),
        ...present('outcome', draft.outcome),
        ...present('offer', draft.offer),
      })
      // Throwing rather than returning undefined: the signature says an
      // Application comes back and two call sites navigate to it. A refusal here
      // is a schema the form disagrees with, which is a bug, not a user error.
      if (!result.ok) throw new Error(result.errors[0]?.message ?? 'Could not add the application.')
      // `project` reads `repo.getSnapshot()`, not the `graph` this render was
      // given, for the reason `useReadBack` in `read-back.ts` spells out: the
      // create commits after this render's snapshot was taken. This is the same
      // rule as that helper and deliberately not routed through it — an
      // application is read back through a single-record projector, so there is
      // no list to hand over.
      const created = project(result.output)
      if (!created) throw new Error('The application was created and could not be read back.')
      return created
    },
    [run, project],
  )

  /**
   * A patch over the whole record, including clearing a field.
   *
   * A key that is PRESENT and `undefined` means "clear this", which is how
   * `revertOf` (in `routes/ApplicationDetail.tsx`) spells a restore; a key that is
   * absent means "leave it alone". `Object.hasOwn` is the only thing that can
   * tell those apart, and conflating them would make an undo of a stage change
   * quietly wipe the dates the stage change had filled in.
   */
  const update = useCallback(
    (id: string, patch: Partial<Application>) => {
      run('application.update', {
        id,
        // `daysAgo` is derived and cannot be written, but a card restoring a
        // before-image hands one back — so it is turned into the instant it
        // describes. Dropping it would have made every undo of a stage move
        // leave the row claiming it was touched today.
        ...(typeof patch.daysAgo === 'number' ? { lastActionAt: agoOf(today, patch.daysAgo) } : {}),
        ...present('org', patch.org),
        ...asText('role', patch, 'role'),
        ...asText('note', patch, 'note'),
        ...present('roleTag', patch.roleTag),
        ...present('stage', patch.stage),
        ...present('lastAction', patch.lastAction),
        ...asText('location', patch, 'location'),
        ...asText('comp', patch, 'comp'),
        ...asText('url', patch, 'url'),
        ...asNull('source', patch, 'source'),
        ...asNull('flagged', patch, 'flagged'),
        ...asNull('appliedOn', patch, 'appliedOn'),
        ...asNull('submittedOn', patch, 'submittedOn'),
        ...asNull('firstReplyOn', patch, 'firstReplyOn'),
        ...asNull('outcome', patch, 'outcome'),
        ...asNull('offer', patch, 'offer'),
      })
    },
    [run, today],
  )

  /** Returns a true undo — the record, its position, and every edge it had. */
  const remove = useCallback(
    (id: string) => {
      const result = run('application.delete', { id })
      return { restore: (result.ok && result.undo) || nothingToRestore }
    },
    [run],
  )

  const setStage = useCallback(
    (id: string, stage: Stage) =>
      update(id, { stage, lastAction: `Moved to ${STAGE_LABEL[stage]}` }),
    [update],
  )

  /**
   * The same posting, applied for again. Back to draft, and the offer, outcome
   * and dates are dropped: those belong to the attempt that earned them, and a
   * copy carrying someone else's offer is worse than no copy at all.
   */
  const duplicate = useCallback(
    (id: string) => {
      const result = run('application.duplicate', { id })
      return result.ok ? project(result.output) : undefined
    },
    [run, project],
  )

  /**
   * `{ id, label, count }`, and deliberately no colour.
   *
   * This used to spread `STAGES` from `@/data/seed`, which carries a `dot` field
   * whose values are Tailwind class names — 'bg-stage-draft', 'bg-stage-offer'.
   * So a CSS class was being minted inside the one layer that is supposed to
   * mount unchanged on React Native, where it resolves to nothing. Neither guard
   * could see it: `check-platform.mjs` looks for platform IDENTIFIERS and a class
   * name is a string literal, and `check-layers.mjs` reads import direction,
   * which was downward and legal. Built from `STAGE_VALUES` and `STAGE_LABEL`
   * instead, both of which are the model's own. A web caller that wants the
   * colour reads `STAGE_DOT[id]` from `@/data/seed`, which is where a Tailwind
   * token belongs — `PipelineBreakdown` is the one that does.
   *
   * The import that carried it is gone as well: `check-layers.mjs` now names the
   * only two production modules under `kg` allowed to read `@/data` at all,
   * and neither is a hook.
   */
  const stageCounts = useMemo(
    () =>
      STAGE_VALUES.map((id) => ({
        id,
        label: STAGE_LABEL[id],
        count: all.filter((a) => a.stage === id).length,
      })),
    [all],
  )

  const offers = useMemo(
    () => all.filter((a): a is OfferApplication => a.stage === 'offer' && a.offer !== undefined),
    [all],
  )

  /**
   * Most recently touched first. ASCENDING, because `daysAgo` counts backwards.
   *
   * Spelled out because the comparator reads like the opposite of the name, and
   * because `daysAgo` is not a stored field — it is projected from `lastActionAt`
   * against the provider's `today` (D25). Two consequences: the order is only as
   * correct as `today` is, and sorting on the stored instant instead would be a
   * finer-grained sort, not the same one, since every record touched today ties
   * at 0 here and keeps its id order (D4).
   */
  const recent = useMemo(() => [...all].sort((a, b) => a.daysAgo - b.daysAgo), [all])

  // Every source stays in the list even at zero, so the breakdown's colours and
  // legend order hold still as applications move around.
  const sourceCounts = useMemo(
    () =>
      SOURCES.map((source) => ({ source, count: all.filter((a) => a.source === source).length })),
    [all],
  )

  return useMemo(
    () => ({
      all,
      byId,
      get,
      add,
      update,
      remove,
      setStage,
      duplicate,
      stageCounts,
      offers,
      recent,
      sourceCounts,
    }),
    [
      all,
      byId,
      get,
      add,
      update,
      remove,
      setStage,
      duplicate,
      stageCounts,
      offers,
      recent,
      sourceCounts,
    ],
  )
}
