import { createContext, useContext } from 'react'
import type { Label } from '@/data/labels'

export type LabelsContextValue = {
  /** Every keyword that exists, seeded plus anything the user has added. */
  labels: Label[]
  /** Creates a keyword if it is new and returns its id either way. */
  addLabel: (name: string) => string
  /** The labels on one record, in the order they were defined. */
  labelsOf: (recordId: string) => Label[]
  /** Adds or removes a keyword from a record. */
  toggleOn: (recordId: string, labelId: string) => void

  /** The current filter selection. Empty means "everything", never "nothing". */
  selected: ReadonlySet<string>
  toggleSelected: (labelId: string) => void
  clearSelected: () => void
  /**
   * True when a record should be shown. A record matches if it carries *any*
   * selected keyword — OR rather than AND, because people reach for a second
   * keyword to widen a search, not to narrow it to the intersection.
   */
  matches: (recordId: string) => boolean
  /** How many records carry each label, for the filter's counts. */
  countFor: (labelId: string) => number
  /** The same, restricted to one collection — the tab you are looking at. */
  countWithin: (labelId: string, ids: readonly string[]) => number
}

export const LabelsContext = createContext<LabelsContextValue | null>(null)

export function useLabels() {
  const ctx = useContext(LabelsContext)
  if (!ctx) throw new Error('useLabels must be used inside <LabelsProvider>')
  return ctx
}
