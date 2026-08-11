/**
 * An Undo for a card that does not get one from its hook.
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
 */

import { useCallback } from 'react'
import { useKg } from '@/kg/react/kg-context'
import type { Repository } from '@/kg/repo/repository'

/**
 * The two things this needs from the repository, and nothing else.
 *
 * Spelled out rather than taking the whole `Repository` so the rule below is
 * testable against a repo built from the memory driver without a React tree —
 * `vitest.config.ts` runs in node on purpose, and a hook that hid its logic
 * inside `useCallback` would have been checkable only by clicking.
 */
export type UndoJournal = Pick<Repository, 'undoable' | 'revert'>

export type Undoable<T> = {
  value: T
  /**
   * `null` when the action committed nothing.
   *
   * A save with no edits behind it is a real case — the profile page's Save is
   * always enabled — and `repo.commit` deliberately keeps an empty entry off the
   * undo stack so one no-op does not eat the undo the user wanted. An Undo button
   * that would do nothing is a button claiming something untrue, so there is not
   * one.
   */
  restore: (() => void) | null
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
 * An entry that is no longer on the undo stack when the button is pressed is
 * skipped rather than reverted. It got there by being undone already — by ⌘Z, or
 * by another card's Undo — and `repo.revert` would have found it in the audit
 * ring and applied it a second time, undoing the undo.
 */
export function undoableWith<T>(journal: UndoJournal, write: () => T): Undoable<T> {
  // `undoable` reads newest first (`Ring.entries` in `kg/repo/journal.ts`), so
  // the head before the
  // write is the marker everything above it was committed after.
  const head = journal.undoable[0]?.id ?? null

  const value = write()

  const committed: string[] = []
  for (const entry of journal.undoable) {
    if (entry.id === head) break
    committed.push(entry.id)
  }

  if (committed.length === 0) return { value, restore: null }

  return {
    value,
    restore: () => {
      for (const id of committed) {
        if (journal.undoable.some((e) => e.id === id)) journal.revert(id)
      }
    },
  }
}

/** `undoableWith`, bound to the repository this tree is mounted against. */
export function useUndoable(): <T>(write: () => T) => Undoable<T> {
  const { repo } = useKg()
  return useCallback(<T>(write: () => T) => undoableWith(repo, write), [repo])
}
