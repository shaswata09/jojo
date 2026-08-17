/**
 * L4 — useTool(name): run the tool, fire the toast from `describe`, wire Undo.
 *
 * The optional `say` override exists for genuinely card-local knowledge — "hidden
 * while the keyword filter is on" (the save toast in `vault/LinksTool.tsx`) —
 * and should stay rare
 * enough that a second use reads as a smell.
 *
 * `useRun` is the same call WITHOUT the toast, and it is what the six
 * compatibility hooks use. Every card that exists today already fires its own
 * toast and wires its own Undo; routing those through `useTool` would have put
 * two toasts on screen for one click, one of them describing the operation in
 * words the card had deliberately not chosen.
 *
 * `useTool` HAS NO CALL SITES. This header used to end "as cards migrate to
 * `useTool` in Wave 3 they drop their own toast in the same commit" — Wave 3
 * shipped and none did, so the sentence was a TODO in prose, which is why the
 * repo's zero-TODO count never saw it. Recorded plainly instead, because the two
 * things it was cited as evidence for do not survive checking:
 *
 * - `ToolRunDialog.tsx` does not adopt this hook, it REFUSES it, by name: the
 *   dialog already renders the refusal in place with the user's input intact,
 *   and a toast would say the same thing a second time over the top.
 * - `kg/react/host.ts` mentioned it only inside a paragraph about a React Native
 *   adapter that had already been written elsewhere.
 *
 * It is kept anyway, and the reason is below on `useTool` itself: the Undo it
 * wires is not the obvious one, and the obvious one is a bug. Deleting the hook
 * deletes that finding with it.
 */

import { useCallback } from 'react'
import type { ToolResult } from '@/kg/tools/runtime'
import type { Announcement } from '@/kg/tools/tool'
import type { InputOf, OutputOf, ToolName } from '@/kg/tools'
import { useKg } from './kg-context'
import { useToast } from './toast'
import type { ToastOptions } from './toast'
import { useUndoable } from './undo'

export type Run<N extends ToolName> = (input: InputOf<N>) => ToolResult<OutputOf<N>>

/**
 * Runs a tool and says nothing.
 *
 * Returns the whole `ToolResult` rather than the output, because the compat
 * hooks need `undo` — that closure is what replaced the 42 hand-written undo
 * closures, and a helper that returned only the output would have forced each of
 * them back into existence.
 */
export function useRun(): <N extends ToolName>(
  name: N,
  input: InputOf<N>,
) => ToolResult<OutputOf<N>> {
  const { runtime } = useKg()
  return useCallback(
    <N extends ToolName>(name: N, input: InputOf<N>) => runtime.run(name, input),
    [runtime],
  )
}

/**
 * The toast a refusal produces.
 *
 * A refusal is something the user can act on — a blank employer, a keyword name
 * already taken — so it is shown in the tool's own words. Anything that is not a
 * refusal never reaches here: the runtime re-throws it to the ErrorBoundary,
 * because a bug that arrives as a polite toast is a bug that ships.
 */
const refusal = (message: string): ToastOptions => ({
  title: 'That did not save',
  description: message,
  tone: 'danger',
})

const announced = (a: Announcement, undo: (() => void) | null): ToastOptions => ({
  title: a.title,
  ...(a.description === undefined ? {} : { description: a.description }),
  ...(a.tone === undefined ? {} : { tone: a.tone }),
  ...(undo === null ? {} : { action: { label: 'Undo', onClick: undo } }),
})

/**
 * The Undo is `undoableWith`'s, not `result.undo`.
 *
 * `result.undo` is `() => void repo.revert(journalId)` with no guard on it, and
 * a toast is precisely where an unguarded revert bites: it lives for eight
 * seconds while the user keeps working. Pressed after ⌘Z had already undone the
 * same entry, `repo.revert` finds it in the audit ring and applies it a second
 * time, which UNDOES the undo; pressed after the user has written to the same
 * record again, it puts a whole before-image back over what they typed (D12).
 * The first card to adopt this hook would have inherited both, which is why it
 * was worth fixing a hook with no call sites rather than deleting it: `undo` on
 * a `ToolResult` is the single most copyable line in the tools API, every
 * hand-written toast in the app is one paste away from using it, and this is
 * where the reason not to is written down.
 *
 * `undoableWith` also covers a burst: a tool that calls other tools still lands
 * one entry, but a card that runs two in one handler gets both undone in the
 * right order.
 */
export function useTool<N extends ToolName>(
  name: N,
): (input: InputOf<N>, say?: (a: Announcement) => Announcement) => ToolResult<OutputOf<N>> {
  const { runtime } = useKg()
  const { toast } = useToast()
  const undoable = useUndoable()

  return useCallback(
    (input: InputOf<N>, say?: (a: Announcement) => Announcement) => {
      // The run is inside `undoable` so the entries it committed are read off
      // the undo ring by the same rule every hand-written toast in the app uses.
      // A refusal commits nothing, so `restore` comes back null on its own — and
      // so does a tool declared `undoable: false`, which clears the stack as it
      // commits.
      const { value: result, restore } = undoable(() => runtime.run(name, input))
      if (!result.ok) {
        toast(refusal(result.errors[0]?.message ?? 'Something about that record did not fit.'))
        return result
      }
      toast(announced(say ? say(result.announcement) : result.announcement, restore))
      return result
    },
    [runtime, toast, name, undoable],
  )
}
