import { useCallback, useMemo, useState } from 'react'

/**
 * One legend press: the hidden set with `key` flipped. A new set every time, so
 * React sees the change; the set it was given is left alone.
 */
export function toggledIn<T extends string>(prev: ReadonlySet<T>, key: T): Set<T> {
  const next = new Set(prev)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

/** The keys still drawn, in the order the chart gave them. */
export function visibleOf<T extends string>(keys: readonly T[], hidden: ReadonlySet<T>): T[] {
  return keys.filter((k) => !hidden.has(k))
}

/**
 * Which chart series are currently hidden.
 *
 * Hiding is deliberately unrestricted — you can switch everything off. Chart
 * libraries often block the last series, but that makes the control feel
 * broken; the charts render an explicit "all hidden" message instead, which
 * says what happened and how to undo it.
 */
export function useSeriesToggle<T extends string>(keys: readonly T[]) {
  const [hidden, setHidden] = useState<ReadonlySet<T>>(() => new Set<T>())

  const toggle = useCallback((key: string) => {
    setHidden((prev) => toggledIn(prev, key as T))
  }, [])

  const isHidden = useCallback((key: string) => hidden.has(key as T), [hidden])

  /**
   * Switch everything back on, in one write.
   *
   * Without it the only reset was toggling each hidden key back, which every
   * caller had to spell for itself — and doing that in a loop queues one state
   * update per key rather than one per press.
   */
  const showAll = useCallback(() => setHidden(new Set<T>()), [])

  const visibleKeys = useMemo(() => visibleOf(keys, hidden), [keys, hidden])

  return { hidden, toggle, showAll, isHidden, visibleKeys, allHidden: visibleKeys.length === 0 }
}
