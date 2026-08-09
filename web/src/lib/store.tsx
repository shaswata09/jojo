import { useCallback, useMemo, useReducer, useRef } from 'react'
import type { ReactNode } from 'react'
import { StoreContext, seedState, storeReducer } from '@/lib/store-context'

/**
 * The session store. Everything the user creates, edits or deletes lives here
 * and nowhere else, for as long as the tab is open.
 *
 * Mounted inside `LabelsProvider`, because deleting an application also has to
 * drop that application's keywords, and outside `MascotProvider`, which reads
 * the store rather than the other way round.
 *
 * Nothing is persisted and nothing is fetched. A reload is the reset button.
 */
export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(storeReducer, undefined, seedState)

  // Assigned during render rather than in an effect. Every callback the domain
  // hooks hand out is declared with stable dependencies so it can sit in a
  // dependency array without churning, which leaves it with no closure over the
  // current state — `read()` is how it gets one. An effect would leave this a
  // render behind for anything that fires before paint.
  const stateRef = useRef(state)
  stateRef.current = state

  const read = useCallback(() => stateRef.current, [])

  const value = useMemo(() => ({ state, read, dispatch }), [state, read])

  return <StoreContext value={value}>{children}</StoreContext>
}
