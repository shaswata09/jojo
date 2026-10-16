import { useCallback, useMemo } from 'react'
import type { LabelTone, NodeId } from '../core/model'
import { useGraph, useKg } from './kg-context'
import { useRun, useTool } from './use-tool'

/**
 * L4 — the dashboard's sticky notes, for a screen.
 *
 * Writing and editing are quiet: a toast saying "Note saved" after every
 * sticky someone types is noise on a board whose whole point is being quick,
 * and ⌘Z still takes either back. Removing one is announced, with an Undo,
 * because the note leaves the screen and the toast is the only way back to it.
 */
export function useStickyNotes() {
  const graph = useGraph()
  const { projections } = useKg()
  const run = useRun()
  const removeTool = useTool('sticky.note.delete')

  const notes = useMemo(() => projections.stickyNotes(graph), [projections, graph])

  const create = useCallback(
    (text: string, tone?: LabelTone) => {
      const result = run('sticky.note.create', { text, ...(tone === undefined ? {} : { tone }) })
      return result.ok ? result.output : null
    },
    [run],
  )

  const update = useCallback(
    (id: string, patch: { text?: string; tone?: LabelTone }) =>
      run('sticky.note.update', { id: id as NodeId, ...patch }).ok,
    [run],
  )

  const remove = useCallback((id: string) => removeTool({ id: id as NodeId }).ok, [removeTool])

  return { notes, create, update, remove }
}
