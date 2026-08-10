import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useKeywords } from '@/kg/react/use-keywords'
import { LabelsContext } from '@/lib/labels-context'

/**
 * The keyword filter's selection. That is now the whole of this file.
 *
 * It used to hold the keywords themselves and a `Record<recordId, labelId[]>`
 * beside them, in a provider mounted ABOVE the store — which is why every write
 * that touched records had to carry the keyword map by hand, why fifteen call
 * sites did it, and why the ones that did not left keyword edges pointing at
 * records that no longer existed. D14 merges them: a keyword is a node, tagging
 * is a `TAGS` edge, and both live in the graph with everything else. The audit
 * bug at `store-context.ts:930-936` — Settings reporting "Used on 32 records"
 * over an emptied store while the Applications filter read 0 for the same
 * keyword on the same screenful — cannot be written any more, because there is
 * no second place for the count to come from.
 *
 * What is left is genuinely UI state: which chips are lit, in this tab, right
 * now. It is not a record, it does not belong in an export, and it should not
 * survive a reload — so it stays here and stays out of the graph.
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
    countWithin,
    carries,
  } = keywords

  /**
   * Delete, plus the one part of the old three-part undo that is still ours.
   *
   * Taking the id out of the selection is not tidiness — it is the trap. A
   * selection holding one id that nothing carries reads as "show me the records
   * carrying it", which is none of them, so every filtered list on the page
   * empties at once with no chip left on screen to explain it or to clear. The
   * chip and the tagging are put back by the journal; the lit state is put back
   * here.
   */
  const removeLabel = useCallback(
    (id: string) => {
      const wasSelected = selected.has(id)
      const { restore } = keywords.removeLabel(id)

      setSelected((prev) => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        return next
      })

      return {
        restore() {
          restore()
          if (wasSelected) setSelected((prev) => new Set(prev).add(id))
        },
      }
    },
    [keywords, selected],
  )

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
   * True when a record should be shown. A record matches if it carries *any*
   * selected keyword — OR rather than AND, because people reach for a second
   * keyword to widen a search, not to narrow it to the intersection.
   */
  const matches = useCallback(
    (recordId: string) => selected.size === 0 || carries(recordId, selected),
    [selected, carries],
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
      selected,
      toggleSelected,
      clearSelected,
      matches,
      countFor,
      countWithin,
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
      selected,
      toggleSelected,
      clearSelected,
      matches,
      countFor,
      countWithin,
    ],
  )

  return <LabelsContext.Provider value={value}>{children}</LabelsContext.Provider>
}
