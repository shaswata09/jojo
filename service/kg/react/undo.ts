/**
 * L4 — an Undo for a card that does not get one from its hook.
 *
 * The app's stated law is that every write carries `action: Undo`. Delete, stage
 * move, calendar move and snippet save honour it because the hooks behind them
 * hand back a `restore` — `remove` in `use-applications.ts`, and three more like
 * it. Four
 * writes did not: promoting a posting or a match to an application, saving the
 * profile, saving a note on a file, and creating an application. Each of those
 * hooks returns the record rather than the undo, and the six hook signatures are
 * frozen, so the toast had nothing to offer and quietly said nothing.
 *
 * The journal makes that gap unnecessary. Every write is a commit with
 * before-images (`repo/journal.ts`), so an Undo needs no hand-written closure and
 * no hook change — only the id of what was committed.
 *
 * Deliberately NOT `runtime.undo()`, which is the ⌘Z path. That one reverts
 * whatever is on top of the stack at the moment it fires, and a toast lives for
 * seconds while the user keeps working: pressing Undo on "Profile saved" after
 * ticking a reminder off would have reverted the tick. Reverting a NAMED entry
 * is what `result.undo` does for the hooks that have one, and it is what this
 * does for the ones that do not.
 *
 * This lived in `src/lib/undo.ts`, where only the four web cards could reach it.
 * `use-tool.ts` needs the same guard — it was written as the hook cards would
 * migrate to, and no card has: it still has zero call sites, so treat the
 * migration as intended rather than done — and `check-platform.mjs` bans
 * `kg/react -> @/lib` outright, correctly:
 * `src/lib` is the web app. Nothing below is web-only, so the module came down
 * rather than the ban being argued with, and `src/lib/undo.ts` re-exports it so
 * the four call sites kept their import line. Same move `kg/react/toast.ts`
 * made, for the same reason.
 */

import { useCallback } from 'react'
import type { StoredEdge, StoredNode } from '../core/model'
import type { GraphSnapshot } from '../core/snapshot'
import type { JournalEntry, RecordDelta } from '../repo/journal'
import type { Repository } from '../repo/repository'
import { useKg } from './kg-context'
import { useToast } from './toast'
import type { ToastOptions } from './toast'

/**
 * The three things this needs from the repository, and nothing else.
 *
 * Spelled out rather than taking the whole `Repository` so the rule below is
 * testable against a repo built from the memory driver without a React tree —
 * the suite runs in node on purpose (`environment: 'node'` in
 * `service/vitest.config.mts`, which is this package's only test config and the
 * one that runs this file), and a hook that hid its logic inside `useCallback`
 * would have been checkable only by clicking. The sentence here named web's
 * `vite.config.ts`; that file is in another workspace and stopped being the
 * config for this suite when the layer moved out of the app.
 *
 * `getSnapshot` is here because reverting an entry is only safe while the
 * records it touched still look the way it left them — see `movedOn`.
 */
export type UndoJournal = Pick<Repository, 'undoable' | 'revert' | 'getSnapshot'>

/**
 * What pressing Undo actually did.
 *
 * Returned rather than assumed, because "skipped" is a real outcome and a button
 * that silently declines to act is indistinguishable from a broken one. The
 * hook below turns a non-empty `superseded` into a toast; the counts are here so
 * the decision itself is assertable without a React tree.
 */
export type RestoreOutcome = {
  /** Entries put back. */
  reverted: number
  /**
   * Labels of the entries left alone because the user has written to those
   * records since. Reverting one applies a whole-record before-image (D12), so
   * it would have taken the newer writes with it.
   */
  superseded: readonly string[]
  /**
   * Entries that were no longer on the undo stack — already undone by ⌘Z or by
   * another card's Undo. Not announced: the act that took them off the stack was
   * itself a visible undo, so the record is already in the state the user asked
   * for.
   */
  alreadyUndone: number
}

export type Undoable<T> = {
  value: T
  /**
   * `null` when the action committed nothing.
   *
   * A write with nothing behind it is a real case — promoting a match that is
   * already an application returns the existing record without touching the
   * graph, and a tool declared `undoable: false` clears the stack as it commits
   * — and `repo.commit` deliberately keeps an empty entry off the undo stack so
   * one no-op does not eat the undo the user wanted. An Undo button that would
   * do nothing is a button claiming something untrue, so there is not one.
   *
   * This used to say "the profile page's Save is always enabled". That stopped
   * being true when the save bar moved behind `dirty` (`Profile.tsx`), so the
   * reason was documenting a button that can no longer be pressed with nothing
   * to save. The null case survived the button that motivated it.
   */
  restore: (() => RestoreOutcome) | null
}

