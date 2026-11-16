import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { TourContext } from '@/components/tour/tour-context'
import { TourOverlay } from '@/components/tour/TourOverlay'
import { clearProgress, readProgress, writeProgress } from '@/components/tour/progress'
import { STEPS } from '@/components/tour/steps'
import { report } from '@/lib/analytics'

/**
 * The guided tour: a spotlight walking the real app, page to page, asking the
 * reader to try each thing as it goes.
 *
 * Mounted in the app shell, inside the router and above every page, so the
 * overlay survives the route changes the tour makes. (The first tour was a
 * dialog on the guide page for want of exactly this mount point; the shell is
 * in this package, so the tour can live where it belongs.)
 */
export function TourProvider({ children }: { children: ReactNode }) {
  const total = STEPS.length
  const [active, setActive] = useState(false)
  const [step, setStep] = useState(() => readProgress(total))
  /** Which way the reader last moved, so a passed-over step is passed in that direction. */
  const [dir, setDir] = useState<1 | -1>(1)

  const start = useCallback(
    (from?: number) => {
      const at = from ?? readProgress(total)
      setStep(at)
      setActive(true)
      report('tour_used', { outcome: 'started' })
    },
    [total],
  )

  const go = useCallback(
    (next: number) => {
      const at = Math.min(Math.max(next, 0), total - 1)
      setDir(at < step ? -1 : 1)
      setStep(at)
      writeProgress(at)
    },
    [total, step],
  )

  /** Closed early: the place is kept, and the launcher offers to resume. */
  const leave = useCallback(() => setActive(false), [])

  /** Finished: the bookmark is cleared, so the next run starts at the start. */
  const finish = useCallback(() => {
    clearProgress()
    setStep(0)
    setActive(false)
    report('tour_used', { outcome: 'finished' })
  }, [])

  const tour = useMemo(
    () => ({ active, saved: active ? 0 : step, total, start }),
    [active, step, total, start],
  )

  return (
    <TourContext value={tour}>
      {children}
      {active ? (
        <TourOverlay index={step} dir={dir} onGo={go} onLeave={leave} onFinish={finish} />
      ) : null}
    </TourContext>
  )
}
