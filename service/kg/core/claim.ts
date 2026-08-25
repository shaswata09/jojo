/**
 * One relation between two things, and whether the graph already holds it. L1.
 *
 * ## Why a claim is a node and not an edge
 *
 * The edge model cannot carry this. `EdgeId` is `${from}|${rel}|${to}` and the
 * index is keyed by `Rel`, so the relation name is part of an edge's identity
 * and the set of names is closed — seven, describing the app's own structure.
 * An open predicate in that slot would change the id format, the parser, the
 * index and the validator, and would still allow only one relation per pair.
 *
 * Reifying it — the triple becomes a record with edges to its two ends — costs
 * a hop on traversal and buys three things the requirement needs: any number of
 * predicates, any number of relations between one pair, and somewhere to put
 * what the model actually said and which document it said it from.
 *
 * ## The duplicate rule, which is the whole point
 *
 * "Do not add this if the graph already knows it" cannot be answered by
 * searching for the words. `built` and `developed` are the same relation and
 * share no letters; `A employed_by B` and `B employs A` are the same fact
 * written backwards. Keyword search finds neither.
 *
 * So the comparison happens after canonicalising, and on ids rather than text:
 *
 *   - same predicate, same ends            -> the same claim
 *   - inverse predicate, ends swapped      -> the same claim
 *   - symmetric predicate, ends swapped    -> the same claim
 *   - open predicate, same normalised form -> the same claim
 *
 * Everything else is a new claim, including two claims that a human would call
 * near-duplicates. This layer will not guess: `LED` and `BUILT` are different
 * relations, and merging them because one CV used both about one project would
 * lose the distinction the person drew.
 *
 * ## What it deliberately does not do
 *
 * Resolve the ends. `subject` and `object` arrive as node ids and are compared
 * as node ids. Deciding that "Cloudflare" and "Cloudflare, Inc." are one
 * organisation is a different problem with a different failure mode — it merges
 * records rather than declining to add one — and it belongs to whatever mints
 * the node, not here.
 */

import { canonicalise, normalise, specOf } from './ontology'
import type { Predicate } from './ontology'

/** A relation, with both ends already resolved to records. */
export type Claim = {
  readonly subject: string
  /** Canonical id, or the normalised surface form when open. */
  readonly predicate: string
  readonly object: string
}

/**
 * The two orderings a claim can be stored in, as comparable keys.
 *
 * A pair rather than one key, because equivalence is not a property of a claim
 * on its own: it depends on whether the predicate has an inverse or is
 * symmetric. Producing both keys up front turns the comparison into a set
 * lookup, which is what lets a caller check a proposal against a thousand
 * stored claims without walking them.
 */
export function keysOf(claim: Claim): readonly string[] {
  const forward = `${claim.subject}|${claim.predicate}|${claim.object}`
  const spec = specOf(claim.predicate)

  if (spec?.symmetric === true) {
    // Same fact read either way, so the reversed key is the same key. Sorted so
    // both orderings produce one identical string rather than two that have to
    // be compared against each other.
    const [a, b] = [claim.subject, claim.object].sort()
    return [`${a ?? ''}|${claim.predicate}|${b ?? ''}`]
  }

  if (spec?.inverse !== undefined) {
    return [forward, `${claim.object}|${spec.inverse}|${claim.subject}`]
  }

  return [forward]
}

/**
 * Whether two claims say the same thing.
 *
 * Written in terms of `keysOf` rather than beside it, so there is one
 * definition of equivalence and the fast path and the readable path cannot
 * disagree about what a duplicate is.
 */
export function sameClaim(a: Claim, b: Claim): boolean {
  const mine = new Set(keysOf(a))
  return keysOf(b).some((key) => mine.has(key))
}

/** What `checkClaim` decided about a proposal. */
export type ClaimCheck =
  | {
      readonly verdict: 'new'
      readonly claim: Claim
      readonly predicate: Predicate
    }
  | {
      readonly verdict: 'known'
      readonly claim: Claim
      readonly predicate: Predicate
      /** The claim already stored that says this, in whatever words it used. */
      readonly existing: Claim
      /** For the refusal, in the words a person would use. */
      readonly why: string
    }
  | {
      readonly verdict: 'invalid'
      readonly why: string
    }

/**
 * An index of what is already known, for checking proposals against.
 *
 * Built once per batch rather than per proposal: a CV yields thirty relations
 * and rebuilding the set thirty times is the difference between one pass over
 * the store and thirty.
 */
export type ClaimIndex = ReadonlyMap<string, Claim>

export function indexClaims(claims: readonly Claim[]): ClaimIndex {
  const out = new Map<string, Claim>()
  for (const claim of claims) {
    // First writer wins. Two stored claims that are equivalent should not
    // exist, and if they do the older one is the one to report.
    for (const key of keysOf(claim)) if (!out.has(key)) out.set(key, claim)
  }
  return out
}

/**
 * Whether to add this relation, having canonicalised what it was called.
 *
 * The gate every proposal goes through. It refuses three things and adds
 * everything else:
 *
 *   - a relation to or from nothing, or a record to itself
 *   - an empty predicate
 *   - a fact the graph already holds, under any name it holds it by
 */
export function checkClaim(
  proposed: { subject: string; predicate: string; object: string },
  known: ClaimIndex,
): ClaimCheck {
  const subject = proposed.subject.trim()
  const object = proposed.object.trim()

  if (subject === '' || object === '') {
    return { verdict: 'invalid', why: 'A relation needs a record at both ends.' }
  }
  if (subject === object) {
    /*
     * Refused rather than stored. A record related to itself is almost always
     * a model resolving two mentions of different things to one id, and the
     * resulting claim is unfalsifiable — "Aurelia is part of Aurelia" cannot be
     * checked against the document because the document does not say it.
     */
    return { verdict: 'invalid', why: 'A record cannot be related to itself.' }
  }

  const predicate = canonicalise(proposed.predicate)
  if (predicate.id === '') {
    return { verdict: 'invalid', why: 'A relation needs a name.' }
  }

  const claim: Claim = { subject, predicate: predicate.id, object }

  for (const key of keysOf(claim)) {
    const existing = known.get(key)
    if (existing === undefined) continue
    return {
      verdict: 'known',
      claim,
      predicate,
      existing,
      /*
       * Compared against what the caller SAID, not against what it
       * canonicalised to — those are equal by this point, which is the whole
       * reason the duplicate was found.
       *
       * Somebody who proposed "developed", searched for it, found nothing and
       * was then refused needs to be told the graph holds it as "BUILT".
       * Without that the refusal looks like a bug, and the obvious next move is
       * to add it again under a third name.
       */
      why:
        normalise(predicate.surface) === normalise(existing.predicate)
          ? 'The graph already holds this relation.'
          : `The graph already holds this, stored as “${existing.predicate}”.`,
    }
  }

  return { verdict: 'new', claim, predicate }
}
