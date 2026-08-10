import { useEffect, useRef, useState } from 'react'
import type { Application } from '@splinetool/runtime'
import { RobotMascot } from '@/components/brand/RobotMascot'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { SplineScene } from '@/components/ui/splite'
import { useMascot } from '@/lib/mascot-context'
import { createSplineRig, type SplineRig } from '@/lib/spline-rig'
import { useMediaQuery } from '@/lib/use-media-query'
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
 * Root-relative, the same way `components/transfer/textures.ts` names the two
 * textures it vendored into `public/transfer/` — one convention for the app's
 * copied assets, so a change of `base` breaks both together rather than one
 * quietly.
 */
const SCENE = '/mascot.splinecode'

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
const WASM = '/spline'

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
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')

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
    rig.current?.play(pose)
  }, [pose, seq, reduced])

  useEffect(() => () => rig.current?.dispose(), [])

  const onLoad = (app: Application) => {
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
      <ErrorBoundary
        fallback={null}
        onError={() => {
          // The rig points at an Application whose canvas has just been torn
          // out; disposed here so a gesture cannot reach a dead scene.
          rig.current?.dispose()
          rig.current = null
          setFailed(true)
          setWaiting('fallback')
        }}
      >
        <SplineScene
          scene={SCENE}
          wasmPath={WASM}
          className="h-full w-full"
          globalEvents
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
          <span className="size-5 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
        )}
      </div>
    </div>
  )
}
