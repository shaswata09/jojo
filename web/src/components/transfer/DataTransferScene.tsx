import { Suspense, useEffect, useMemo, useRef } from 'react'
import { useAspect, useTexture } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js'
import {
  abs,
  blendScreen,
  emissive,
  float,
  Fn,
  mrt,
  mx_cell_noise_float,
  oneMinus,
  output,
  pass,
  screenUV,
  mix,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
} from 'three/tsl'
import {
  DataTexture,
  MeshBasicNodeMaterial,
  NearestFilter,
  RedFormat,
  RenderPipeline,
  UnsignedByteType,
  Vector2,
  WebGPURenderer,
  type Texture,
} from 'three/webgpu'
import { PULSE_DIM, PULSE_FPS, PULSE_GRID, type PulseFrame } from '@jojo/service/core/pulse'
import { useReducedMotion } from '@/lib/use-media-query'
import { COLOR_MAP, DEPTH_MAP, MAP_HEIGHT, MAP_WIDTH } from './textures'

/**
 * How far the colour map slides against the depth map, in UV units.
 *
 * One percent. It looks like nothing written down and it is the entire effect:
 * push it to 0.05 and the picture stops being a photograph with depth and
 * starts being a rubber sheet.
 */
const PARALLAX_STRENGTH = 0.01

/** Dot grid density, in cells across the plane. */
const TILING = vec2(120.0)

/** Half-width of the band the flow sweeps through, in depth units. */
const FLOW_FEATHER = 0.02

/*
 * ---------------------------------------------------------------------------
 * Carrying the key
 * ---------------------------------------------------------------------------
 *
 * The scene is already a lattice of red dots. `core/pulse.ts` divides the plane
 * into a 12x12 grid and says, per frame, which regions are lit — so the picture
 * does not need anything drawn ON it to carry a key. The dots it is made of are
 * the signal, brightened and dimmed in blocks, and a phone reads it back with
 * `core/pulse-read.ts`.
 *
 * That is the whole reason there is no code square anywhere on this panel. A
 * symbol pasted over the animation would have been faster to build and would
 * have looked like exactly what it was.
 *
 * ## The three numbers below, and why they are not the idle ones
 *
 * While a key is showing, this stops being decoration and becomes a channel
 * pointed at a camera lens. Everything the idle scene does for looks works
 * against that:
 *
 * The idle band pushes red to `vec3(10, 0, 0)` so bloom has something well past
 * its threshold to catch. Ten times over is fine for one thin sweeping band and
 * ruinous for a grid of bits: a dim region at 0.2 x 10 is still 2.0, which
 * clamps to full red on screen exactly like a lit one at 10. Both regions
 * arrive at the camera saturated and the contrast the reader needs is gone.
 *
 * So `PULSE_PUNCH` replaces the overshoot with barely any. Lit regions still
 * reach the top of the range; dim ones land near a fifth of it — the same
 * ratio the synthesised photograph in `core/pulse-seam.test.ts` decodes from,
 * which is what makes that test evidence about this shader rather than about
 * an arbitrary pair of greys.
 *
 * And the photograph itself is a varying background under a signal that is read
 * by thresholding region averages. `PULSE_PICTURE` takes it most of the way
 * down while a key is up. Not to black: the sculpture staying faintly visible
 * is what keeps this recognisable as the same animation rather than a code
 * screen that replaced it.
 */

/*
 * `PULSE_DIM` — how bright a dimmed region is against a lit one — is imported
 * rather than declared. It is the one number here the phone's decoder also
 * depends on, so it lives beside the protocol in `core/pulse.ts` along with the
 * reasoning for its value.
 */

/** The red multiplier while carrying data. Compare `vec3(10, 0, 0)` idle. */
const PULSE_PUNCH = 1.6

/** How much of the photograph survives underneath the key. */
const PULSE_PICTURE = 0.12


/**
 * Where the flow band parks when the viewer has asked for reduced motion — and
 * the first-frame value of both sweep uniforms.
 *
 * Mid-travel rather than 0 or 1: at either end the band sits off the depth
 * range entirely and the scene loses the red accent that makes it read as a
 * transfer at all. This keeps the still frame representative of the moving one.
 */
