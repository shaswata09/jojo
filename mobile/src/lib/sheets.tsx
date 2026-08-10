import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { SheetsContext } from '@/lib/sheets-context'
import type { OpenSheet, SheetName } from '@/lib/sheets-context'

/**
 * One place that knows which sheet is open.
 *
 * The same create sheets are reachable from the tab bar's + button, the search
 * screen, empty states, a board column and a row's overflow menu. If each of
 * those owned an `open` boolean, the same sheet would be mounted five times
 * with five drifting sets of props — so entry points name a sheet and the host
 * mounts it, once.
 *
 * Exactly one at a time. Stacking modals over a prototype is a trap: the back
 * gesture becomes ambiguous and no flow here is long enough to need it.
 * Opening a second sheet replaces the first rather than burying it.
 */
export function SheetsProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<OpenSheet | null>(null)

  const open = useCallback((name: SheetName, props: Record<string, unknown> = {}) => {
    setCurrent({ name, props })
  }, [])

  const close = useCallback(() => setCurrent(null), [])

  const value = useMemo(() => ({ open, close, current }), [open, close, current])

  return <SheetsContext.Provider value={value}>{children}</SheetsContext.Provider>
}
