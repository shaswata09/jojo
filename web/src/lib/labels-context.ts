import { createContext, useContext } from 'react'
import type { Label, LabelTone } from '@/data/labels'

export type LabelsContextValue = {
  /**
   * Every keyword that exists, seeded plus anything the user has added.
   *
   * Readonly because it is a projection of the graph and is cached by epoch: a
   * consumer that sorted it in place would have reordered the cached array every
   * other component is holding, and the next render would show a different order
   * with nothing having changed.
   */
  labels: readonly Label[]
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
   * Deletes a keyword everywhere: the chip, and the tagging on every record.
   * `restore` puts both back.
   *
   * It says nothing about the filter, and used to. The lit set is derived from
   * the keywords that exist (`litSelection` in `lib/label-selection.ts`), so a
   * delete un-lights the chip and an undo re-lights it whether it happened
   * here, on ⌘Z, on ⇧⌘Z or in another tab — which is three more paths than a
   * `restore` callback could reach.
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
  /*
   * `clearRecords` and `resetRecords` are gone.
   *
   * They existed because the tagging lived in this provider and the records
   * lived in another, so Settings' Empty and Demo data had to reach into both
   * and keep them in step by hand — and the moment one of them was missed, the
   * manager went on reporting "Used on 32 records" over a store with no records
   * in it. Tagging is a `TAGS` edge now, so emptying the records takes their
   * tags with them inside the same transaction and there is nothing left to
   * synchronise.
   */

  /**
   * The lit chips. Empty means "everything", never "nothing".
   *
   * Derived rather than stored: it is what the user pressed intersected with the
   * keywords that still exist. A caller can treat it as the truth about what the
   * filter is doing; it is not the truth about what has ever been pressed, and
   * nothing needs the second.
   */
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
  /**
   * Every keyword's count over one pool, in one pass.
   *
   * Replaces a per-keyword `countWithin(labelId, ids)` that the filter called
   * once per chip — O(keywords × records) on every keystroke. See
   * `use-keywords.ts` for the measurement.
   */
  countsWithin: (ids: readonly string[]) => ReadonlyMap<string, number>
}

export const LabelsContext = createContext<LabelsContextValue | null>(null)

export function useLabels() {
  const ctx = useContext(LabelsContext)
  if (!ctx) throw new Error('useLabels must be used inside <LabelsProvider>')
  return ctx
}