const FROZEN_PROGRESS = 0.5

/** `sin(t * 0.5) * 0.5 + 0.5` — one full there-and-back every ~12.6s. */
function sweep(elapsed: number) {
  return Math.sin(elapsed * 0.5) * 0.5 + 0.5
}


type SceneProps = {
  scaleFactor: number
  reduced: boolean
  frames: readonly PulseFrame[] | null
}

/**
 * The plane: depth parallax, a cell-noise dot grid, and a flow band that walks
 * through the depth map and lights the dots it passes.
 *
 * The band is pushed to `vec3(10, 0, 0)` — red, ten times over. Nothing on
 * screen is that bright; the overshoot exists so the emissive MRT target has
 * something well past the bloom threshold to catch, which is what turns a hard
 * red edge into a glow.
 */
function Scene({ scaleFactor, reduced, frames }: SceneProps) {

  const [rawMap, depthMap] = useTexture([COLOR_MAP, DEPTH_MAP]) as [Texture, Texture]

  /**
   * One byte per region, 0 or 255, uploaded straight to the GPU.
   *
   * `NearestFilter` on both axes is `DataTexture`'s own default and is set here
   * anyway, because it is load-bearing rather than incidental: linear filtering
   * would interpolate between neighbouring regions and smear every boundary
   * into a ramp, which is precisely the edge a reader measuring region averages
   * needs to be sharp. Written down so a later change to "improve" the look
   * has to argue with a sentence.
   *
   * `RedFormat` because a bit is one channel and there is no reason to send
   * four.
   *
   * Built once and mutated in place: a new texture per frame at six frames a
   * second would mean a GPU allocation and a shader recompile for every bit
   * pattern.
   */
  const pulseTexture = useMemo(() => {
    const tex = new DataTexture(
      new Uint8Array(PULSE_GRID * PULSE_GRID),
      PULSE_GRID,
      PULSE_GRID,
      RedFormat,
      UnsignedByteType,
    )
    tex.magFilter = NearestFilter
    tex.minFilter = NearestFilter
    tex.needsUpdate = true
    return tex
  }, [])

  const { material, uPointer, uProgress, uPulse } = useMemo(() => {
    const uPointer = uniform(new Vector2(0, 0))
    const uProgress = uniform(FROZEN_PROGRESS)
    /** 0 idle, 1 while a key is on screen. Mixed, never branched on. */
    const uPulse = uniform(0)

    const strength = PARALLAX_STRENGTH

    const tDepthMap = texture(depthMap)
    const tMap = texture(rawMap, uv().add(tDepthMap.r.mul(uPointer).mul(strength)))

    const tiling = TILING
    const tiledUv = uv().mul(tiling).mod(2).sub(1)

    const brightness = mx_cell_noise_float(uv().mul(tiling).div(2))

    const dist = float(tiledUv.length())
    const dot = float(smoothstep(0.5, 0.49, dist)).mul(brightness)

    // `.r`, not the whole sample: the depth map is greyscale, and comparing a
    // vec4 against a scalar leaves the flow as a vec4 that then will not
    // multiply cleanly against the vec3 tint below. Same pixels, one channel.
    const depth = tDepthMap.r
    const flow = oneMinus(smoothstep(0, FLOW_FEATHER, abs(depth.sub(uProgress))))

    /*
     * The key, sampled per region.
     *
     * Y is flipped because the two conventions disagree and nothing would say
     * so. `DataTexture` sets `flipY = false` — unlike an image-backed texture,
     * which sets it true — so row 0 of the buffer sits at v = 0, and v = 0 is
     * the BOTTOM of the plane. `PulseFrame[y][x]` counts rows from the top the
     * way an image does. Sampling at `1 - v` puts frame row 0 back at the top.
     *
     * Get this wrong and the frame is
     * still perfectly readable — mirrored. `pulse-read.ts` tries the four
     * ROTATIONS a phone might be held at and does not try reflections, quite
     * rightly, because a reflected frame means the sender is wrong rather than
     * the holder. So it would simply never decode, at any angle, with no clue
     * on either screen as to why.
     */
    const region = texture(pulseTexture, vec2(uv().x, oneMinus(uv().y))).r
    const carried = mix(float(PULSE_DIM), float(1), region)

    // What decides whether a dot is lit: the sweeping band when idle, the key
    // when one is up. Mixed rather than branched, so there is one shader and no
    // recompile at the moment a transfer starts.
    const lit = mix(flow, carried, uPulse)
    const punch = mix(float(10), float(PULSE_PUNCH), uPulse)
    const picture = tMap.mul(mix(float(1), float(PULSE_PICTURE), uPulse))

    const mask = dot.mul(lit)

    const scene = blendScreen(picture, mask.mul(vec3(punch, 0, 0)))

    const final = scene

    const material = new MeshBasicNodeMaterial({ colorNode: final })

    return { material, uPointer, uProgress, uPulse }
  }, [rawMap, depthMap, pulseTexture])

  // Both textures outlive React's tree unless something says otherwise: they are
  // cached by drei's loader, so only the material is ours to free. The pulse
  // texture is this component's own and is not.
  useEffect(() => () => material.dispose(), [material])
  useEffect(() => () => pulseTexture.dispose(), [pulseTexture])

  /** Which frame is on screen, so the texture is only rewritten when it changes. */
  const shown = useRef(-1)
  useEffect(() => {
    // A new key starts at its first frame rather than wherever the clock
    // happens to be, and a key going away leaves nothing stale behind.
    shown.current = -1
  }, [frames])

  useFrame(({ clock, pointer }) => {
    uPointer.value.set(pointer.x, pointer.y)
    // Reduced motion freezes the sweep, not the parallax: the sweep is a
    // large-area pulse running unprompted, which is the thing the setting is
    // about. The parallax is one percent of a UV and only moves when the
    // viewer's own hand does.
    if (!reduced) uProgress.value = sweep(clock.getElapsedTime())

    if (frames === null || frames.length === 0) {
      uPulse.value = 0
      return
    }

    /*
     * The key keeps cycling under reduced motion, and that is not an oversight.
     *
     * The setting is about movement nobody asked for. This is the only way the
     * other device can be told the key, it lasts under two seconds, and it runs
     * because the person pressed a button asking for it. Freezing it would show
     * one frame in ten of a key forever — a transfer that cannot complete, for
     * the viewers who can least afford to be told nothing about why.
     */
    uPulse.value = 1
    const index = Math.floor(clock.getElapsedTime() * PULSE_FPS) % frames.length
    if (index === shown.current) return
    shown.current = index

    const frame = frames[index]
    if (frame === undefined) return
    const data = pulseTexture.image.data as Uint8Array
    for (let y = 0; y < PULSE_GRID; y += 1) {
      for (let x = 0; x < PULSE_GRID; x += 1) {
        data[y * PULSE_GRID + x] = frame[y]?.[x] === true ? 255 : 0
      }
    }
    pulseTexture.needsUpdate = true
  })

  const [w, h] = useAspect(MAP_WIDTH, MAP_HEIGHT, scaleFactor)

  return (
    <mesh scale={[w, h, 1]}>
      <planeGeometry />
      <primitive object={material} attach="material" />
    </mesh>
  )
}

