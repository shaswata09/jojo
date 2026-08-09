import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * The four states a handoff walks through, and nothing else.
 *
 * There is no `failed`: this run is a demonstration with no wire under it, and
 * inventing an error state would be inventing a failure that cannot happen.
 */
export type TransferPhase = 'waiting' | 'paired' | 'moving' | 'done'

/** How long one group of records appears to take. */
const STEP_MS = 900
/** The beat between a code being accepted and the sender starting to move. */
const HANDSHAKE_MS = 1100
const TICK_MS = 60

type Options = {
  /** How many groups are being moved. Zero means the run cannot start. */
  stepCount: number
  /**
   * Whether pairing leads straight into moving.
   *
   * The sending device does: once the other end has the code, the person
   * holding this one has already made their decision. The receiving device does
   * not — it is being handed someone else's records, so it stops on `paired`
   * until the person looking at the manifest says yes.
   */
  autoStart: boolean
}

/**
 * Faked timing for the transfer, kept in one place.
 *
 * A single elapsed counter drives both the bar and the step list, so the two
 * cannot disagree about which group is moving — the failure you get from
 * animating a percentage and a highlighted row on separate timers.
 */
export function useTransferRun({ stepCount, autoStart }: Options) {
  const [phase, setPhase] = useState<TransferPhase>('waiting')
  const [elapsed, setElapsed] = useState(0)

  const total = Math.max(stepCount, 1) * STEP_MS

  const pair = useCallback(() => setPhase('paired'), [])
  const start = useCallback(() => {
    setElapsed(0)
    setPhase('moving')
  }, [])
  const reset = useCallback(() => {
    setElapsed(0)
    setPhase('waiting')
  }, [])

  // The sender's handshake beat. Held in an effect rather than chained onto the
  // click so switching roles or resetting mid-beat cancels it.
  useEffect(() => {
    if (phase !== 'paired' || !autoStart) return
    const id = setTimeout(start, HANDSHAKE_MS)
    return () => clearTimeout(id)
  }, [phase, autoStart, start])

  useEffect(() => {
    if (phase !== 'moving') return
    const id = setInterval(() => {
      setElapsed((ms) => {
        const next = ms + TICK_MS
        if (next >= total) {
          setPhase('done')
          return total
        }
        return next
      })
    }, TICK_MS)
    return () => clearInterval(id)
  }, [phase, total])

  return useMemo(() => {
    const progress = phase === 'done' ? 1 : phase === 'moving' ? elapsed / total : 0
    return {
      phase,
      progress,
      /** Index of the group currently moving, or -1 when nothing is. */
      activeIndex: phase === 'moving' ? Math.min(Math.floor(elapsed / STEP_MS), stepCount - 1) : -1,
      /** How many groups have finished — what the step list ticks off. */
      movedCount: phase === 'done' ? stepCount : Math.floor(elapsed / STEP_MS),
      pair,
      start,
      reset,
    }
  }, [phase, elapsed, total, stepCount, pair, start, reset])
}
