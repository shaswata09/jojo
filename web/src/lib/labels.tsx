import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { NEW_LABEL_TONES, seedLabels, seedLabelsByRecord, toLabelId } from '@/data/labels'
import type { Label } from '@/data/labels'
import { LabelsContext } from '@/lib/labels-context'

/**
 * User-defined keywords, and the filter built on them.
 *
 * Lives at the app root rather than in one page: a keyword set on an
 * application is the same keyword on a reminder, and splitting that state per
 * page would make "Referral" mean two different things depending on where you
 * were standing.
 *
 * Session-only until the local store lands, like the rest of the app's edits.
 */
export function LabelsProvider({ children }: { children: ReactNode }) {
  const [labels, setLabels] = useState<Label[]>(seedLabels)
  const [byRecord, setByRecord] = useState<Record<string, string[]>>(seedLabelsByRecord)
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set<string>())

  const addLabel = useCallback((name: string) => {
    const id = toLabelId(name)
    if (!id) return id
    setLabels((prev) =>
      // Typing an existing name reuses it rather than creating a duplicate that
      // would then have to be reconciled.
      prev.some((l) => l.id === id)
        ? prev
        : [
            ...prev,
            { id, name: name.trim(), tone: NEW_LABEL_TONES[prev.length % NEW_LABEL_TONES.length] },
          ],
    )
    return id
  }, [])

  const labelsOf = useCallback(
    (recordId: string) => {
      const ids = byRecord[recordId] ?? []
      return labels.filter((l) => ids.includes(l.id))
    },
    [byRecord, labels],
  )

  const toggleOn = useCallback((recordId: string, labelId: string) => {
    setByRecord((prev) => {
      const ids = prev[recordId] ?? []
      return {
        ...prev,
        [recordId]: ids.includes(labelId) ? ids.filter((i) => i !== labelId) : [...ids, labelId],
      }
    })
  }, [])

  const toggleSelected = useCallback((labelId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(labelId)) next.delete(labelId)
      else next.add(labelId)
      return next
    })
  }, [])

  const clearSelected = useCallback(() => setSelected(new Set<string>()), [])

  const matches = useCallback(
    (recordId: string) => {
      if (selected.size === 0) return true
      return (byRecord[recordId] ?? []).some((id) => selected.has(id))
    },
    [selected, byRecord],
  )

  const countFor = useCallback(
    (labelId: string) =>
      Object.values(byRecord).reduce((n, ids) => n + (ids.includes(labelId) ? 1 : 0), 0),
    [byRecord],
  )

  const countWithin = useCallback(
    (labelId: string, ids: readonly string[]) =>
      ids.reduce((n, id) => n + ((byRecord[id] ?? []).includes(labelId) ? 1 : 0), 0),
    [byRecord],
  )

  const value = useMemo(
    () => ({
      labels,
      addLabel,
      labelsOf,
      toggleOn,
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
      labelsOf,
      toggleOn,
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
