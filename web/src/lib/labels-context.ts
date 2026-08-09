import { createContext, useContext } from 'react'
import type { Label, LabelTone } from '@/data/labels'

export type LabelsContextValue = {
  /** Every keyword that exists, seeded plus anything the user has added. */
  labels: Label[]
  /**
   * Creates a keyword if the name is new and returns its id either way — so
   * typing a name that exists selects it rather than minting a twin. Matching
   * is by name, not by slug: see the note on ids in src/lib/labels.tsx. Returns
   * '' for a blank name, which is the one input that creates nothing.
   */
  addLabel: (name: string) => string
  /**
   * Renames a keyword in place, id untouched, so every record tagged with it
   * follows. Returns false when the name is blank or another keyword already
   * answers to it — the caller is expected to say so rather than fail silently.
   */
  renameLabel: (id: string, name: string) => boolean
  /**
   * Deletes a keyword everywhere: off every record, and out of the filter
   * selection. `restore` puts all three back — the chip in its old slot, the
   * records it tagged, and the filter if it was on.
   */
  removeLabel: (id: string) => { restore: () => void }
  /** Recolours a keyword. Purely cosmetic, and instant — no confirmation. */
  setTone: (id: string, tone: LabelTone) => void
  /** The labels on one record, in the order they were defined. */
  labelsOf: (recordId: string) => Label[]
  /** Adds or removes a keyword from a record. */
  toggleOn: (recordId: string, labelId: string) => void
  /** The label ids on one record, unresolved — what an undo has to stash. */
  labelIdsOf: (recordId: string) => string[]
  /** Replaces a record's whole set. Used to put labels back after a delete. */
  setRecord: (recordId: string, labelIds: readonly string[]) => void
  /**
   * Forgets a record entirely. The keywords themselves survive — they belong to
   * the user, not to whatever was deleted, and are almost certainly on other
   * records too.
   */
  removeRecord: (recordId: string) => void
  /**
   * Forgets every record→keyword edge at once. The keywords themselves survive,
   * exactly as `removeRecord` leaves them — this is that call for every record
   * there is, which is what Settings' "Clear everything" actually did to the
   * store. Without it the manager goes on reporting "Used on 32 records" with
   * no records left to carry them.
   */
  clearRecords: () => void
  /**
   * Puts the seeded tagging back, for the store's reset. "Back as they shipped"
   * has to include what the shipped records were tagged with, or the demo data
   * returns with every keyword count at zero. Edges to keywords the user has
   * since deleted are dropped: the list itself is theirs and is not reseeded.
   */
  resetRecords: () => void

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
