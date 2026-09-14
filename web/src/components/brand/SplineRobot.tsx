import { useCallback, useEffect, useRef, useState } from 'react'
import type { Application } from '@splinetool/runtime'
import { RobotMascot } from '@/components/brand/RobotMascot'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { SplineScene } from '@/components/ui/splite'
import { POSE_MS, useMascot } from '@/lib/mascot-context'
import { createSplineRig, type SplineRig } from '@/lib/spline-rig'
import { useMediaQuery } from '@/lib/use-media-query'
import { publicUrl } from '@/lib/public-url'
import { cn } from '@/lib/utils'

/**
 * Vendored into `public/`, not fetched from prod.spline.design.
 *
 * This was the last third-party request the app made, and it fired on every
 * cold load of every page — the sidebar is always mounted — against a product
 * whose dashboard promises "everything runs on your machine, nothing leaves
 * this device". A CDN hit for the mascot made that sentence false, and it was
 * false in the way that matters: the request carried the user's IP and the
 * referring page to a third party on a route that has their job applications
 * in it.
 *
 * The scene is a self-contained 1.35MB blob — it was checked for embedded
 * asset URLs before it was copied, and it has none — so serving it from the
 * origin is a copy, not a rewrite. The `.splinecode` extension is not in
 * Vite's asset list, so it lives in `public/` and is referenced by URL rather
 * than imported; that also keeps it out of the JS graph, which is what stopped
 * the 1.35MB from being inlined into a chunk.
 *
 * Through `publicUrl`, the same way `components/transfer/textures.ts` names the
 * two textures it vendored into `public/transfer/` — one convention for the
 * app's copied assets.
 *
 * That convention used to be a bare root-relative string, and the comment here
 * claimed a change of `base` would "break both together rather than one
 * quietly". It broke both, and it did it quietly: GitHub Pages serves this at
 * `/<repo>/`, so `/mascot.splinecode` asked github.io for a file at the domain
 * root, got a 404, and the 2D fallback took over doing exactly what it is
 * supposed to do. Nothing in the console, because nothing went wrong.
 */
const SCENE = publicUrl('mascot.splinecode')

/**
 * The second half of the same promise, and the half that is easy to miss.
 *
 * Pointing the scene at `public/` was not enough: this scene uses procedural
 * geometry, so on every load the runtime also fetched
 * `unpkg.com/@splinetool/modelling-wasm@1.12.98/build/process.wasm` — 492kB
 * from a CDN, from a URL hardcoded in the library, on a page carrying somebody's
 * job applications. Vendoring the scene and leaving that behind would have
 * moved the promise from false to false-in-a-place-nobody-looks. Verified by
 * loading the app and reading `performance.getEntriesByType('resource')` for
 * anything not on this origin; the answer is now nothing.
 *
 * The version in that URL is the runtime's own, so this file is pinned to the
 * `@splinetool/runtime` in package.json. If that dependency is bumped, re-fetch
 * `process.wasm` at the matching version — a stale binary is a scene that will
 * not build its geometry, and the failure surfaces as the 2D mascot with
 * nothing in the console to explain it.
 *
 * Only `process.wasm` is here because it is the only one this scene asks for.
 * The runtime also has lazy paths for draco, boolean, navmesh, physics and
 * Skia UI, all of which stay unfetched — they are gated on scene features this
 * one does not use, which is why the check above is the thing to repeat rather
 * than this list.
 */
const WASM = publicUrl('spline')

/** How long the scene's own intro keeps animating after `onLoad` fires. */
const INTRO_SETTLE_MS = 1700

/**
 * Grace past a gesture's own length before the scene may sleep again.
 *
 * The rig starts its curve a commit after the pose is published and lands the
 * last frame on the animation frame after that, so stopping at exactly
 * `POSE_MS` would freeze the closing frames of every gesture mid-move.
 */
