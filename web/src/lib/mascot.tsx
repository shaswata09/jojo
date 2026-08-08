import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { MascotContext, POSE_MS, type MascotPose } from '@/lib/mascot-context'

/**
 * Holds the mascot's current gesture.
 *
 * Kept in context rather than in BrandCard so anything in the app can make the
 * robot react — a nod when an application saves, a shake on an empty search —
 * without threading a ref down through the layout.
 */
export function MascotProvider({ children }: { children: ReactNode }) {
  const [{ pose, seq }, setState] = useState<{ pose: MascotPose; seq: number }>({
    pose: 'idle',
    seq: 0,
  })
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const play = useCallback((next: MascotPose) => {
    clearTimeout(timer.current)

    // The pose is committed in this one update. An earlier version dropped to
    // idle and set the real pose inside requestAnimationFrame, to force CSS to
    // restart the animation — but rAF is paused in background tabs, so the
    // gesture was silently lost while its reset timer still ran. Restarting is
    // now the mascot's job (see RobotMascot), keyed off `seq`.
    setState((s) => ({ pose: next, seq: s.seq + 1 }))

    if (next !== 'idle') {
      timer.current = setTimeout(
        () => setState((s) => ({ pose: 'idle', seq: s.seq })),
        POSE_MS[next],
      )
    }
  }, [])

  useEffect(() => () => clearTimeout(timer.current), [])

  const value = useMemo(() => ({ pose, seq, play }), [pose, seq, play])

  return <MascotContext.Provider value={value}>{children}</MascotContext.Provider>
}
