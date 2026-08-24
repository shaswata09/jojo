import { useCallback, useMemo } from 'react'
import { resolveAddress } from '../core/address'
import { useGraph, useKg } from './kg-context'
import type { Organisation } from '../core/model'

/**
 * Employers, and everything the store knows about each one.
 *
 * The `organisation` node has existed since the graph did and nothing ever
 * surfaced it: every application points `AT` one, the seeded data has three
 * universities with two roles each, and there was no screen where those two
 * roles appeared together. "Everything about Rice" was answerable by the graph
 * and by nothing a person could click.
 *
 * READ-ONLY, deliberately. An organisation is created by `org.ensure` when an
 * application names it and it has exactly two props — a name and a slug — so
 * there is nothing here to edit that is not better edited on the application
 * that produced it. A rename would have to rewrite every application's employer
 * and is a different feature with its own undo story.
 */
export function useOrganisations() {
  const graph = useGraph()
  const { projections } = useKg()

  const all = projections.organisations(graph)

  const byId = useMemo(() => new Map(all.map((o) => [o.id, o])), [all])

  /**
   * The one resolver for a URL segment: the slug a link was built from, or a
   * NodeId out of a link built before slugs existed.
   *
   * The same shape `useApplications().get` has, and for the same reason — the
   * address bar carries a slug and the store is keyed by id, and exactly one
   * place should know how to cross that.
   */
  const get = useCallback(
    (key: string): Organisation | undefined => {
      const node = resolveAddress(graph, 'organisation', key)
      return node ? byId.get(node.id) : undefined
    },
    [graph, byId],
  )

  /**
   * The employer an application is at, found by name.
   *
   * By NAME because that is what the projection of an application carries —
   * `org` is the organisation's name, read across the `AT` edge — so a caller
   * holding an application can reach its employer without a second lookup into
   * the graph.
   */
  const byName = useCallback(
    (name: string): Organisation | undefined => all.find((o) => o.name === name),
    [all],
  )

  return useMemo(() => ({ all, byId, get, byName }), [all, byId, get, byName])
}
