/**
 * The shape every read has, what a read may reach besides the graph, and the
 * identity function that checks a read against both.
 *
 * Split out of `queries.ts`, which still assembles `READS` and re-exports these
 * so existing imports keep working.
 */

import type { ISODate, NodeId } from '../../core/model'
import type { BoardScan } from '../../core/board'
import type { Schema } from '../../core/schema'
import type { GraphSnapshot } from '../../core/snapshot'
import type { Cancellation } from '../loop'

/**
 * A read, in the same shape the catalog can hand to a model.
 *
 * `effect: 'read'` is not one of `Tool`'s five effects and is not meant to be:
 * the write tools' effect drives undo and the journal, and a read has neither.
 * It is here so the catalog can mark these as safe without a second lookup, and
 * so a UI can show them differently from a mutation.
 */
export type ReadTool<I = unknown> = {
  readonly name: string
  readonly title: string
  readonly summary: string
  readonly effect: 'read'
  readonly input: Schema<I>
  /**
   * May be async, unlike a write.
   *
   * The asymmetry is the point rather than an inconsistency. `tool.ts` forbids
   * `await` inside a write and explains why: an await on anything that is not
   * the transaction's own request ends the turn, the transaction auto-commits,
   * and the next call throws after some of the writes have landed. A read opens
   * no transaction, so none of that applies — and one read genuinely has to go
   * out to the network, because reading a PDF means asking MarkItDown.
   */
  readonly read: (
    memory: GraphSnapshot,
    input: I,
    ctx: ReadContext,
  ) => unknown | Promise<unknown>
}

/**
 * What a read may reach besides the graph.
 *
 * One optional function today, and it is optional because the thing behind it is
 * something the user chooses to run. A read that needs it and does not have it
 * says so; it does not fail.
 */
export type ReadContext = {
  /**
   * A job board's search page, as rows. Absent when nothing can reach one.
   *
   * Injected for the same reason `convert` is, plus one more: reading a board
   * means running the page's own JavaScript, and a portable layer has no DOM to
   * run it in. See `ToolHost.scan`.
   */
  readonly scan?: BoardScan
  /**
   * A stored document, as Markdown. Absent when no reader is configured.
   *
   * Supplied by the app, because getting the bytes and sending them are both
   * platform work: `check-platform` bans the network from this layer, and the
   * bytes live in IndexedDB on the web and on the filesystem on a phone.
   */
  convert?: (
    fileId: NodeId,
    signal?: Cancellation,
  ) => Promise<{ ok: true; markdown: string } | { ok: false; reason: string }>
  /**
   * The boards this run may open, as absolute URLs the PERSON typed.
   *
   * Absent means none. See `ToolHost.boards` for why the model's own choice of
   * address cannot be trusted here, and `boardSearch` for the comparison.
   */
  readonly boards?: readonly string[]
  /**
   * The run's Stop. A board crawl follows up to ten pages and a conversion is
   * a round trip, and a read that ignored Stop kept opening tabs in the
   * person's browser after the UI said it had stopped. Checked between pages,
   * and handed to `convert` so the app can cancel its request.
   */
  readonly signal?: Cancellation
  /**
   * The calendar day the user is standing in.
   *
   * Required rather than optional, unlike everything above it: `scan` and
   * `convert` stand for capabilities a person chooses to install, and a read
   * without them says so. There is no such thing as running without a date, and
   * a read that guessed one would report a follow-up overdue on the strength of
   * a guess.
   */
  readonly today: ISODate
}

export const defineRead = <I>(t: ReadTool<I>): ReadTool<I> => t
