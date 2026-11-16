import { describe, expect, it } from 'vitest'
import jojoRobot from '@/components/brand/JojoRobot.tsx?raw'
import robotScene from '@/components/brand/RobotScene.tsx?raw'
import model from '@/assets/jojo-robot.glb?url'
import source from '../../../scripts/robot/prepare_model.py?raw'
import { BONE_NAMES, EYE_RGB } from '@/lib/robot-rig'

/**
 * The sidebar mascot (G6). Protected design — the 3D robot, its size and its
 * motion are the owner's; these pin the requests that shaped it, so none of
 * them can quietly come undone. They were first written against the Spline
 * scene this robot replaced, and carry over request for request.
 *
 * Source reads (D20: no mounting, and there is no WebGL in a test anyway).
 * The robot's numbers — gestures, gaze, blink — are tested for real in
 * `lib/robot-rig.test.ts`; this pins the wiring around them.
 */
const strip = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const robot = strip(jojoRobot)
const scene = strip(robotScene)

/** The `onReady` handler, to the render below it. */
const onReady = robot.slice(
  robot.indexOf('const onReady = '),
  robot.indexOf('  return (', robot.indexOf('const onReady = ')),
)

/** The frame loop. */
const frame = scene.slice(
  scene.indexOf('useFrame('),
  scene.indexOf('  return (', scene.indexOf('useFrame(')),
)

