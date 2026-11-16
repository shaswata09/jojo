import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { RobotMascot } from '@/components/brand/RobotMascot'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { useMascot } from '@/lib/mascot-context'
import { greetingFor } from '@/lib/mascot-cues'
import { useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'

/**
 * Lazy, so three.js is its own chunk and never touches the first paint of the
 * page the sidebar sits beside. It replaced a 2 MB Spline runtime loaded the
 * same way; this chunk is the robot's geometry and three's WebGL renderer.
 */
const RobotScene = lazy(() => import('@/components/brand/RobotScene'))

/**
 * Loading states, both deliberately late.
 *
 * The 2D mascot is a FALLBACK, not a placeholder (Q032): it is only mounted
 * once the 3D robot is written off, so a normal load never flashes a
 * different-looking robot first. SPINNER_MS covers a slow chunk without
 * committing to a look; FALLBACK_MS is well past any plausible load — the
 * chunk is local and the robot is built in a frame or two, so a scene that has
 * not drawn by then is not coming.
 */
const SPINNER_MS = 500
const FALLBACK_MS = 8000

/**
 * A beat between the robot landing and its wave. The landing itself is
 * reported by the scene, in rendered time (`onLanded`), so a slow machine that
 * takes longer to rise is greeted when it has, not on a clock that ran out
 * mid-rise — which is what a timer of INTRO_S did in a slow headless browser.
 */
const GREET_MS = 150

/**
 * How this page was reached — 'navigate', 'reload', 'back_forward' — from the
 * browser's navigation timing. Undefined where it is not available, which
 * greets as a first load.
 */
function navigationType(): string | undefined {
  try {
    const [entry] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[]
    return entry?.type
  } catch {
    return undefined
  }
}

/**
 * Whether this browser can make a WebGL context at all, asked once.
 *
 * Asked BEFORE loading the scene rather than inferred from a crash after it.
 * On a machine with no usable GPU the old robot loaded, called back, and only
 * then failed — and for a while that left the card showing nothing at all.
 * Knowing up front sends those machines straight to the 2D mascot, with no
 * chunk downloaded for a renderer that cannot run.
 */
let webgl: boolean | null = null
function hasWebGL(): boolean {
  if (webgl !== null) return webgl
  try {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    webgl = context !== null
    // Handed back straight away: browsers cap live contexts (~16), and this
    // one was only ever a question.
    context?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    webgl = false
  }
  return webgl
}

/**
 * Whether the card is on screen, so a robot nobody can see renders no frames.
 *
 * The phone layout keeps the sidebar mounted in a closed drawer; without this
 * the robot would breathe at full frame rate behind it for the whole session.
 */
function useOnScreen(ref: React.RefObject<HTMLElement | null>): boolean {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry?.isIntersecting ?? true),
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return visible
}

/**
 * jojo's 3D robot, wired to the app's gesture vocabulary.
 *
 * The robot itself is `RobotScene` and its motion is `lib/robot-rig.ts`; this
 * decides whether it can be shown at all and what stands in when it cannot.
 * Without WebGL, or if the scene throws, the flat SVG mascot takes over — it
 * renders from the bundle and knows the same gestures, so the card is never
 * empty and never inert.
 *
 * Reduced motion keeps the 3D robot and holds it still: one frame, no idle,
 * no tracking, no gestures. The Spline robot could not do that — its runtime
 * animated itself with no way to stop it — and had to be swapped for the 2D
 * one; a robot this project models itself can simply stand there.
 */
export function JojoRobot({ className }: { className?: string }) {
  const { pose, seq, play } = useMascot()
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const box = useRef<HTMLDivElement>(null)
  const onScreen = useOnScreen(box)

  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(() => !hasWebGL())
  const [waiting, setWaiting] = useState<'none' | 'spinner' | 'fallback'>(() =>
    hasWebGL() ? 'none' : 'fallback',
  )
  const greeting = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  /** The 3D robot is on screen — drawn, and still alive. */
  const live = ready && !failed

  useEffect(() => {
    // `failed` bails as well as `ready`, or the spinner timer would fire after
    // the boundary had settled on the fallback and walk the card backwards.
    if (ready || failed) return
    const spinner = setTimeout(() => setWaiting('spinner'), SPINNER_MS)
    const fallback = setTimeout(() => setWaiting('fallback'), FALLBACK_MS)
    return () => {
      clearTimeout(spinner)
      clearTimeout(fallback)
    }
  }, [ready, failed])

  // Latest pose, so a gesture asked for before the first frame is still played.
  const pending = useRef(pose)
  pending.current = pose

  useEffect(() => () => clearTimeout(greeting.current), [])

  const onReady = () => setReady(true)

  /**
   * The greeting, once the robot has risen into place: a wave of the right
   * hand on a first load, a bow on a refresh (`greetingFor`).
   */
  const onLanded = () => {
    // Once per scene. StrictMode mounts the canvas twice in dev, and two
    // greetings landing ~200 ms apart was the "shake on load" of the old robot
    // (Q083): the second interrupted the first mid-gesture.
    clearTimeout(greeting.current)
    if (reduced) return
    // If a gesture was already asked for, the scene plays that instead and
    // there is no greeting.
    if (pending.current === 'idle') {
      const hello = greetingFor(navigationType())
      greeting.current = setTimeout(() => play(hello), GREET_MS)
    }
  }

  return (
    <div ref={box} className={className}>
      {!failed && (
        // Guarded on its own. A WebGL context can still be refused or lost
        // after the check above, and three throws when it is; unguarded that
        // reached the app boundary and replaced the whole page. A decorative
        // robot must not be able to take down a job tracker.
        <ErrorBoundary
          fallback={null}
          onError={() => {
            clearTimeout(greeting.current)
            setFailed(true)
            setWaiting('fallback')
          }}
        >
          <Suspense fallback={null}>
            <RobotScene
              pose={pose}
              seq={seq}
              still={reduced}
              active={onScreen}
              onReady={onReady}
              onLanded={onLanded}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {/* Waiting state. Fades in rather than appearing, and out once the robot
          is up, so nothing ever pops. The 2D mascot is not mounted at all
          until the load is written off. */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0 grid place-items-center transition-opacity duration-500',
          live || waiting === 'none' ? 'opacity-0' : 'opacity-100',
        )}
      >
        {waiting === 'fallback' ? (
          <RobotMascot pose={pose} seq={seq} paused={live} className="h-[76%] w-auto" />
        ) : (
          <span className="size-5 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
        )}
      </div>
    </div>
  )
}
