/**
 * L3 — Tool, ToolContext, ToolResult, Tx, defineTool.
 *
 * A tool is a named, schema-validated memory operation defined OUTSIDE React and
 * run synchronously inside one transaction. A card binds to a tool; a card is
 * never where a tool lives, or the registry would import React and no operation
 * could be tested or replayed without mounting a tree.
 *
 * The undo contract: one user action is one commit, one journal row and one undo.
 * Nested `ctx.call` joins the caller's transaction — no second commit, no
 * second toast.
 *
 * The no-`TODAY` rule: no module under `src/kg` reads a clock, and none may
 * import one either. Time enters through `ctx.now` (D26), and the calendar day
 * comes out of that instant with `dayOf` — never `.slice(0, 10)`, which is the
 * UTC day and files an evening in Austin under tomorrow.
 *
 * The constant this rule was named after is now called `SEED_TODAY`, and the
 * rename is the argument: it was `TODAY = '2026-10-12'`, the app imported it as
 * today, and a completion stamped 2026-10-12 in 2027 is a lie the user reads on
 * the card. It is a fact about when the fixtures were WRITTEN — `repo/seed.ts`
 * is its one caller, and it uses it to shift the demo dates onto the real
 * calendar. A tool has no business knowing it exists. Injecting the clock also
 * makes every time-dependent tool test deterministic for free, which is why
 * `tools.test.ts` can assert an exact `completedOn`.
 *
 * No `toggle` verb: by the time an undo fires, the item may have been unticked
 * elsewhere, and toggling again would re-tick it. `complete` and `reopen` are
 * two tools.
 */

import type {
  EdgeId,
  Instant,
  NodeId,
  NodePropsByType,
  NodeType,
  Props,
  Rel,
  StoredNode,
} from '@/kg/core/model'
import type { KgErrorCode } from '@/kg/core/result'
import type { Schema } from '@/kg/core/schema'
import type { GraphSnapshot } from '@/kg/core/snapshot'
import type { InputOf, OutputOf, ToolName } from './index'

/** What the toast says. Plain sentences — no ids, no jargon, no field names. */
export type Announcement = { title: string; description?: string; tone?: 'default' | 'danger' }

export type Availability = { ok: true } | { ok: false; reason: string }

export type ToolError = { message: string; field?: string; code?: KgErrorCode }

/**
 * A patch that can also CLEAR a field.
 *
 * `Partial<T>` under `exactOptionalPropertyTypes` cannot carry an explicit
 * `undefined`, so there was no way to spell "drop the offer" — `duplicate` has
 * to clear five optional fields at once. The key is deleted rather than written
 * as `undefined`, which is the bug D21 names: a stored `{ offer: undefined }`
 * survives a round trip through IndexedDB as a present key and then passes an
 * `in` check that every read path uses to mean "this application has an offer".
 */
export type PropsPatch<T extends NodeType> = {
  [K in keyof NodePropsByType[T]]?: NodePropsByType[T][K] | undefined
}

/**
 * The only handle on memory a tool is given.
 *
 * Every mutator returns either nothing or the record it wrote — never a promise
 * and never a transaction handle. R-3 is the reason: an `await` on anything that
 * is not this transaction's own IDB request ends the turn, the transaction
 * auto-commits, and the next call throws `TransactionInactiveError` after some
 * of the writes have already landed. A synchronous surface makes that
 * unrepresentable rather than merely discouraged.
 */
export type Tx = {
  put<T extends NodeType>(node: StoredNode<T>): StoredNode<T>
  patch<T extends NodeType>(id: NodeId, patch: PropsPatch<T>): StoredNode<T>
  /**
   * Drops the node and every edge with it as an end.
   *
   * The edges go because an edge whose endpoint is missing is corrupt — the
   * boot integrity check (R-2) rejects the whole graph over one of them. The
   * records at the other end are untouched: that is D15, and it is what the
   * removed `store-context.ts` said in graph.
   */
  del(id: NodeId): void
  link(from: NodeId, rel: Rel, to: NodeId, props?: Props): EdgeId
  unlink(from: NodeId, rel: Rel, to: NodeId): void
  /** Drops every edge with this end, in either direction. */
  unlinkAll(id: NodeId, opts?: { rel?: Rel }): void
}

