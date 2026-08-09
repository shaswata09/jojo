import { Suspense, useEffect, useMemo } from 'react'
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
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
} from 'three/tsl'
import {
  MeshBasicNodeMaterial,
  RenderPipeline,
  Vector2,
  WebGPURenderer,
  type Texture,
} from 'three/webgpu'
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
function Scene({ scaleFactor, reduced }: SceneProps) {
  const [rawMap, depthMap] = useTexture([COLOR_MAP, DEPTH_MAP]) as [Texture, Texture]

  const { material, uPointer, uProgress } = useMemo(() => {
    const uPointer = uniform(new Vector2(0, 0))
    const uProgress = uniform(FROZEN_PROGRESS)

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

    const mask = dot.mul(flow)

    const final = blendScreen(tMap, mask.mul(vec3(10, 0, 0)))

    const material = new MeshBasicNodeMaterial({ colorNode: final })

    return { material, uPointer, uProgress }
  }, [rawMap, depthMap])

  // Both textures outlive React's tree unless something says otherwise: they are
  // cached by drei's loader, so only the material is ours to free.
  useEffect(() => () => material.dispose(), [material])

  useFrame(({ clock, pointer }) => {
    uPointer.value.set(pointer.x, pointer.y)
    // Reduced motion freezes the sweep, not the parallax: the sweep is a
    // large-area pulse running unprompted, which is the thing the setting is
    // about. The parallax is one percent of a UV and only moves when the
    // viewer's own hand does.
    if (!reduced) uProgress.value = sweep(clock.getElapsedTime())
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
        <Scene scaleFactor={scaleFactor} reduced={reduced} />
      </Suspense>
    </Canvas>
  )
}

export default DataTransferScene
