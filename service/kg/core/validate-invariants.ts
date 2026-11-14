/**
 * The integrity check every boot runs over a store that already validated.
 */

import type { StoredEdge, StoredNode } from './model'
import { EDGE_SCHEMA } from './model'
import type { Diagnostic } from './validate-diagnostic'
import { diagnostic } from './validate-diagnostic'

/* ------------------------------- invariants ------------------------------- */

/**
 * The integrity check R-2 asks for. Every boot, every build, no flag.
 *
 * It answers the question a UUID migration makes urgent and nothing else can:
 * did the seed compiler resolve every slug reference, or did it write an edge
 * to an id that was never minted? R-2 called for a dev-only check and this
 * comment used to describe one; all three boot paths — the seeded first run,
 * the in-memory session and `boot-ready`'s hydrate — call it unconditionally,
 * and the result reaches the user as `Session.problems` in Settings'
 * Diagnostics. That is the right shape at this scale and worth stating plainly:
 * a check that only ran in development would be a check that never saw the
 * store the report is about.
 *
 * Kept separate from `validateRows` because a violation here is a bug in jojo,
 * not a corrupt store, and the two want different recoveries: nothing is
 * dropped, nothing is skipped, and the app starts either way.
 */
export function checkInvariants(
  nodes: readonly StoredNode[],
  edges: readonly StoredEdge[],
): Diagnostic[] {
  const problems: Diagnostic[] = []
  const byId = new Map(nodes.map((n) => [n.id, n]))

  const slugs = new Set<string>()
  for (const node of nodes) {
    // Narrowed on the discriminant here rather than through a `hasSlug(type)`
    // predicate: a guard over the type STRING narrows the string and tells the
    // compiler nothing about `node.props`, so `props.slug` two lines down would
    // still be an error on the profile branch. See `SluggedType` in `model.ts`,
    // where that helper was written, never called, and removed.
    if (node.type === 'profile') continue

    const key = `${node.type}\0${node.props.slug}`
    if (slugs.has(key)) {
      const message = `Two ${node.type} records share '${node.props.slug}'.`
      problems.push(diagnostic('nodes', node.id, message))
    }
    slugs.add(key)
  }

  const singles = new Set<string>()
  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) {
      problems.push(diagnostic('edges', edge.id, 'Joins a record that is not there.'))
      continue
    }
    if (EDGE_SCHEMA[edge.rel].fromCardinality !== 'one') continue

    const key = `${edge.from}\0${edge.rel}`
    if (singles.has(key)) {
      problems.push(
        diagnostic('edges', edge.id, `${edge.rel} allows one target and this record has two.`),
      )
    }
    singles.add(key)
  }

  return problems
}