describe('the 3D mascot', () => {
  it('renders the 3D robot, a licensed model served from this app (Q015, Q149)', () => {
    // The scene, lazily, as its own chunk.
    expect(robot).toMatch(/lazy\(\(\) => import\('@\/components\/brand\/RobotScene'\)\)/)
    expect(robot).toMatch(/<RobotScene\b/)
    // The model is this app's own file, imported so Vite fingerprints it and
    // resolves it under the Pages base path — the 404 Q149 was about.
    expect(scene).toMatch(/import ROBOT from '@\/assets\/jojo-robot\.glb\?url'/)
    expect(scene).toMatch(/useLoader\(GLTFLoader, ROBOT\)/)
    expect(model).toMatch(/\.glb$/)
    // And nothing else is fetched: no remote address, no public-folder path.
    expect(scene).not.toMatch(/publicUrl|fetch\(|https?:\/\/|\.splinecode|\.hdr/)
    // drei's <Environment> carries a CDN address for its HDR presets; the
    // studio is baked from panels in code instead.
    expect(scene).not.toMatch(/@react-three\/drei/)
    expect(scene).toMatch(/new PMREMGenerator\(gl\)/)
  })

  it('hangs the eyes at the middle of the visor, not on its slope toward the chin (Q317)', () => {
    // 3.5 cm above the head bone read as eyes at the nose. The visor faces
    // straight ahead 6–7 cm up (ray casts in prepare_model.py); its middle is 8.
    const rise = Number(/^EYE_RISE = ([\d.]+)$/m.exec(source)?.[1])
    expect(rise).toBeGreaterThanOrEqual(0.07)
    expect(rise).toBeLessThanOrEqual(0.09)
  })

  it('agrees with the model preparation on every joint it drives', () => {
    // The scene throws if a bone or its pivot is missing; this catches a
    // rename first. Every bone the rig turns must have its true pivot
    // recorded by prepare_model.py — without one, an arm would turn about
    // the origin, where the skin data parks it.
    const driven = /DRIVEN = \(([\s\S]*?)\)/.exec(source)?.[1] ?? ''
    const recorded = new Set([...driven.matchAll(/'([^']+)'/g)].map((m) => m[1]))
    const names = Object.values(BONE_NAMES)
    expect(names.length).toBeGreaterThan(10)
    for (const name of names) expect(recorded.has(name), name).toBe(true)
    // And the two anchors the scene hangs things from are the ones the script adds.
    for (const anchor of ['eyes', 'pivots']) {
      expect(source).toMatch(new RegExp(`bpy\\.data\\.objects\\.new\\('${anchor}'`))
      expect(scene).toMatch(new RegExp(`getObjectByName\\('${anchor}'\\)`))
    }
  })

  it('loads the model inside its own boundary, so the canvas loop keeps running', () => {
    // Suspending the canvas root as it mounted left R3F's loop inactive: four
    // frames, then an empty card with no error anywhere.
    expect(scene).toMatch(/<Suspense fallback=\{null\}>\s*<Robot\b/)
  })

  it('keeps the eye light under the tone curve’s clip, so it stays cyan', () => {
    // Drawn past the tone curve, a channel over 1 clips: at 6 the old robot's
    // cyan eyes rendered pure white.
    expect(scene).toMatch(/const EYE_COLOUR = new Color\(\.\.\.EYE_RGB\)/)
    expect(EYE_RGB).toHaveLength(3)
    for (const c of EYE_RGB) {
      expect(c).toBeGreaterThanOrEqual(0)
      expect(c).toBeLessThanOrEqual(1)
    }
    expect(scene).toMatch(/toneMapped: false/)
  })

  it('follows the cursor across the whole page, not just its card (Q016)', () => {
    expect(scene).toMatch(/window\.addEventListener\('pointermove', onMove/)
    expect(frame).toMatch(/gazeFor\(s\.pointer\.dx, s\.pointer\.dy\)/)
  })

  it('drives its own scripted gestures through the rig (Q031)', () => {
    // A play() restarts on seq, and the curve is the rig's.
    expect(scene).toMatch(/\}, \[pose, seq, still, clock\]\)/)
    expect(frame).toMatch(/gestureOffset\(s\.gesture\.pose, t\)/)
  })

  it('never lets idle cut a gesture short (Q031)', () => {
    // `idle` is the provider saying a gesture's time is up, on a clock that
    // runs ahead of the scene's; honouring it snapped the old robot upright
    // mid-bow. The gesture ends when its own curve does.
    expect(scene).toMatch(/if \(still \|\| pose === 'idle'\) return/)
    expect(frame).toMatch(/if \(t >= 1\) \{\s*s\.gesture = null/)
  })

  it('blends an interrupted gesture instead of snapping (Q031)', () => {
    // The body is damped toward the gesture's target, so a new gesture
    // starting from rest eases out of wherever the old one had got to.
    expect(frame).toMatch(/s\.body\.rx = damp\(s\.body\.rx, target\.rx/)
    // And a finished spin is folded back, not unwound.
    expect(frame).toMatch(/s\.body\.ry = wrapAngle\(s\.body\.ry\)/)
  })

  it('does not show the 2D robot while the 3D one is still loading (Q032)', () => {
    expect(robot).toMatch(/useState<'none' \| 'spinner' \| 'fallback'>\(/)
    expect(robot).toMatch(/hasWebGL\(\) \? 'none' : 'fallback'/)
    expect(robot).toMatch(/waiting === 'fallback' \?\s*\(\s*<RobotMascot\b/)
    expect(robot.match(/<RobotMascot\b/g)).toHaveLength(1)
    const fallbackMs = Number(/const FALLBACK_MS = (\d+)/.exec(robot)?.[1])
    expect(fallbackMs).toBeGreaterThanOrEqual(5000)
  })

  it('greets once per scene, so the arrival does not shake (Q083)', () => {
    // Two loads in dev (StrictMode) each scheduled a bow, ~200 ms apart, and
    // the second interrupted the first. The pending one is cleared first.
    const clearAt = onReady.indexOf('clearTimeout(greeting.current)')
    const greetAt = onReady.indexOf("play('bow')")
    expect(clearAt).toBeGreaterThan(-1)
    expect(greetAt).toBeGreaterThan(clearAt)
  })

  it('lets the robot finish rising into place before the greeting (Q083)', () => {
    expect(onReady).toMatch(/setTimeout\(\(\) => play\('bow'\), GREET_MS\)/)
    expect(robot).toMatch(/const GREET_MS = Math\.round\(INTRO_S \* 1000\)/)
    expect(frame).toMatch(/introProgress\(age\)/)
  })

  it('opens with the camera zoom-out, and always lands it (Q083)', () => {
    // The owner asked for the old robot's zoom-out back; this one has its own.
    expect(frame).toMatch(
      /camera\.position\.set\(\.\.\.lerp3\(CAMERA_FROM, CAMERA_REST, arrive\)\)/,
    )
    // Written until the resting frame has been — a load stall that skipped
    // past the end left the camera parked close on the face for good.
    expect(frame).toMatch(/s\.landed = arrive >= 1/)
    // And timed in rendered frames, so a stall pauses it rather than cutting.
    expect(frame).toMatch(/s\.age \+= Math\.min\(delta, 1 \/ 30\)/)
  })

  it('keeps the 3D robot under reduced motion, and holds it still', () => {
    expect(robot).toMatch(/still=\{reduced\}/)
    // One frame on demand, and every motion source gated.
    expect(scene).toMatch(/frameloop=\{still \? 'demand'/)
    expect(scene).toMatch(/const gaze =\s*s\.pointer && !still/)
    expect(frame).toMatch(/const idle = still \?/)
  })

  it('hands over to the 2D mascot when the scene cannot run, rather than an empty card', () => {
    expect(robot).toMatch(/<ErrorBoundary\b[\s\S]*setFailed\(true\)/)
    expect(robot).toMatch(/useState\(\(\) => !hasWebGL\(\)\)/)
  })

  it('renders no frames while the card is off screen', () => {
    expect(robot).toMatch(/active=\{onScreen\}/)
    expect(scene).toMatch(/active \? 'always' : 'never'/)
  })
})