type PostProcessingProps = {
  strength?: number
  threshold?: number
  fullScreenEffect: boolean
  reduced: boolean
}

/**
 * Bloom over an emissive MRT target, plus the full-screen scan line.
 *
 * `RenderPipeline`, not `PostProcessing`: three renamed the class in r183 and
 * the old name now only exists to print a deprecation warning on construction.
 * Same class, same behaviour, no console noise.
 */
function PostProcessing({
  strength = 1,
  threshold = 1,
  fullScreenEffect,
  reduced,
}: PostProcessingProps) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)

  const uScan = useMemo(() => uniform(FROZEN_PROGRESS), [])

  const pipeline = useMemo(() => {
    const post = new RenderPipeline(gl as unknown as WebGPURenderer)

    const scenePass = pass(scene, camera)
    scenePass.setMRT(mrt({ output, emissive }))

    const outputPass = scenePass.getTextureNode('output')
    const emissivePass = scenePass.getTextureNode('emissive')

    // A hard, thin line with a soft shoulder, sitting on top of the render
    // before bloom sees it — so the bloom pass smears the line as well as the
    // plane, and the two read as one beam rather than a decal over a scene.
    const scanLine = Fn(() => {
      const distance = abs(screenUV.y.oneMinus().sub(uScan))
      const line = oneMinus(smoothstep(0, 0.006, distance))
      return line.mul(vec3(10, 0, 0))
    })

    // Reduced motion drops the full-screen line rather than parking it: frozen,
    // it is a red bar lying across the middle of whatever copy sits on top of
    // the scene, which is an artefact nobody asked for rather than a still
    // frame of the animation. The plane's own flow band stays — frozen it reads
    // as a contour on the sculpture, so the scene still looks like itself.
    //
    // The line is dropped under the setting even while a beam is running. The
    // band on the plane already carries the beam's position, and that one is
    // bounded by the sculpture; this one crosses the whole card, including the
    // text on top of it.
    const showScan = fullScreenEffect && !reduced

    const lit = showScan ? outputPass.add(scanLine()) : outputPass
    const bloomPass = bloom(lit.add(emissivePass), strength, 0.5, threshold)

    post.outputNode = lit.add(bloomPass)
    return post
  }, [gl, scene, camera, strength, threshold, fullScreenEffect, reduced, uScan])

  useEffect(() => () => pipeline.dispose(), [pipeline])

  // Priority > 0 takes the frame loop off R3F's own render call — otherwise the
  // scene would be drawn twice a frame and the post output immediately
  // overwritten by the raw one.
  useFrame(({ clock }) => {
    if (!reduced) uScan.value = sweep(clock.getElapsedTime())
    pipeline.render()
  }, 1)

  return null
}

