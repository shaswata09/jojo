import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { NEW_LABEL_TONES, seedLabels, seedLabelsByRecord, toLabelId } from '@/data/labels'
import type { Label, LabelTone } from '@/data/labels'
import { uniqueId } from '@/lib/ids'
import { LabelsContext } from '@/lib/labels-context'

/**
 * Names folded before comparing, so "referral" typed into a picker finds the
 * seeded "Referral" instead of standing a second one up beside it.
 */
const nameKey = (name: string) => name.trim().toLowerCase()

/**
 * User-defined keywords, and the filter built on them.
 *
 * Lives at the app root rather than in one page: a keyword set on an
 * application is the same keyword on a reminder, and splitting that state per
 * page would make "Referral" mean two different things depending on where you
 * were standing.
 *
 * An id is minted from the name once, at creation, and never again. Names are
 * editable and ids are not — `byRecord` points at ids, so re-deriving the id on
 * rename would leave every tagged record pointing at a keyword that no longer
 * exists, and fixing a typo would silently untag everything the keyword was on.
 * Two names are therefore the same keyword when the *names* match, not when
 * their slugs do; the slug is only a starting point for a readable id.
 *
 * Session-only until the local store lands, like the rest of the app's edits.
 */
export function LabelsProvider({ children }: { children: ReactNode }) {
  const [labels, setLabels] = useState<Label[]>(seedLabels)
  const [byRecord, setByRecord] = useState<Record<string, string[]>>(seedLabelsByRecord)
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set<string>())

  const addLabel = useCallback(
    (name: string) => {
      const trimmed = name.trim()
      if (!trimmed) return ''

      // Matched on the name rather than on the slug of it. After a rename an id
      // says nothing about what the keyword is called — 'developr' can read
      // "Developer" — so a slug match would miss it and mint a twin.
      const existing = labels.find((l) => nameKey(l.name) === nameKey(trimmed))
      if (existing) return existing.id

      // Unique against the ids already spoken for, for the same reason: the
      // slug of a new name can collide with the id of a keyword now called
      // something else entirely.
      const id = uniqueId(
        toLabelId(trimmed),
        labels.map((l) => l.id),
      )
      setLabels((prev) =>
        prev.some((l) => l.id === id)
          ? prev
          : [
              ...prev,
              { id, name: trimmed, tone: NEW_LABEL_TONES[prev.length % NEW_LABEL_TONES.length] },
            ],
      )
      return id
    },
    [labels],
  )

  const renameLabel = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim()
      if (!trimmed) return false
      // Refused rather than merged when the name is taken: two chips reading the
      // same word are indistinguishable, and merging would quietly rewrite every
      // record carrying either one with no way back.
      if (labels.some((l) => l.id !== id && nameKey(l.name) === nameKey(trimmed))) return false

      setLabels((prev) => prev.map((l) => (l.id === id ? { ...l, name: trimmed } : l)))
      return true
    },
    [labels],
  )

  const setTone = useCallback((id: string, tone: LabelTone) => {
    setLabels((prev) => prev.map((l) => (l.id === id ? { ...l, tone } : l)))
  }, [])

  const removeLabel = useCallback(
    (id: string) => {
      // Everything the undo needs, read before any of the three state calls: the
      // slot the chip sat in, the records it was on, and whether it was filtering.
      const at = labels.findIndex((l) => l.id === id)
      const label = at === -1 ? null : labels[at]
      const tagged = Object.keys(byRecord).filter((recordId) => byRecord[recordId].includes(id))
      const wasSelected = selected.has(id)

      setLabels((prev) => prev.filter((l) => l.id !== id))

      setByRecord((prev) => {
        let changed = false
        const next: Record<string, string[]> = {}
        for (const [recordId, ids] of Object.entries(prev)) {
          if (ids.includes(id)) {
            next[recordId] = ids.filter((i) => i !== id)
            changed = true
          } else {
            next[recordId] = ids
          }
        }
        return changed ? next : prev
      })

      // Not tidiness — the trap. `matches` reads a selection holding one id that
      // nothing carries as "show me the records carrying it", which is none of
      // them, so every filtered list on the page empties at once with no chip
      // left on screen to explain it or to clear.
      setSelected((prev) => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        return next
      })

      return {
        restore() {
          if (label) {
            setLabels((prev) =>
              prev.some((l) => l.id === id)
                ? prev
                : [...prev.slice(0, at), label, ...prev.slice(at)],
            )
          }
          setByRecord((prev) => {
            const next = { ...prev }
            for (const recordId of tagged) {
              const ids = next[recordId] ?? []
              // Appended rather than put back at its old index: display order
              // follows the `labels` array, not the order within a record.
              if (!ids.includes(id)) next[recordId] = [...ids, id]
            }
            return next
          })
          if (wasSelected) setSelected((prev) => new Set(prev).add(id))
        },
      }
    },
    [labels, byRecord, selected],
  )

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

  const labelIdsOf = useCallback((recordId: string) => byRecord[recordId] ?? [], [byRecord])

  const setRecord = useCallback((recordId: string, labelIds: readonly string[]) => {
    setByRecord((prev) => ({ ...prev, [recordId]: [...labelIds] }))
  }, [])

  const removeRecord = useCallback((recordId: string) => {
    setByRecord((prev) => {
      if (!(recordId in prev)) return prev
      // Rebuilt without the key rather than set to [], so `countFor` and the
      // filter never see a record that no longer exists carrying no keywords.
      const { [recordId]: _gone, ...rest } = prev
      return rest
    })
  }, [])

  const clearRecords = useCallback(() => {
    setByRecord((prev) => (Object.keys(prev).length === 0 ? prev : {}))
  }, [])

  const resetRecords = useCallback(() => {
    // Filtered against the keywords that exist rather than copied wholesale: the
    // seed map names the keywords it shipped with, and the user may have deleted
    // one since. Putting that edge back would leave a record tagged with an id
    // no chip answers to — invisible, uncountable, and undeletable.
    const live = new Set(labels.map((l) => l.id))
    const next: Record<string, string[]> = {}
    for (const [recordId, ids] of Object.entries(seedLabelsByRecord)) {
      const kept = ids.filter((id) => live.has(id))
      if (kept.length > 0) next[recordId] = kept
    }
    setByRecord(next)
  }, [labels])

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
      renameLabel,
      removeLabel,
      setTone,
      labelsOf,
      toggleOn,
      labelIdsOf,
      setRecord,
      removeRecord,
      clearRecords,
      resetRecords,
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
      clearRecords,
      resetRecords,
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
