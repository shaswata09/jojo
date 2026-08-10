import { useMemo, useState } from 'react'

/**
 * Which series a chart legend has switched off.
 *
 * Lives apart from the charts because it is state, not drawing — and because a
 * module that exports both a component and a hook loses Fast Refresh for
 * everything that imports it.
 *
 * `allHidden` is the case worth naming: with every series off a chart says
 * nothing at all, and the panel has to admit that rather than render an empty
 * frame that reads as broken.
 */
export function useSeriesToggle(keys: string[]) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set())

  return useMemo(
    () => ({
      isHidden: (key: string) => hidden.has(key),
      toggle: (key: string) =>
        setHidden((prev) => {
          const next = new Set(prev)
          if (!next.delete(key)) next.add(key)
          return next
        }),
      showAll: () => setHidden(new Set()),
      allHidden: keys.length > 0 && keys.every((k) => hidden.has(k)),
    }),
    [hidden, keys],
  )
}