export type DataTransferSceneProps = {
  className?: string
  /** Multiplies the plane's viewport-fitted size. 1 fills the frame. */
  scaleFactor?: number
  /** Whether the red scan line sweeps the whole canvas or only the plane. */
  fullScreenEffect?: boolean
  /**
   * The key, as frames of the animation, or null when nothing is being sent.
   *
   * The scene's own dots carry it. See the note above `PULSE_DIM` for what
   * changes about the picture while one is up, and why.
   */
  frames?: readonly PulseFrame[] | null
}

/**
 * The WebGPU transfer animation.
 *
 * Mount this only where WebGPU is known to be available — it drags in
 * `three/webgpu`, which is several hundred kilobytes, and `WebGPURenderer.init()`
 * rejects outright without an adapter. `LazyDataTransferScene` does both the
 * capability check and the code-splitting; prefer it unless you have already
 * done the check yourself.
 */
export function DataTransferScene({
  className,
  scaleFactor = 1,
  fullScreenEffect = true,
  frames = null,
}: DataTransferSceneProps) {
  const reduced = useReducedMotion()

  return (
    <Canvas
      className={className}
      // `flat` keeps tone mapping off. The shader deliberately pushes the flow
      // band past 1.0 for bloom to find; ACES would pull it straight back and
      // the glow would never happen.
      flat
      gl={async (props) => {
        const renderer = new WebGPURenderer(
          props as ConstructorParameters<typeof WebGPURenderer>[0],
        )
        await renderer.init()
        return renderer
      }}
    >
      {/* The textures suspend. PostProcessing must stay outside that boundary:
          its render pass is what puts anything on screen at all, and suspending
          it would leave a blank canvas until the images land. */}
      <PostProcessing fullScreenEffect={fullScreenEffect} reduced={reduced} />
      <Suspense fallback={null}>
        <Scene scaleFactor={scaleFactor} reduced={reduced} frames={frames} />
      </Suspense>
    </Canvas>
  )
}

export default DataTransferScene
