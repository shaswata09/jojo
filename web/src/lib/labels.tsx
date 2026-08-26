import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useKeywords } from '@jojo/service/react/use-keywords'
import { LabelsContext } from '@/lib/labels-context'
import { litSelection } from '@/lib/label-selection'

/**
 * The keyword filter's selection. That is now the whole of this file.
 *
 * It used to hold the keywords themselves and a `Record<recordId, labelId[]>`
 * beside them, in a provider mounted ABOVE the store — which is why every write
 * that touched records had to carry the keyword map by hand, why fifteen call
 * sites did it, and why the ones that did not left keyword edges pointing at
 * records that no longer existed. D14 merges them: a keyword is a node, tagging
 * is a `TAGS` edge, and both live in the graph with everything else. The audit
 * bug at the removed `store-context.ts` — Settings reporting "Used on 32 records"
 * over an emptied store while the Applications filter read 0 for the same
 * keyword on the same screenful — cannot be written any more, because there is
 * no second place for the count to come from.
 *
 * What is left is genuinely UI state: which chips are lit, in this tab, right
 * now. It is not a record, it does not belong in an export, and it should not
 * survive a reload — so it stays here and stays out of the graph.
 *
 * It is not, however, INDEPENDENT of the graph. Which chips CAN be lit is a fact
 * about which keywords exist, and every path that deletes one has to be able to
 * put that right. Keeping the two in step by hand covered one of them — see
 * `lib/label-selection.ts` for the three it did not, and for why the selection
 * the filter reads is now derived rather than maintained.
 */
export function LabelsProvider({ children }: { children: ReactNode }) {
  const keywords = useKeywords()
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set<string>())

  const {
    labels,
    labelsOf,
    labelIdsOf,
    addLabel,
    renameLabel,
    setTone,
    toggleOn,
    setRecord,
    removeRecord,
    countFor,
    countsWithin,
    carries,
  } = keywords

  /**
   * Delete. The selection is not touched, and that is the fix rather than an
   * omission.
   *
   * This used to take the id out of `selected` and put it back inside the
   * `restore` it returns, which kept the chip honest for exactly one of the
   * ways a keyword goes away — the toast's Undo button. ⇧⌘Z goes straight to
   * `runtime.redo()` without passing through here, and so does another tab. The
   * lit set is derived from the keywords that exist now (`lit` below), so every
   * one of those paths corrects the chip, and this no longer has an opinion.
   */
  const removeLabel = useCallback((id: string) => keywords.removeLabel(id), [keywords])

  const toggleSelected = useCallback((labelId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(labelId)) next.delete(labelId)
      else next.add(labelId)
      return next
    })
  }, [])

  const clearSelected = useCallback(() => setSelected(new Set<string>()), [])

  /**
   * The lit chips, which is the selection minus anything that has since been
   * deleted. `selected` is what the user pressed; this is what the filter means.
   */
  const lit = useMemo(() => litSelection(selected, labels), [selected, labels])

  /**
   * True when a record should be shown. A record matches if it carries *any*
   * selected keyword — OR rather than AND, because people reach for a second
   * keyword to widen a search, not to narrow it to the intersection.
   */
  const matches = useCallback(
    (recordId: string) => lit.size === 0 || carries(recordId, lit),
    [lit, carries],
  )

  const value = useMemo(
    () => ({
      labels,
      addLabel,
      renameLabel,
      removeLabel,
      setTone,
      labelsOf,
      toggleOn,
      labelIdsOf,
      setRecord,
      removeRecord,
      selected: lit,
      toggleSelected,
      clearSelected,
      matches,
      countFor,
      countsWithin,
    }),
    [
      labels,
      addLabel,
      renameLabel,
      removeLabel,
      setTone,
      labelsOf,
      toggleOn,
      labelIdsOf,
      setRecord,
      removeRecord,
      lit,
      toggleSelected,
      clearSelected,
      matches,
      countFor,
      countsWithin,
    ],
  )

  return <LabelsContext.Provider value={value}>{children}</LabelsContext.Provider>
}
