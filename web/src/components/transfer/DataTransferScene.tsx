import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { RefObject } from 'react'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import {
  Color,
  Mesh,
  MeshBasicNodeMaterial,
  NoColorSpace,
  PlaneGeometry,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  WebGPURenderer,
} from 'three/webgpu'
import type { Node, Texture } from 'three/webgpu'
import {
  dot,
  exp,
  float,
  fract,
  max,
  min,
  mix,
  positionGeometry,
  sRGBTransferOETF,
  sin,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { useReducedMotion } from '@/lib/use-media-query'
import { COLOR_MAP, DEPTH_MAP, MAP_HEIGHT, MAP_WIDTH } from './textures'

/**
 * The Transfer page's backdrop, live.
 *
 * The picture `scripts/make-transfer-scene.py` draws — a computer at the back,
 * a phone in front, record cards arcing between them — shown on a dark ground
 * with a little real depth, and three things moving on it:
 *
 * - **Relay.** Small orange packets of light leave the computer's screen, ride
 *   the arc of cards and sink into the phone; one dimmer packet makes the
 *   return trip on a lower lane, because the page sends and receives. Each
 *   packet warms the cards it passes, so the cards seem to hand it along.
 * - **Warmth.** The two screens glow softly in turn, a slow see-saw rather
 *   than a pulse, so neither end ever "arrives".
 * - **Depth.** The depth map leans the near phone and cards a few pixels more
 *   than the far computer: a slow sway, plus the mouse, if one is over the
 *   card.
 *
 * Nothing here knows the transfer's state, and nothing fills, counts or peaks:
 * the real progress readout lives in another panel, and a backdrop that
 * looked like a second one would be lying.
 *
 * One full-screen triangle pair and one fragment shader; no post-processing.
 * Rendering is on demand, at most 30 times a second, and stops while the tab
 * is hidden, the card is scrolled away, or the reader asked for less motion
 * (then a single representative still is drawn).
 */

export type DataTransferSceneProps = {
  /** Applied to the box that fills the caller's container. */
  className?: string
}

// ── Timing ───────────────────────────────────────────────────────────────────
//
// Every motion's period divides LOOP_S, so the clock can wrap there without a
// visible seam, and a page left open for hours never feeds the shader a large
// float.

const LOOP_S = 72
/** One packet's trip from the computer to the phone. */
const RELAY_S = 7.2
/** The return packet's slower trip back. */
const RETURN_S = 9
/** One full in-and-out of the screens' see-saw glow. */
const WARMTH_S = 9
const SWAY_X_S = 14.4
const SWAY_Y_S = 18
/** The moment drawn when the reader asked for less motion. */
const STILL_AT_S = 1.3
/** Rendering cadence: the motion is slow, 30 a second is plenty. */
const STEP_MS = 1000 / 30 - 2
/** The longest step the clock takes, so a resumed tab does not fast-forward. */
const MAX_STEP_S = 0.1
/** A mouse that has not moved for this long lets the picture settle back. */
const IDLE_MS = 3500

/** How far the depth sway leans the picture, in picture widths per unit depth. */
const SWAY = 0.01
const LEAN = 0.014
/** The depth that does not move; nearer leans one way, further the other. */
const PIVOT_DEPTH = 0.55

const DPR_CAP = 1.5
/** R3F tears a root down this long after its Canvas unmounts. */
const R3F_TEARDOWN_MS = 500

const PICTURE_ASPECT = MAP_WIDTH / MAP_HEIGHT

/** Same value as `--transfer-scene-ground` in transfer.css. */
const GROUND_HEX = 0x0e0d0c

// ── The picture's geometry ───────────────────────────────────────────────────
//
// Picture coordinates: 0..1 across, 0..1 down, read off the generator's camera
// projection. Each lane is a cubic Bézier through the cards it rides past.

type Point = readonly [number, number]

type Lane = {
  from: Point
  pull1: Point
  pull2: Point
  to: Point
  seconds: number
  packets: number
  strength: number
}

const LANES: readonly Lane[] = [
  // Computer → phone, over the top of the arc of cards.
  {
    from: [0.3, 0.42],
    pull1: [0.445, 0.11],
    pull2: [0.705, 0.45],
    to: [0.785, 0.61],
    seconds: RELAY_S,
    packets: 3,
    strength: 1,
  },
  // Phone → computer, lower and fainter, through the open air under the arc.
  {
    from: [0.765, 0.53],
    pull1: [0.66, 0.47],
    pull2: [0.52, 0.43],
    to: [0.415, 0.44],
    seconds: RETURN_S,
    packets: 1,
    strength: 0.5,
  },
]

/** Trail behind each packet: how far back along the lane, and how bright. */
const TRAIL = [0, 1, 2, 3, 4, 5].map((k) => ({ back: k * 0.011, weight: (1 - k / 6) ** 1.6 }))

/** The two screens, as soft ellipses: centre, long-axis direction, radii. */
const SCREENS = [
  { centre: [0.257, 0.418] as Point, axis: -6.6, radii: [0.2, 0.135] as Point, rest: 0.006, swing: 0.018, phase: 0 },
  { centre: [0.8, 0.616] as Point, axis: 79, radii: [0.155, 0.08] as Point, rest: 0.004, swing: 0.013, phase: Math.PI },
]

// Linear-light colours, all in jojo's orange family. The pairing QR card must
// stay the brightest thing on the stage, so light warms what it falls on
// rather than whitening it (see `ROOF`).
const ORANGE = [1.0, 0.195, 0.01] as const
const PACKET_CORE = [1.0, 0.43, 0.15] as const
/** Light thrown on a dark surface: mostly red, a little green. */
const WARM_ON_DARK = [1.0, 0.42, 0.14] as const
/**
 * Light thrown on a pale card. Adding light there would only push it toward
 * white, so it shifts the card's hue instead: red up, green and blue down,
 * about the same brightness, now orange.
 */
const WARM_ON_PALE = [0.45, -0.3, -0.75] as const
/** The most the packets and screens add to any one pixel. */
const CEILING = [0.82, 0.34, 0.11] as const
/**
 * The brightest any lit pixel may end up, per channel, unless the picture
 * itself was already brighter there: red stops short of clipping, and green
 * and blue stay low enough that the result reads orange, never cream.
 */
const ROOF = [0.95, 0.5, 0.2] as const

type Uniforms = {
  fit: { value: Vector2 }
  sway: { value: Vector2 }
  clock: { value: number }
}

type PictureParts = {
  geometry: PlaneGeometry
  material: MeshBasicNodeMaterial
  mesh: Mesh
  uniforms: Uniforms
}

/**
 * Builds the one material the scene draws with. Called once per texture pair;
 * the frame loop only writes the three uniforms.
 */
function buildPicture(colorMap: Texture, depthMap: Texture): PictureParts {
  const fitU = uniform(new Vector2(1, 1))
  const swayU = uniform(new Vector2(0, 0))
  const clockU = uniform(0)

  const screenUv = uv()
  // Cover-fit: the visible part of the square picture, centred.
  const at = vec2(
    screenUv.x.sub(0.5).mul(fitU.x).add(0.5),
    float(0.5).sub(screenUv.y.sub(0.5).mul(fitU.y)),
  )
  const mapUv = (p: Node<'vec2'>) => vec2(p.x, float(1).sub(p.y))

  // Depth from a softened level, clamped to the range the subject spans, so
  // the empty ground behind it does not drag its edges. Read twice — here and
  // where that first guess lands — keeping the nearer, so a near edge slides
  // over the ground instead of the ground pulling it apart.
  const depthAt = (q: Node<'vec2'>) =>
    texture(depthMap, mapUv(q)).level(float(2.5)).r.clamp(0.3, 0.95)
  const first = depthAt(at)
  const guess = at.add(swayU.mul(first.sub(PIVOT_DEPTH)))
  const depth = first.max(depthAt(guess))
  const p = at.add(swayU.mul(depth.sub(PIVOT_DEPTH)))
  const picture = texture(colorMap, mapUv(p)).level(float(0))

  const groundColour = new Color(GROUND_HEX)
  const ground = vec3(groundColour.r, groundColour.g, groundColour.b)
  // The colour map is premultiplied onto black; alpha is coverage.
  const base = picture.rgb.add(ground.mul(float(1).sub(picture.a)))

  let core: Node<'float'> = float(0)
  let halo: Node<'float'> = float(0)
  let pool: Node<'float'> = float(0)

  for (const lane of LANES) {
    // Polynomial form of the Bézier: ((a·s + b)·s + c)·s + d.
    const [x0, y0] = lane.from
    const [x1, y1] = lane.pull1
    const [x2, y2] = lane.pull2
    const [x3, y3] = lane.to
    const a = vec2(-x0 + 3 * x1 - 3 * x2 + x3, -y0 + 3 * y1 - 3 * y2 + y3)
    const b = vec2(3 * x0 - 6 * x1 + 3 * x2, 3 * y0 - 6 * y1 + 3 * y2)
    const c = vec2(-3 * x0 + 3 * x1, -3 * y0 + 3 * y1)
    const d = vec2(x0, y0)
    const along = (s: Node<'float'>) => a.mul(s).add(b).mul(s).add(c).mul(s).add(d)
    // Fades in off the first screen and is gone before the second, so no end
    // of the lane ever flares.
    const presence = (s: Node<'float'>) =>
      smoothstep(0, 0.14, s).mul(float(1).sub(smoothstep(0.7, 0.96, s)))

    for (let i = 0; i < lane.packets; i++) {
      const head = fract(clockU.div(lane.seconds).add(i / lane.packets))
      for (const { back, weight } of TRAIL) {
        const s = head.sub(back)
        const offset = p.sub(along(s))
        const d2 = dot(offset, offset)
        const glow = presence(s).mul(weight * lane.strength)
        // σ ≈ 0.0065 of the picture.
        core = core.add(glow.mul(exp(d2.mul(-11800))))
        if (back === 0) {
          // σ ≈ 0.026: the soft halo round the head.
          halo = halo.add(glow.mul(exp(d2.mul(-740))))
          // σ ≈ 0.055: the light it throws on the cards beside it.
          pool = pool.add(glow.mul(exp(d2.mul(-165))))
        }
      }
    }
  }

  let warmth: Node<'float'> = float(0)
  for (const screen of SCREENS) {
    const turn = (screen.axis * Math.PI) / 180
    const ux = Math.cos(turn)
    const uy = Math.sin(turn)
    const rel = p.sub(vec2(screen.centre[0], screen.centre[1]))
    const q = vec2(
      dot(rel, vec2(ux, uy)).div(screen.radii[0]),
      dot(rel, vec2(-uy, ux)).div(screen.radii[1]),
    )
    const inside = float(1).sub(smoothstep(0.35, 1, q.length()))
    const swing = sin(clockU.mul((2 * Math.PI) / WARMTH_S).add(screen.phase)).mul(0.5).add(0.5)
    // Mostly on the device itself; a little spills onto the ground round it.
    const onDevice = picture.a.mul(0.75).add(0.25)
    warmth = warmth.add(inside.mul(onDevice).mul(swing.mul(screen.swing).add(screen.rest)))
  }

  // The packets' light on the surface under them, as a tint of that surface:
  // dark things brighten toward orange, pale cards turn orange.
  const brightness = dot(base, vec3(0.2126, 0.7152, 0.0722))
  const tint = mix(vec3(...WARM_ON_DARK), vec3(...WARM_ON_PALE), smoothstep(0.2, 0.65, brightness))
  const warmed = base.mul(tint.mul(pool.mul(0.75)).add(1))

  // Light of their own: packet cores, their halos, the screens' warmth.
  const emitted = min(
    vec3(...PACKET_CORE)
      .mul(core.mul(0.75))
      .add(vec3(...ORANGE).mul(halo.mul(0.3)))
      .add(vec3(...ORANGE).mul(warmth)),
    vec3(...CEILING),
  )

  // The final colour is what gets capped, not just what was added: red never
  // passes ROOF (or the picture's own red), and green and blue never pass
  // ROOF or the warmed surface, whichever is higher — so a lit pale card can
  // only go orange.
  const roof = max(min(warmed, base), vec3(...ROOF))
  const lit = min(warmed.add(emitted), roof)

  const material = new MeshBasicNodeMaterial()
  material.depthTest = false
  material.depthWrite = false
  material.toneMapped = false
  // The plane is already in clip space: no camera involved.
  material.vertexNode = vec4(positionGeometry.xy, 0, 1)
  // Encoded to sRGB here, and the canvas is told its output is linear (the
  // Canvas's `linear`), so three draws straight to the canvas. Left to three,
  // the encode costs a full-size half-float target and a second pass — and
  // that pass's quad shares one geometry across every renderer, which keeps
  // each disposed renderer alive through its listeners.
  // The typings return an untyped node; it is the vec3 it was given.
  const encoded = sRGBTransferOETF(lit) as Node<'vec3'>
  material.colorNode = vec4(encoded, 1)

  const geometry = new PlaneGeometry(2, 2)
  const mesh = new Mesh(geometry, material)
  mesh.frustumCulled = false

  return {
    geometry,
    material,
    mesh,
    uniforms: { fit: fitU, sway: swayU, clock: clockU },
  }
}

type Motion = {
  /** performance.now() of the last drawn picture, or -1 to start fresh. */
  last: number
  elapsed: number
  leanX: number
  leanY: number
  drawn: boolean
}

type Lean = { x: number; y: number; at: number }

/** Writes this moment into the uniforms. Numbers only: nothing allocated. */
function pose(uniforms: Uniforms, width: number, height: number, motion: Motion) {
  const ratio = width / Math.max(height, 1) / PICTURE_ASPECT
  if (ratio >= 1) uniforms.fit.value.set(1, 1 / ratio)
  else uniforms.fit.value.set(ratio, 1)

  const e = motion.elapsed
  const swayX = Math.sin((2 * Math.PI * e) / SWAY_X_S) * SWAY
  const swayY = Math.sin((2 * Math.PI * e) / SWAY_Y_S + 1.3) * SWAY * 0.4
  uniforms.sway.value.set(swayX + motion.leanX * LEAN, swayY + motion.leanY * LEAN * 0.4)
  uniforms.clock.value = e
}

type PictureProps = {
  still: boolean
  running: boolean
  lean: RefObject<Lean>
  onDrawn: () => void
}

function Picture({ still, running, lean, onDrawn }: PictureProps) {
  const [colorMap, depthMap] = useLoader(TextureLoader, [COLOR_MAP, DEPTH_MAP])
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  const invalidate = useThree((state) => state.invalidate)

  const parts = useMemo(() => {
    colorMap.colorSpace = SRGBColorSpace
    depthMap.colorSpace = NoColorSpace
    return buildPicture(colorMap, depthMap)
  }, [colorMap, depthMap])

  useEffect(
    () => () => {
      parts.material.dispose()
      parts.geometry.dispose()
      // Loader-cached: the object outlives this visit, but each renderer that
      // uploaded it left a listener on it. Disposing frees the GPU copy and
      // lets that renderer go; the next visit uploads it again.
      colorMap.dispose()
      depthMap.dispose()
    },
    [parts, colorMap, depthMap],
  )

  // Build the pipeline off the critical path before the first picture.
  const [compiled, setCompiled] = useState(false)
  useEffect(() => {
    let current = true
    const settle = () => {
      if (current) setCompiled(true)
    }
    void (gl as unknown as WebGPURenderer).compileAsync(scene, camera).then(settle, settle)
    return () => {
      current = false
    }
  }, [gl, scene, camera, parts])

  const motion = useRef<Motion>({ last: -1, elapsed: STILL_AT_S, leanX: 0, leanY: 0, drawn: false })

  useFrame((state) => {
    if (!compiled) return
    const m = motion.current
    const now = performance.now()
    const dt = m.last < 0 ? 0 : Math.min((now - m.last) / 1000, MAX_STEP_S)
    m.last = now
    if (still) {
      m.elapsed = STILL_AT_S
      m.leanX = 0
      m.leanY = 0
    } else {
      m.elapsed = (m.elapsed + dt) % LOOP_S
      const target = lean.current
      const idle = now - target.at > IDLE_MS
      const ease = 1 - Math.exp(-dt * 2.5)
      m.leanX += ((idle ? 0 : target.x) - m.leanX) * ease
      m.leanY += ((idle ? 0 : target.y) - m.leanY) * ease
    }
    pose(parts.uniforms, state.size.width, state.size.height, m)
    state.gl.render(state.scene, state.camera)
    if (!m.drawn) {
      m.drawn = true
      onDrawn()
    }
  }, 1)

  // The pump: asks R3F for a picture at most 30 times a second, and only
  // while there is someone to see it move.
  useEffect(() => {
    if (!compiled || !running) return
    motion.current.last = -1
    let id = 0
    let last = -Infinity
    const tick = (now: number) => {
      id = requestAnimationFrame(tick)
      if (now - last >= STEP_MS) {
        last = now
        invalidate()
      }
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [compiled, running, invalidate])

  // On demand: the first picture, a resize, and the switch into a still.
  useEffect(() => {
    if (!compiled) return
    motion.current.last = -1
    invalidate()
  }, [compiled, still, size, invalidate])

  return <primitive object={parts.mesh} />
}

/**
 * One pending disposal per renderer, not per component instance: a StrictMode
 * rehearsal remounts the canvas's children as new instances on the same
 * renderer, and must still find and cancel the timer the old one set.
 */
const disposals = new WeakMap<object, { current: ReturnType<typeof setTimeout> | undefined }>()

function disposalFor(renderer: object) {
  let slot = disposals.get(renderer)
  if (!slot) {
    slot = { current: undefined }
    disposals.set(renderer, slot)
  }
  return slot
}

/**
 * R3F does not dispose a WebGPU renderer, and three's renderer keeps its own
 * animation loop running until something does — holding the GPU device, the
 * canvas and the detached page. So it is disposed here, after R3F's own
 * teardown has finished with it (disposing first makes that teardown throw).
 */
function DisposeRenderer() {
  const renderer = useThree((state) => state.gl)
  const pending = useMemo(() => disposalFor(renderer), [renderer])
  useEffect(() => {
    clearTimeout(pending.current)
    return () => {
      pending.current = setTimeout(() => renderer.dispose(), R3F_TEARDOWN_MS + 100)
    }
  }, [renderer, pending])
  return null
}

/** Is any of the box on screen? Assumed yes until the observer says. */
function useOnScreen(target: RefObject<HTMLElement | null>) {
  const [onScreen, setOnScreen] = useState(true)
  useEffect(() => {
    const element = target.current
    if (!element || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) setOnScreen(entry.isIntersecting)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [target])
  return onScreen
}

function watchVisibility(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}

function usePageShown() {
  return useSyncExternalStore(
    watchVisibility,
    () => !document.hidden,
    () => true,
  )
}

/**
 * Where the mouse is over the box, from -1 to 1 on each axis, for the depth
 * lean. The backdrop takes no pointer events, so this listens on the window,
 * passively, and never stops anything reaching the page. Touch and pen are
 * ignored; leaving the box or the window lets the picture settle.
 */
function useLean(target: RefObject<HTMLElement | null>, enabled: boolean) {
  const lean = useRef<Lean>({ x: 0, y: 0, at: -Infinity })
  useEffect(() => {
    const state = lean.current
    const settle = () => {
      state.x = 0
      state.y = 0
    }
    if (!enabled) {
      settle()
      return
    }
    const aim = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return
      const box = target.current?.getBoundingClientRect()
      if (!box || box.width === 0 || box.height === 0) return
      const x = ((event.clientX - box.left) / box.width) * 2 - 1
      const y = ((event.clientY - box.top) / box.height) * 2 - 1
      const inside = Math.abs(x) <= 1 && Math.abs(y) <= 1
      state.x = inside ? x : 0
      state.y = inside ? y : 0
      state.at = performance.now()
    }
    const leave = (event: PointerEvent) => {
      if (event.relatedTarget === null) settle()
    }
    window.addEventListener('pointermove', aim, { passive: true })
    window.addEventListener('pointerout', leave, { passive: true })
    window.addEventListener('blur', settle)
    return () => {
      window.removeEventListener('pointermove', aim)
      window.removeEventListener('pointerout', leave)
      window.removeEventListener('blur', settle)
      settle()
    }
  }, [target, enabled])
  return lean
}

/**
 * Renderers by canvas. R3F asks for a renderer on every configure until one
 * has resolved, so a re-render during `init()` would otherwise build a second
 * one — and nothing would ever dispose the first.
 */
const renderers = new WeakMap<object, Promise<WebGPURenderer>>()

export function DataTransferScene({ className }: DataTransferSceneProps) {
  const still = useReducedMotion()
  const root = useRef<HTMLDivElement>(null)
  const onScreen = useOnScreen(root)
  const pageShown = usePageShown()
  const lean = useLean(root, !still)
  const [drawn, setDrawn] = useState(false)
  const [failure, setFailure] = useState<Error | null>(null)

  const markDrawn = useCallback(() => setDrawn(true), [])

  const makeRenderer = useCallback(
    (defaults: { canvas: unknown }) => {
      const canvas = defaults.canvas as HTMLCanvasElement
      const known = renderers.get(canvas)
      if (known) return known
      const made = (async () => {
        const renderer = new WebGPURenderer({
          canvas,
          antialias: false,
          alpha: true,
          powerPreference: 'low-power',
        })
        // A lost device (driver reset, a GPU switch) would leave a frozen
        // picture; hand it to the error boundary, which shows the still.
        renderer.onDeviceLost = (info) => {
          setFailure(new Error(`The transfer scene lost its GPU device: ${info.message}`))
        }
        try {
          await renderer.init()
        } catch (error) {
          renderer.dispose()
          setFailure(error instanceof Error ? error : new Error(String(error)))
          // R3F does not catch a failed renderer; the boundary takes over from
          // here and unmounts the canvas, so this simply never settles.
          return new Promise<never>(() => {})
        }
        return renderer
      })()
      renderers.set(canvas, made)
      return made
    },
    [],
  )

  if (failure) throw failure

  return (
    <div
      ref={root}
      aria-hidden
      className={className ? `transfer-scene ${className}` : 'transfer-scene'}
    >
      {/* The same still the fallback shows, held underneath until the canvas
          has drawn, so arriving never flashes an empty box. */}
      <div className="transfer-scene__frame">
        <img className="transfer-scene__picture" src={COLOR_MAP} alt="" draggable={false} />
      </div>
      <div className="transfer-scene__live" data-drawn={drawn ? '' : undefined}>
        <Canvas dpr={[1, DPR_CAP]} flat linear frameloop="demand" gl={makeRenderer}>
          <Picture
            still={still}
            running={!still && onScreen && pageShown}
            lean={lean}
            onDrawn={markDrawn}
          />
          <DisposeRenderer />
        </Canvas>
      </div>
    </div>
  )
}

export default DataTransferScene