/**
 * Deep value equality over the JSON-shaped half of a stored record.
 *
 * Reference equality would very nearly do — `MutableSnapshot.putNode` stores the
 * object it is handed, so an untouched record is still the very object the entry
 * captured. It is not used because the two failure modes are not symmetric: a
 * false "unchanged" costs one over-eager revert, while a false "changed" makes
 * Undo quietly stop working everywhere, and any future layer that clones a row
 * on the way in would cause exactly that.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false

  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameValue(item, b[i]))
  }

  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every((key) => key in right && sameValue(left[key], right[key]))
}

const stillTheImage = <T>(current: T | undefined, after: T | null): boolean =>
  after === null ? current === undefined : current !== undefined && sameValue(current, after)

/**
 * Whether the graph has moved on from what this entry left behind.
 *
 * The bug this exists for: the profile is one node, and the save bar, the match
 * terms and both switches all write it through `profile.set` — the chips and
 * switches on click, deliberately outside the save bar. So "Profile saved ·
 * Undo" could be pressed AFTER a switch had been flipped, and because a revert
 * applies `before` as a whole record (D12), the flip went with it and nothing
 * said so. Every caller here has that shape available to it the moment a second
 * mechanism writes the same record, so the check belongs to the family and not
 * to the profile page.
 */
function movedOn(snapshot: GraphSnapshot, entry: JournalEntry): boolean {
  const changed = <T extends StoredNode | StoredEdge>(
    deltas: readonly RecordDelta<T>[],
    read: (id: string) => T | undefined,
  ) => deltas.some((delta) => !stillTheImage(read(delta.id), delta.after))

  return (
    changed(entry.nodes, (id) => snapshot.node(id)) ||
    changed(entry.edges, (id) => snapshot.edge(id))
  )
}

/**
 * Runs `write` and hands back an Undo for everything it committed.
 *
 * Every entry, not just the last one: creating an application is three writes at
 * the UI level — the record, its keywords, and the deadline the form minted — so
 * a single-entry undo would have left a deadline on the calendar pointing at an
 * application that no longer existed. They are reverted newest first, which is
 * the order they have to come out in: the deadline's edge to the application
 * cannot outlive the application.
 *
 * Two entries are skipped rather than reverted.
 *
 * One that is no longer on the undo stack got there by being undone already — by
 * ⌘Z, or by another card's Undo — and `repo.revert` would have found it in the
 * audit ring and applied it a second time, undoing the undo.
 *
 * One whose records no longer look the way it left them belongs to a write the
 * user has since written over. `before` is a whole record, so putting it back
 * would silently discard everything typed after the toast appeared.
 *
 * Both checks are made per entry, inside the loop, against a snapshot read again
 * each time. Deciding up front would have declared the older half of a burst
 * superseded by the newer half of the same burst — application.create writes the
 * record, then its keywords, then the deadline — and undone only the last one.
 */
export function undoableWith<T>(journal: UndoJournal, write: () => T): Undoable<T> {
  // `undoable` reads newest first (`Ring.entries` in `kg/repo/journal.ts`), so
  // the head before the
  // write is the marker everything above it was committed after.
  const head = journal.undoable[0]?.id ?? null

  const value = write()

  const committed: JournalEntry[] = []
  for (const entry of journal.undoable) {
    if (entry.id === head) break
    committed.push(entry)
  }

  if (committed.length === 0) return { value, restore: null }

  return {
    value,
    restore: () => {
      let reverted = 0
      let alreadyUndone = 0
      const superseded: string[] = []

      for (const entry of committed) {
        if (!journal.undoable.some((e) => e.id === entry.id)) {
          alreadyUndone += 1
          continue
        }
        if (movedOn(journal.getSnapshot(), entry)) {
          superseded.push(entry.label)
          continue
        }
        journal.revert(entry.id)
        reverted += 1
      }

      return { reverted, superseded, alreadyUndone }
    },
  }
}

/**
 * What the user is told when an Undo declined to act.
 *
 * Saying nothing was the original bug's second half: the switch came back on and
 * the screen offered no account of it. The wording names the entry rather than
 * the record, because the entry's label is the same sentence the toast the user
 * just pressed was titled with — "Profile saved" — and that is what they think
 * they are undoing.
 */
export function supersededToast(outcome: RestoreOutcome): ToastOptions {
  return {
    title: outcome.reverted === 0 ? 'Nothing was undone' : 'Part of that was left as it is',
    description: `${outcome.superseded.join(', ')} — you have changed those records since, and undoing now would have taken those changes with it.`,
    tone: 'danger',
  }
}

/**
 * `undoableWith`, plus the sentence that makes a declined Undo honest.
 *
 * The toast is fired here rather than by the four cards, so that a card cannot
 * adopt the guard and forget to say anything. Written as a function over its two
 * collaborators rather than inside the hook below for the reason `UndoJournal`
 * gives: the rule is then assertable against a repo built from the memory driver
 * without a React tree, and "the Undo declined and told the user" is the half
 * most likely to be dropped by a refactor, because every test of the guard
 * itself still passes without it.
 */
export function undoableSaying<T>(
  journal: UndoJournal,
  toast: (options: ToastOptions) => void,
  write: () => T,
): Undoable<T> {
  const { value, restore } = undoableWith(journal, write)
  if (!restore) return { value, restore: null }

  return {
    value,
    restore: () => {
      const outcome = restore()
      if (outcome.superseded.length > 0) toast(supersededToast(outcome))
      return outcome
    },
  }
}

/** `undoableSaying`, bound to the repository this tree is mounted against. */
export function useUndoable(): <T>(write: () => T) => Undoable<T> {
  const { repo } = useKg()
  const { toast } = useToast()

  return useCallback(
    <T>(write: () => T): Undoable<T> => undoableSaying(repo, toast, write),
    [repo, toast],
  )
}
