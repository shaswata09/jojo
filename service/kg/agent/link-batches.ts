/**
 * L3 — every pair of records, offered to a model in batches it can answer.
 *
 * ## The problem this replaces
 *
 * The CV reader asked for relations ONCE, with every entry in a single request:
 * `relationMessages(name, markdown, background)` over thirty facts, wrapped in
 * a `catch {}` described in its own comment as "deliberately silent". A thirty-
 * entry request is exactly the shape that hits a model's output limit — the
 * same failure that truncated `profile.background.add` mid-array — and a
 * truncated reply parses to few relations or none. Silently. Reported as: the
 * graph is a collection of nodes with no edges at all.
 *
 * One call also cannot be exhaustive. A model shown thirty numbered facts and
 * asked "which of these connect" answers with the handful it noticed, not with
 * a decision about each of the 435 pairs.
 *
 * ## The scheme, and why it is provably complete
 *
 * Split the records into chunks of `size`. Offer every UNORDERED PAIR OF CHUNKS
 * as one batch, including each chunk with itself.
 *
 *   - two records in the same chunk `i` meet in batch `(i, i)`
 *   - two records in chunks `i` and `j` meet in batch `(i, j)`
 *
 * There is no third case, so every one of the nC2 pairs is put in front of the
 * model at least once. `coversEveryPair` in the test asserts exactly that
 * against the enumeration, rather than trusting this paragraph.
 *
 * The cost is `g(g+1)/2` calls for `g = ceil(n / size)` chunks — ten calls for
 * thirty records at the default size, against one that answered incompletely.
 * That is the trade being made deliberately: this runs once per CV import, and
 * a graph without edges is not a graph.
 */

/** Records per chunk. Two chunks are shown at once, so a batch is up to twice this. */
export const LINK_CHUNK = 6

/**
 * Chunks paired with each other, every unordered pair including self-pairs.
 *
 * Returns the batches as lists of the ORIGINAL items, in input order within a
 * batch, so a caller can number them for the model and read the numbers back.
 */
export function pairBatches<T>(items: readonly T[], size = LINK_CHUNK): readonly (readonly T[])[] {
  if (size < 1) return items.length > 1 ? [items] : []
  // Nothing to relate: a single record has no pair, and zero has none either.
  if (items.length < 2) return []

  const chunks: T[][] = []
  for (let at = 0; at < items.length; at += size) chunks.push(items.slice(at, at + size))

  const batches: (readonly T[])[] = []
  for (let i = 0; i < chunks.length; i += 1) {
    for (let j = i; j < chunks.length; j += 1) {
      const batch = i === j ? chunks[i]! : [...chunks[i]!, ...chunks[j]!]
      // A self-paired chunk of one holds no pair, so it is not worth a call.
      if (batch.length > 1) batches.push(batch)
    }
  }
  return batches
}

/** How many model calls `pairBatches` will cost, without building them. */
export function batchCount(total: number, size = LINK_CHUNK): number {
  if (total < 2 || size < 1) return 0
  const g = Math.ceil(total / size)
  const selfPairs = total % size === 1 && g > 1 ? g - 1 : g
  return (g * (g - 1)) / 2 + selfPairs
}

/** Every unordered pair of indices, for asserting completeness. */
export function everyPair(total: number): readonly (readonly [number, number])[] {
  const out: [number, number][] = []
  for (let a = 0; a < total; a += 1) for (let b = a + 1; b < total; b += 1) out.push([a, b])
  return out
}