const GESTURE_TAIL_MS = 400

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
 * scene has failed to parse or the machine is slow enough that a static robot
 * beats an empty square anyway. It stays this long now that the bytes are local
 * — the 1.35MB still has to be read, decoded and uploaded to the GPU, and on a
 * cold, throttled machine that is seconds, not milliseconds. SPINNER_MS covers
 * the gap without committing to a look — a fast load shows nothing at all.
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
 * The scene is served from this app's own origin, so the card works offline and
 * on first load like everything else here. If it never lands anyway — no WebGL,
 * a scene that will not parse — the flat SVG mascot takes over. It renders from
 * the bundle and knows the same gestures, so the card is never empty and never
 * inert.
 */
export function SplineRobot({ className }: { className?: string }) {
  const { pose, seq, play } = useMascot()
  const [ready, setReady] = useState(false)
  /**
   * The scene loaded and then died, which is not the same as never loading.
   *
   * On a machine with no usable GPU the runtime calls `onLoad` and only then
   * fails to create a WebGL context, so `ready` went true, the boundary below
   * tore the canvas out, and the 2D mascot mounted behind an overlay that
   * `ready` was holding at `opacity: 0`. The card rendered nothing at all —
   * verified in headless Chrome with the GPU off, where the SVG was in the DOM
   * at full size and invisible. The comment on that boundary promised a hand-off
   * "to the 2D mascot, which needs no GPU at all", and this is what makes the
   * promise true rather than intended.
   */
  const [failed, setFailed] = useState(false)
  const [waiting, setWaiting] = useState<'none' | 'spinner' | 'fallback'>('none')
  const rig = useRef<SplineRig | null>(null)
  /** The pending arrival greeting; see `onLoad`. */
  const greeting = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')

  /**
   * Why the scene spends most of its life stopped.
   *
   * The sidebar is mounted on every route, and this scene never settles on its
   * own. With the pointer parked and nothing asked of it, the arm assemblies
   * run a looping idle — measured 4.4 radians of total variation over six
   * seconds: a roughly 3s cycle that changes up to 4.7% of the card's pixels
   * per 250ms, holds still for a beat, then starts again. That pulse at the
   * edge of vision is what a left panel "vibrating weirdly" actually was.
   *
   * `globalEvents` was the other half, and it is gone from the scene below. It
   * routed every pointer move on the PAGE into the runtime, so reading a list
   * on the right swung the body 1.007rad (57.7°) and the head 0.628rad (36°) —
   * a lurch in the corner of the eye answering to something the user was not
   * doing. Dropping it costs nothing: the scene tracks the cursor from its own
   * canvas events just as well, measured at an identical 0.112rad of yaw across
   * the card with the flag on and with it off. An earlier note here claimed
   * tracking died without it; that reading was taken through a full-screen
   * onboarding overlay the pointer never got past, and is simply wrong.
   *
   * `stop()` reaches the idle loop, and nothing else does — it is authored into
   * the scene, not into this app. It holds the last frame rather than clearing
   * the canvas: measured the same lit-pixel count and mean luminance as the
   * live scene, with zero of 107 objects moving. The robot is still there,
   * still lit, still 3D; it just stops fidgeting.
   *
   * So the scene renders only while there is something to see — the pointer is
   * on the card, or an animation is still owed — and is stopped the rest of the
   * time.
   */
  const scene = useRef<Application | null>(null)
  /** The pointer is over the card. */
  const near = useRef(false)
  /** `performance.now()` past which no animation is still owed. */
  const owed = useRef(0)
  const bedtime = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  /**
   * Makes the runtime agree with the two reasons above. Idempotent, cheap, and
   * safe to call from anywhere — everything that changes either reason calls
   * it, and nothing else decides whether the scene runs.
   */
  const settle = useCallback(() => {
    clearTimeout(bedtime.current)
    const app = scene.current
    if (app === null) return
    const left = owed.current - performance.now()
    if (near.current || left > 0) {
      if (app.isStopped) app.play()
      // A gesture ending calls nothing back, so the check has to be booked.
      if (!near.current) bedtime.current = setTimeout(settle, left)
      return
    }
    if (!app.isStopped) app.stop()
  }, [])

  /** Hold the scene awake for `ms` longer — a gesture, or the intro. */
  const hold = useCallback(
    (ms: number) => {
      owed.current = Math.max(owed.current, performance.now() + ms)
      settle()
    },
    [settle],
  )

  /** The 3D robot is on screen — loaded, and still alive. */
  const live = ready && !failed

  useEffect(() => {
    // `failed` bails as well as `ready`, or the 500ms spinner timer would fire
    // after the boundary had already settled on the fallback and walk the card
    // backwards from a robot to a loading spinner that never resolves.
    if (ready || failed) return
    const spinner = setTimeout(() => setWaiting('spinner'), SPINNER_MS)
    const fallback = setTimeout(() => setWaiting('fallback'), FALLBACK_MS)
    return () => {
      clearTimeout(spinner)
      clearTimeout(fallback)
    }
  }, [ready, failed])

  // Latest pose, so a gesture requested before the scene finished loading is
  // still played once it does rather than silently dropped.
  const pending = useRef<{ pose: typeof pose; seq: number }>({ pose, seq })
  pending.current = { pose, seq }

  useEffect(() => {
    if (reduced) return
    // Woken first: the rig drives the joints from its own frame loop, and a
    // stopped runtime paints none of what it writes.
    if (pose !== 'idle') hold(POSE_MS[pose] + GESTURE_TAIL_MS)
    rig.current?.play(pose)
  }, [pose, seq, reduced, hold])

  useEffect(
    () => () => {
      rig.current?.dispose()
      clearTimeout(greeting.current)
      clearTimeout(bedtime.current)
    },
    [],
  )

  const onLoad = (app: Application) => {
    // Fires more than once, against more than one scene. StrictMode runs the
    // effect that builds the Application twice in dev, and react-spline starts
    // a load it never cancels on cleanup, so the Application it threw away still
    // calls back here when it finishes loading.
    //
    // Both of those loads used to schedule their own greeting, and the two
    // landed INTRO_SETTLE_MS apart from two different start points — measured
    // 199ms apart on this machine. The first bow got 0.335rad into its pitch
    // and the second one interrupted it, which settles the joints back to rest
    // in a single frame before restarting: a 19-degree snap, then a bow. That
    // is the "sudden shake on load, then it behaves" this is here to stop.
    //
    // Cheap to get wrong quietly, because it only happens in dev — a production
    // build mounts once and looks perfect.
    rig.current?.dispose()
    clearTimeout(greeting.current)
    // The discarded load's Application is still rendering — react-spline never
    // cancels it, and nothing else will ever hold a reference to stop it. That
    // is an invisible canvas asking for a frame forever, which is the whole
    // problem this file just finished solving.
    scene.current?.stop()

    scene.current = app
    rig.current = createSplineRig(app)
    setReady(true)
    if (reduced) return
    // Greet on arrival rather than on a timer started at mount: the scene is
    // 1.35MB to read and decode, so a fixed delay would fire into an empty card
    // on any slow machine and the greeting would be lost.
    //
    // INTRO_SETTLE_MS, not a token delay: the scene's own `start` animation
    // keeps writing these joints for roughly a second and a half after load.
    // Greeting inside that window plays the gesture and has it overwritten
    // frame by frame — measured, not guessed.
    //
    // Held awake across the whole arrival either way: the scene's own intro is
    // still writing these joints, and it is the one animation here that is
    // neither a gesture nor a hover.
    if (pending.current.pose !== 'idle') {
      // Whichever outlasts the other: `dance` is 2600ms against the intro's
      // 1700, and sleeping on the intro's clock would freeze it mid-move.
      hold(Math.max(INTRO_SETTLE_MS, POSE_MS[pending.current.pose] + GESTURE_TAIL_MS))
      rig.current.play(pending.current.pose)
    } else {
      hold(INTRO_SETTLE_MS + POSE_MS.bow + GESTURE_TAIL_MS)
      greeting.current = setTimeout(() => play('bow'), INTRO_SETTLE_MS)
    }
  }

  /**
   * Reduced motion does not mount the scene at all.
   *
   * The rig was already gated — `createSplineRig`'s gestures and the arrival
   * bow both check `reduced` — and that turned out to cover the half of the
   * motion this app authored and none of the half the scene brings with it.
   * Measured under `prefers-reduced-motion: reduce`: 38% of the card's pixels
   * still changing between two samples a second apart, the robot still turning
   * its whole body to follow the pointer, still moving eleven seconds after
   * load — the scene's own looping idle, and at the time a `globalEvents` flag
   * that routed the whole page's pointer into it.
   *
   * There is still no version of this that keeps the scene. The runtime can be
   * stopped, and is, for everyone else — but only once `onLoad` has fired, and
   * the scene's `start` intro has been animating since before then. A
   * preference for less motion cannot be honoured by something that moves first
   * and asks afterwards, so it is honoured the only way left: by rendering the
   * 2D mascot instead, the same character at the same size in the same box, and
   * genuinely still (0.00% of pixels changed, idle or under a pointer sweep).
   *
   * It also keeps the whole WebGL render loop off these users' machines.
   */
  if (reduced) {
    return (
      <div className={className}>
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <RobotMascot pose={pose} seq={seq} className="h-[76%] w-auto" />
        </div>
      </div>
    )
  }

  return (
    <div
      className={className}
      onPointerEnter={() => {
        near.current = true
        settle()
      }}
      onPointerLeave={() => {
        near.current = false
        settle()
      }}
      onPointerMove={() => {
        // A pointer already resting on the card when the scene finishes loading
        // fires no enter event; this is the only thing that notices it. Guarded
        // so the common case is one comparison per move and nothing else.
        if (near.current) return
        near.current = true
        settle()
      }}
    >
      {/* Guarded on its own. Spline throws "Error creating WebGL context" on
          any machine without a usable GPU — no software fallback, no onError
          prop — and unguarded that propagated to the app boundary and replaced
          the entire page with an error screen. A decorative robot must not be
          able to take down a job tracker; here it just hands over to the 2D
          mascot, which needs no GPU at all. */}
      <ErrorBoundary
        fallback={null}
        onError={() => {
          // The rig points at an Application whose canvas has just been torn
          // out; disposed here so a gesture cannot reach a dead scene.
          rig.current?.dispose()
          rig.current = null
          scene.current = null
          // Nothing left to greet with, and nothing left to put to sleep.
          clearTimeout(greeting.current)
          clearTimeout(bedtime.current)
          setFailed(true)
          setWaiting('fallback')
        }}
      >
        <SplineScene
          scene={SCENE}
          wasmPath={WASM}
          className="h-full w-full"
          onLoad={onLoad}
        />
      </ErrorBoundary>

      {/* Waiting state. Fades in rather than appearing, and fades out once the
          scene is up, so nothing ever pops. `waiting` gates what is *rendered*
          — the mascot is not mounted at all until the load is written off, so a
          normal load cannot flash it however briefly. */}
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
          <span
            className={cn(
              'size-5 rounded-full border-2 border-white/20 border-t-white/70',
              // Spun only while it is actually on screen. Held at `opacity-0`
              // it used to keep turning for the life of the tab — measured as
              // the one animation still running in the sidebar after the scene
              // went to sleep, on every route. Stopped rather than unmounted
              // because the wrapper is still fading out around it, and pulling
              // the child would pop where the fade is the whole point;
              // `RobotMascot` is held the same way by `paused`.
              waiting === 'spinner' && !live ? 'animate-spin' : '',
            )}
          />
        )}
      </div>
    </div>
  )
}
