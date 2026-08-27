/**
 * L3 — the linking pass: every pair of records put to a model, in batches.
 *
 * ## Why this is its own agent call and not part of reading the CV
 *
 * Extraction and linking are different questions. "What facts are in this
 * document" is answered by reading it; "does fact 4 evidence fact 19" is
 * answered by comparing two things, and a model asked both at once does the
 * first well and the second barely.
 *
 * The reader used to ask for relations ONCE, with all thirty entries in a
 * single request, inside a `catch {}` its own comment called "deliberately
 * silent". Thirty entries is the shape that hits a model's output limit, a
 * truncated reply parses to nothing, and nothing said so — which is how a
 * knowledge graph ends up a collection of nodes with no edges at all.
 *
 * ## What this does instead
 *
 * `pairBatches` splits the records so that EVERY unordered pair meets in at
 * least one batch, and each batch is small enough to answer completely. Each
 * batch is one model call asking only about the records in front of it. The
 * batch-local numbers the model answers with are mapped back to their original
 * positions here, because a model that has been shown six facts should be
 * answering about six, not about the thirty it cannot see.
 *
 * Failures are COUNTED, not swallowed. A caller that gets `asked: 10, failed: 9`
 * knows the graph is thin because the model kept refusing, which is the fact
 * the silent version withheld.
 */

import type { Cancellation } from './flow'
import type { ChatMessage, Turn } from '../core/model-server'
import type { BackgroundDraft, RelationDraft } from './read-cv'
import { readRelations, relationMessages } from './read-cv'
import { LINK_CHUNK, pairBatches } from './link-batches'

export type LinkDeps = {
  /**
   * The linking model call — its own, like the chooser's.
   *
   * Comparing two facts is an easier task than extracting them, so an app may
   * point this at a smaller model without losing anything.
   */
  readonly ask: (messages: readonly ChatMessage[]) => Promise<Turn>
}

export type LinkResult = {
  /** Deduplicated, with indices into the ORIGINAL entry list. */
  readonly relations: readonly RelationDraft[]
  /** How many batches were put to the model. */
  readonly asked: number
  /** How many of those did not come back usable. `asked` minus this succeeded. */
  readonly failed: number
}

export type LinkOptions = {
  /** Records per chunk; a batch is up to twice this. */
  readonly size?: number
  readonly signal?: Cancellation
  /** Called after each batch, for a progress line. */
  readonly onBatch?: (done: number, total: number) => void
}

/** `subject|predicate|object`, so the same edge found in two batches lands once. */
const keyOf = (r: RelationDraft): string =>
  `${String(r.subject)}|${r.predicate.trim().toLowerCase()}|${String(r.object)}`

/**
 * Every pair of entries, asked about and collected.
 *
 * Never throws: a batch that fails is counted and the rest continue, because
 * nine batches of edges are worth more than none. Cancellation stops between
 * batches rather than mid-call — the request in flight is already paid for.
 */
export async function linkProfile(
  { ask }: LinkDeps,
  name: string,
  markdown: string,
  entries: readonly BackgroundDraft[],
  options: LinkOptions = {},
): Promise<LinkResult> {
  // Numbered before batching, so a batch-local answer can be mapped back.
  const numbered = entries.map((entry, index) => ({ entry, index }))
  const batches = pairBatches(numbered, options.size ?? LINK_CHUNK)

  const found = new Map<string, RelationDraft>()
  let asked = 0
  let failed = 0

  for (const batch of batches) {
    if (options.signal?.aborted === true) break
    asked += 1

    let reply: Turn
    try {
      reply = await ask(relationMessages(name, markdown, batch.map((b) => b.entry)))
    } catch {
      // A throw is a failed batch and nothing more. See the header.
      failed += 1
      options.onBatch?.(asked, batches.length)
      continue
    }

    if (!reply.ok || reply.text === null || reply.text.trim() === '') {
      failed += 1
      options.onBatch?.(asked, batches.length)
      continue
    }

    /*
     * `batch.length`, not `entries.length`. `readRelations` drops any index
     * outside the list it was given, which is what stops a model that has lost
     * track from pointing at a record it was never shown — and passing the full
     * count here would disable exactly that check.
     */
    const local = readRelations(reply.text, batch.length)
    if (local.length === 0 && reply.text.length < 4) failed += 1

    for (const relation of local) {
      const subject = batch[relation.subject]?.index
      const object = batch[relation.object]?.index
      // Defensive: `readRelations` already bounds these, so a miss here would
      // mean the batch and the count disagreed.
      if (subject === undefined || object === undefined || subject === object) continue
      const mapped: RelationDraft = { subject, predicate: relation.predicate, object }
      const key = keyOf(mapped)
      if (!found.has(key)) found.set(key, mapped)
    }

    options.onBatch?.(asked, batches.length)
  }

  return { relations: [...found.values()], asked, failed }
}
