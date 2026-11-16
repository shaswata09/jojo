import { createContext, useContext } from 'react'
import { STEPS } from '@/components/tour/steps'

/** The guided tour as the rest of the app sees it — see `TourProvider`. */
export type Tour = {
  active: boolean
  /** The step a launcher would resume at; 0 when there is nothing to resume. */
  saved: number
  total: number
  /** Opens the tour, at the saved step unless told otherwise. */
  start: (from?: number) => void
}

/** A no-op outside the provider: a launcher with no tour does nothing, never throws. */
export const TourContext = createContext<Tour>({
  active: false,
  saved: 0,
  total: STEPS.length,
  start: () => {},
})

export function useTour(): Tour {
  return useContext(TourContext)
}