export type ToolContext = {
  /** The snapshot at transaction start, PLUS this transaction's writes so far. */
  readonly memory: GraphSnapshot
  readonly tx: Tx
  /** Runs another tool inside THIS transaction. No new commit, no second toast. */
  call<N extends ToolName>(name: N, input: InputOf<N>): OutputOf<N>
  /** The one sanctioned throw inside a tool. Returns `never`, so it narrows. */
  fail(message: string, opts?: { field?: string; code?: KgErrorCode }): never
  /** `memory.node` + `fail`, with a message that reads the same everywhere. */
  require<T extends NodeType>(type: T, id: NodeId): StoredNode<T>
  /**
   * Unique against stored nodes AND nodes this transaction has already created.
   *
   * The second half is the one that was missing: two files dropped in one
   * gesture both minted their slug from a store read that predated either of
   * them, took the same id, and from then on were one row with one keyword set
   * that one delete took out together. `sortDrop` in
   * `components/vault/files/intake.ts` used to predict the slug this mints, to
   * dedupe a drop before it arrived — a second copy of `slugify` on the far side
   * of a layer boundary, kept in step by nothing. It dedupes on the folded name
   * now, and this overlay is what made the prediction unnecessary.
   */
  mintSlug(type: NodeType, base: string): string
  newId(type: NodeType): NodeId
  /** Injected. No module in `src/kg` reads a clock or names the fixtures' day. */
  readonly now: Instant
}

export type Tool<I, O = void> = {
  /**
   * Typed `string`, not `ToolName`.
   *
   * `ToolName` is `keyof typeof TOOLS`, and TOOLS' own type would then depend on
   * the tools' `name` fields depending on TOOLS — TypeScript reports that as
   * "circularly references itself" and quietly gives every tool the type `any`,
   * which takes `InputOf` and `OutputOf` down with it. The registry key is the
   * authority instead, and `tools/index.ts` asserts at module load that each
   * tool answers to the key it is filed under.
   */
  readonly name: string
  /** 'Add application' — menus, the palette, the undo label. */
  readonly title: string
  /** One line; the palette, the inspector, and one day a manifest. */
  readonly summary: string
  readonly effect: 'create' | 'update' | 'delete' | 'move' | 'admin'
  readonly touches: readonly NodeType[]
  /** Hidden from the palette and the inspector: `org.ensure` and friends. */
  readonly internal?: boolean
  /**
   * Excluded from the journal.
   *
   * The admin tools already go through a confirmation dialog rather than an undo
   * toast (`pendingCopy` in `components/settings/data-confirm-copy.tsx`);
   * journalling them would both break that
   * contract and write a single entry holding every record in the store.
   */
  readonly undoable?: false
  readonly input: Schema<I>
  readonly available?: (m: GraphSnapshot, input?: Partial<I>) => Availability
  readonly run: (ctx: ToolContext, input: I) => O
  readonly describe: (input: I, output: O, m: GraphSnapshot) => Announcement
}

/** Any tool, for the registry and for `forNode`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = Tool<any, any>

/**
 * Identity at the value level, a checkpoint at the type level.
 *
 * Without it each tool literal would be checked against `Tool<I, O>` only at the
 * point it entered the registry, so a `run` whose input did not match its own
 * schema was reported as an error on the registry object — one error naming
 * fifty-eight tools, pointing at the wrong file.
 */
export function defineTool<I, O>(t: Tool<I, O>): Tool<I, O> {
  return t
}

/**
 * The one exception a tool is allowed to throw, via `ctx.fail`.
 *
 * The runtime catches this and only this. Anything else is a programmer error
 * and is re-thrown to the ErrorBoundary: laundering a `TypeError` into a toast
 * reading "Something went wrong" is how a bug survives a release.
 */
export class ToolFailure extends Error {
  readonly errors: readonly ToolError[]

  constructor(errors: readonly ToolError[]) {
    super(errors[0]?.message ?? 'The tool refused to run')
    this.name = 'ToolFailure'
    this.errors = errors
  }
}

export const isToolFailure = (e: unknown): e is ToolFailure => e instanceof ToolFailure
