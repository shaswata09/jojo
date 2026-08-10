/**
 * L4 — useTool(name): run the tool, fire the toast from `describe`, wire Undo.
 *
 * The optional `say` override exists for genuinely card-local knowledge — "hidden
 * while the keyword filter is on" (LinksTool.tsx:419-425) — and should stay rare
 * enough that a second use reads as a smell.
 *
 * `useRun` is the same call WITHOUT the toast, and it is what the six
 * compatibility hooks use. Every card that exists today already fires its own
 * toast and wires its own Undo; routing those through `useTool` would have put
 * two toasts on screen for one click, one of them describing the operation in
 * words the card had deliberately not chosen. As cards migrate to `useTool` in
 * Wave 3 they drop their own toast in the same commit.
 */

import { useCallback } from 'react'
import type { ToolResult } from '@/kg/tools/runtime'
import type { Announcement } from '@/kg/tools/tool'
import type { InputOf, OutputOf, ToolName } from '@/kg/tools'
import { useKg } from './kg-context'
import { useToast } from './toast'
import type { ToastOptions } from './toast'

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

export function useTool<N extends ToolName>(
  name: N,
): (input: InputOf<N>, say?: (a: Announcement) => Announcement) => ToolResult<OutputOf<N>> {
  const { runtime } = useKg()
  const { toast } = useToast()

  return useCallback(
    (input: InputOf<N>, say?: (a: Announcement) => Announcement) => {
      const result = runtime.run(name, input)
      if (!result.ok) {
        toast(refusal(result.errors[0]?.message ?? 'Something about that record did not fit.'))
        return result
      }
      toast(announced(say ? say(result.announcement) : result.announcement, result.undo))
      return result
    },
    [runtime, toast, name],
  )
}
