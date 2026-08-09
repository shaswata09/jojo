import { useCallback, useMemo, useState } from 'react'

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
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(key as T)) next.delete(key as T)
      else next.add(key as T)
      return next
    })
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

  const visibleKeys = useMemo(() => keys.filter((k) => !hidden.has(k)), [keys, hidden])

  return { hidden, toggle, showAll, isHidden, visibleKeys, allHidden: visibleKeys.length === 0 }
}
