import { useEffect, useRef, useState } from 'react'
import type { Application } from '@splinetool/runtime'
import { RobotMascot } from '@/components/brand/RobotMascot'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { SplineScene } from '@/components/ui/splite'
import { useMascot } from '@/lib/mascot-context'
import { createSplineRig, type SplineRig } from '@/lib/spline-rig'
import { useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'

const SCENE = 'https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode'

/** How long the scene's own intro keeps animating after `onLoad` fires. */
const INTRO_SETTLE_MS = 1700

/**
 * Loading states, both deliberately late.
 *
 * The 2D mascot used to mount at full opacity the moment this component did, so
 * every load — even a warm-cache one finishing in a few hundred ms — flashed a
 * different-looking robot before the real one arrived. It is a *fallback*, not a
 * placeholder, and it should only ever be seen when the 3D robot is genuinely
 * not coming.
 *
 * react-spline exposes no `onError`, so failure has to be inferred from elapsed
 * time. FALLBACK_MS is set well past any plausible successful load: by then the
 * fetch has failed, or the connection is slow enough that a static robot beats
 * an empty square anyway. SPINNER_MS covers the gap without committing to a
 * look — a fast load shows nothing at all.
 */
const SPINNER_MS = 500
const FALLBACK_MS = 8000

/**
 * The 3D robot, wired to the app's gesture vocabulary.
 *
 * The scene tracks the cursor by itself (its own `lookAt`); everything else —
 * nod, shake, bow, lean in, wobble, bounce, spin, recoil, startle, dance — is
 * driven from spline-rig.ts.
 *
 * The scene is fetched from prod.spline.design at runtime, so this needs a
 * network connection on first load. If that never lands, the flat SVG mascot
 * takes over — it renders from the bundle and knows the same gestures, so the
 * card is never empty and never inert.
 */
export function SplineRobot({ className }: { className?: string }) {
  const { pose, seq, play } = useMascot()
  const [ready, setReady] = useState(false)
  const [waiting, setWaiting] = useState<'none' | 'spinner' | 'fallback'>('none')
  const rig = useRef<SplineRig | null>(null)
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')

  useEffect(() => {
    if (ready) return
    const spinner = setTimeout(() => setWaiting('spinner'), SPINNER_MS)
    const fallback = setTimeout(() => setWaiting('fallback'), FALLBACK_MS)
    return () => {
      clearTimeout(spinner)
      clearTimeout(fallback)
    }
  }, [ready])

  // Latest pose, so a gesture requested before the scene finished loading is
  // still played once it does rather than silently dropped.
  const pending = useRef<{ pose: typeof pose; seq: number }>({ pose, seq })
  pending.current = { pose, seq }

  useEffect(() => {
    if (reduced) return
    rig.current?.play(pose)
  }, [pose, seq, reduced])

  useEffect(() => () => rig.current?.dispose(), [])

  const onLoad = (app: Application) => {
    rig.current = createSplineRig(app)
    setReady(true)
    if (reduced) return
    // Greet on arrival rather than on a timer started at mount: the scene is a
    // 1.35MB download, so a fixed delay would fire into an empty card on any
    // slow connection and the greeting would be lost.
    //
    // INTRO_SETTLE_MS, not a token delay: the scene's own `start` animation
    // keeps writing these joints for roughly a second and a half after load.
    // Greeting inside that window plays the gesture and has it overwritten
    // frame by frame — measured, not guessed.
    if (pending.current.pose !== 'idle') rig.current.play(pending.current.pose)
    else setTimeout(() => play('bow'), INTRO_SETTLE_MS)
  }

  return (
    <div className={className}>
      {/* Guarded on its own. Spline throws "Error creating WebGL context" on
          any machine without a usable GPU — no software fallback, no onError
          prop — and unguarded that propagated to the app boundary and replaced
          the entire page with an error screen. A decorative robot must not be
          able to take down a job tracker; here it just hands over to the 2D
          mascot, which needs no GPU at all. */}
      <ErrorBoundary fallback={null} onError={() => setWaiting('fallback')}>
        <SplineScene scene={SCENE} className="h-full w-full" globalEvents onLoad={onLoad} />
      </ErrorBoundary>

      {/* Waiting state. Fades in rather than appearing, and fades out once the
          scene is up, so nothing ever pops. `waiting` gates what is *rendered*
          — the mascot is not mounted at all until the load is written off, so a
          normal load cannot flash it however briefly. */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0 grid place-items-center transition-opacity duration-500',
          ready || waiting === 'none' ? 'opacity-0' : 'opacity-100',
        )}
      >
        {waiting === 'fallback' ? (
          <RobotMascot pose={pose} seq={seq} paused={ready} className="h-[76%] w-auto" />
        ) : (
          <span className="size-5 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
        )}
      </div>
    </div>
  )
}
