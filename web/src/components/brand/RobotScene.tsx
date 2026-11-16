import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import {
  AdditiveBlending,
  Bone,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  FrontSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  Scene,
  ShaderMaterial,
  SpotLight,
  Vector3,
  type Object3D,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import ROBOT from '@/assets/jojo-robot.glb?url'
import type { MascotPose } from '@/lib/mascot-context'
import {
  BONE_KEYS,
  BONE_NAMES,
  CAMERA_FROM,
  CAMERA_REST,
  LOOK_FROM,
  LOOK_REST,
  NEUTRAL_FACE,
  REST,
  blinkDelay,
  breath,
  damp,
  eyeOpen,
  EYE_GLANCE,
  EYE_RGB,
  GAZE_SPEED,
  gazeFor,
  gestureBones,
  gestureFace,
  gestureOffset,
  gestureSeconds,
  introProgress,
  lerp3,
  restBones,
  wrapAngle,
  type BodyOffset,
  type BoneKey,
  type BoneOffsets,
  type Face,
} from '@/lib/robot-rig'

/**
 * jojo's robot.
 *
 * The model is "Sci-fi O.B. Robot Unit TH-ICC02 (animated)" by Jungle Jim,
 * licensed CC BY 4.0 (credited on the Built with page and in
 * THIRD-PARTY-NOTICES), prepared for the web by
 * `web/scripts/robot/prepare_model.py`: lighter mesh and textures, its own
 * animation removed, and one anchor added at the front of the visor. It is
 * served from this origin like any other asset, so nothing about showing it
 * leaves the device.
 *
 * This file lights it, moves its skeleton, and draws its eyes. How it moves —
 * the gestures, the gaze, the idle — is `lib/robot-rig.ts`, pure and tested;
 * every rotation there is written in the robot's own frame and turned into
 * each bone's local rotation here.
 */

export type RobotSceneProps = {
  pose: MascotPose
  /** Bumped on every `play()`, so replaying the same pose restarts it. */
  seq: number
  /** Holds every motion: no idle, no tracking, no gestures. See JojoRobot. */
  still: boolean
  /** False while the card is off screen, so a hidden robot costs no frames. */
  active: boolean
  /** The first frame has been drawn. */
  onReady: () => void
  /** The arrival has finished: the robot has risen into place and the camera has pulled back. */
  onLanded: () => void
}

/**
 * The resting pose, from the artist's A-pose: arms in a little nearer the
 * body, carried slightly forward and bent at the elbow, head level. Offsets in
 * the robot's frame; every gesture is written from here.
 */
const REST_POSE: Partial<Record<BoneKey, [number, number, number]>> = {
  lUpper: [-0.1, 0, -0.22],
  rUpper: [-0.1, 0, 0.22],
  lFore: [-0.28, 0, 0],
  rFore: [-0.28, 0, 0],
  head: [0.04, 0, 0],
}

const EYE_COLOUR = new Color(...EYE_RGB)

/** The eyes, drawn on a patch that hugs the visor: two shapes from signed distances. */
const EYE_SHADER = {
  vertex: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragment: /* glsl */ `
    varying vec2 vUv;
    uniform vec2 uSize;
    uniform float uOpen;
    uniform float uSmile;
    uniform float uSquint;
    uniform float uWide;
    uniform float uLook;
    uniform float uHeart;
    uniform float uWink;
    uniform float uShut;
    uniform vec3 uColour;

    float box(vec2 p, vec2 b, float r) {
      vec2 q = abs(p) - b + r;
      return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
    }

    // A heart of side a: a square turned 45°, a circle on each upper edge.
    // Centred: its tip sits 0.78a below the middle and its lobes 0.78a above.
    float heart(vec2 p, float a) {
      p.y += 0.073 * a;
      vec2 q = vec2(p.x - p.y, p.x + p.y) * 0.70710678;
      float k = 0.35355339 * a;
      float lobes = min(length(p - vec2(-k, k)), length(p - vec2(k, k))) - 0.5 * a;
      return min(box(q, vec2(0.5 * a), 0.06 * a), lobes);
    }

    // One eye, in metres from its centre. Open: a tall rounded rectangle.
    // Wide: larger and rounder. Squint: shorter. Shut: a line. Smile: an arc
    // bowed up (a wink is a smile on one eye). Heart: a heart.
    float eye(vec2 p, float smile) {
      float w = 0.0165 * (1.0 + 0.25 * uWide);
      float h = 0.0215 * (1.0 + 0.3 * uWide) * mix(1.0, 0.32, uSquint * (1.0 - smile)) * max(uOpen * (1.0 - uShut), 0.07);
      float d = box(p, vec2(w, h), min(w, h) * 0.8);
      vec2 c = vec2(0.0, -0.013);
      float ring = abs(length(p - c) - 0.021) - 0.0048 * mix(1.0, 0.75, uSquint);
      float arc = max(ring, c.y + 0.004 - p.y);
      float e = mix(d, arc, smile);
      return mix(e, heart(p, 0.026), uHeart);
    }

    void main() {
      vec2 p = (vUv - 0.5) * uSize - vec2(uLook * 0.012, 0.0);
      float d = min(eye(p - vec2(-0.04, 0.0), uSmile), eye(p - vec2(0.04, 0.0), max(uSmile, uWink)));
      float core = 1.0 - smoothstep(-0.0006, 0.0008, d);
      float glow = exp(-max(d, 0.0) / 0.0045) * 0.32;
      float a = clamp(core + glow, 0.0, 1.0);
      gl_FragColor = vec4(uColour * a, a);
    }`,
}

type Rig = {
  root: Group
  bones: Record<BoneKey, Bone>
  /**
   * Each bone's rest transform, its parent's in the robot's frame, and the
   * joint it turns about. The pivot is read from the model's `pivots`
   * anchor, not from the bone: the skin data parks the arm bones at the
   * origin (see prepare_model.py), and an arm turned about the origin swings
   * round the robot's feet.
   */
  rest: Record<BoneKey, { local: Matrix4; parent: Matrix4; parentInv: Matrix4; pivot: Vector3 }>
  eyes: ShaderMaterial
}

/**
 * The loaded model, prepared for this scene: cloned with its skeleton, its
 * bones found by role, and the eyes hung on the visor.
 *
 * Cloned because `useLoader` caches the parse and StrictMode mounts the scene
 * twice in development — and with SkeletonUtils, because a plain clone of a
 * skinned mesh keeps pointing at the original's bones.
 */
function useRig(): Rig {
  const gltf = useLoader(GLTFLoader, ROBOT)
  return useMemo(() => {
    const model = cloneSkinned(gltf.scene)
    const root = new Group()
    root.add(model)
    root.updateMatrixWorld(true)

    const pivots = model.getObjectByName('pivots')?.userData as
      Record<string, [number, number, number]> | undefined
    if (!pivots) throw new Error('jojo-robot.glb has no "pivots" anchor')
    const bones = {} as Rig['bones']
    const rest = {} as Rig['rest']
    for (const key of BONE_KEYS) {
      const name = BONE_NAMES[key]
      const found = model.getObjectByName(name)
      if (!(found instanceof Bone)) throw new Error(`jojo-robot.glb has no bone "${name}"`)
      const at = pivots[name]
      if (!at) throw new Error(`jojo-robot.glb has no pivot for "${name}"`)
      bones[key] = found
      found.updateMatrix()
      const parent = found.parent ? found.parent.matrixWorld.clone() : new Matrix4()
      rest[key] = {
        local: found.matrix.clone(),
        parent,
        parentInv: parent.clone().invert(),
        pivot: new Vector3(...at),
      }
    }

    model.traverse((o) => {
      if (!(o instanceof Mesh)) return
      // The skinned bounds are computed from the bind pose; a hop or a spin
      // would carry the robot outside them and cull it mid-gesture.
      o.frustumCulled = false
      if (o.material instanceof MeshStandardMaterial) o.material.envMapIntensity = 1.1
    })

    const anchor = model.getObjectByName('eyes')
    if (!anchor) throw new Error('jojo-robot.glb has no "eyes" anchor')
    const eyes = new ShaderMaterial({
      vertexShader: EYE_SHADER.vertex,
      fragmentShader: EYE_SHADER.fragment,
      uniforms: {
        uSize: { value: [0.16, 0.085] },
        uOpen: { value: 1 },
        uSmile: { value: 0 },
        uSquint: { value: 0 },
        uWide: { value: 0 },
        uLook: { value: 0 },
        uHeart: { value: 0 },
        uWink: { value: 0 },
        uShut: { value: 0 },
        uColour: { value: EYE_COLOUR },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
      side: FrontSide,
    })
    // The anchor carries the rig's own orientation and its 100× scale (the
    // artist's file is in centimetres). A level, unit-scaled frame under it
    // puts the eyes in the robot's frame: x across, y up, z out of the visor.
    const frame = new Group()
    anchor.add(frame)
    frame.quaternion.copy(anchor.getWorldQuaternion(new Quaternion()).invert())
    frame.scale.setScalar(1 / anchor.getWorldScale(new Vector3()).x)
    const radius = Number(anchor.userData.visor_radius_x) || 0.115
    const tilt = Number(anchor.userData.visor_tilt) || 0
    const width = 0.16
    const lift = 0.004
    // A strip of a cylinder on the visor's own curve, a few millimetres proud of the glass.
    const patch = new Mesh(
      new CylinderGeometry(
        radius + lift,
        radius + lift,
        0.085,
        32,
        1,
        true,
        -width / radius / 2,
        width / radius,
      ),
      eyes,
    )
    patch.position.set(0, 0, -radius)
    patch.renderOrder = 2
    const tipped = new Group()
    tipped.rotation.x = -tilt
    tipped.add(patch)
    frame.add(tipped)

    return { root, bones, rest, eyes }
  }, [gltf])
}

type Motion = {
  /** The current gesture, and when (in clock seconds) it started. */
  gesture: { pose: MascotPose; start: number } | null
  /** Pointer offset from the robot's centre, CSS px; null until it moves. */
  pointer: { dx: number; dy: number } | null
  /** The body's damped offset, so an interrupted gesture blends, not snaps. */
  body: BodyOffset
  /** Each bone's damped gesture offset, for the same reason. */
  bones: BoneOffsets
  face: Face
  head: { yaw: number; pitch: number }
  bodyYaw: number
  arms: { l: number; r: number; lv: number; rv: number }
  lastBodyY: number
  nextBlink: number
  blinkAt: number
  /** Rendered seconds since the first frame; see the frame loop. */
  age: number
  /** The zoom-out has written its resting frame. */
  landed: boolean
}

/**
 * What the frame loop reads when no gesture is running. Frozen and shared, so
 * an idle robot allocates nothing per frame: the loop runs 60 times a second
 * for as long as the page is open, and only reads these.
 */
const REST_BONES: Readonly<BoneOffsets> = Object.freeze(restBones())
const LEVEL_GAZE = Object.freeze({ headYaw: 0, headPitch: 0, bodyYaw: 0 })
const STILL_IDLE = Object.freeze({ lift: 0, sway: 0, chest: 0 })

/** How fast each expression follows its target, per second (see `damp`). */
const FACE_RATE = { smile: 14, squint: 14, wide: 14, heart: 12, wink: 16, shut: 10 } as const

const euler = new Euler(0, 0, 0, 'YXZ')
const turn = new Matrix4()
const shift = new Matrix4()
const local = new Matrix4()

/**
 * Sets a bone to its rest transform turned by `[x, y, z]` in the robot's
 * frame, about its joint: parent⁻¹ · T(p) · R · T(−p) · parent · rest, all at
 * rest, so the pivot rides on the parent however the parent has moved.
 */
function setBone(rig: Rig, key: BoneKey, x: number, y: number, z: number) {
  const r = rig.rest[key]
  const b = rig.bones[key]
  turn.makeRotationFromEuler(euler.set(x, y, z, 'YXZ'))
  local.copy(r.parentInv).multiply(shift.makeTranslation(r.pivot)).multiply(turn)
  local
    .multiply(shift.makeTranslation(-r.pivot.x, -r.pivot.y, -r.pivot.z))
    .multiply(r.parent)
    .multiply(r.local)
  local.decompose(b.position, b.quaternion, b.scale)
}

function Robot({ pose, seq, still, onReady, onLanded }: Omit<RobotSceneProps, 'active'>) {
  const rig = useRig()
  const { gl, clock, invalidate, camera } = useThree()

  const motion = useRef<Motion>({
    gesture: null,
    pointer: null,
    body: { ...REST },
    bones: restBones(),
    face: { ...NEUTRAL_FACE },
    head: { yaw: 0, pitch: 0 },
    bodyYaw: 0,
    arms: { l: 0, r: 0, lv: 0, rv: 0 },
    lastBodyY: 0,
    nextBlink: blinkDelay(Math.random()),
    blinkAt: -1,
    age: 0,
    landed: false,
  })

  // A gesture starts on the clock the frame loop reads, so its curve and the
  // frames that draw it cannot disagree about when it began. `idle` is how the
  // provider says a gesture's time is up, never a request to cut one short.
  useEffect(() => {
    if (still || pose === 'idle') return
    motion.current.gesture = { pose, start: clock.getElapsedTime() }
  }, [pose, seq, still, clock])

  // Page-wide gaze (Q016): every pointer move on the window, measured from the
  // canvas's centre. The rect is read on the move, not every frame.
  useEffect(() => {
    if (still) return
    const onMove = (event: PointerEvent) => {
      const box = gl.domElement.getBoundingClientRect()
      if (!box.width) return
      motion.current.pointer = {
        dx: event.clientX - (box.left + box.width / 2),
        dy: event.clientY - (box.top + box.height * 0.3),
      }
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [gl, still])

  // Still: one frame, drawn on demand, and nothing after it.
  useEffect(() => {
    if (still) invalidate()
  }, [still, invalidate])

  const ready = useRef(false)

  useFrame((_, delta) => {
    const now = clock.getElapsedTime()
    const s = motion.current
    // Rendered time, not wall time: a stalled frame loop pauses the arrival
    // instead of cutting from its start to its end.
    s.age += Math.min(delta, 1 / 30)
    const age = s.age

    // --- gesture targets, damped so interruptions blend --------------------
    let target: BodyOffset = REST
    let boneTarget: Readonly<BoneOffsets> = REST_BONES
    let faceTarget: Face = NEUTRAL_FACE
    if (s.gesture) {
      const t = (now - s.gesture.start) / gestureSeconds(s.gesture.pose)
      target = gestureOffset(s.gesture.pose, t)
      boneTarget = gestureBones(s.gesture.pose, t)
      faceTarget = gestureFace(s.gesture.pose, t)
      if (t >= 1) {
        s.gesture = null
        // A spin ends at 2π. Folding it back to 0 here, where it is the same
        // angle, stops the damping unwinding a whole turn backwards.
        s.body.ry = wrapAngle(s.body.ry)
        target = REST
        boneTarget = REST_BONES
        faceTarget = NEUTRAL_FACE
      }
    }
    const fast = still ? 1000 : 22
    s.body.rx = damp(s.body.rx, target.rx, fast, delta)
    s.body.ry = damp(s.body.ry, target.ry, fast, delta)
    s.body.rz = damp(s.body.rz, target.rz, fast, delta)
    s.body.py = damp(s.body.py, target.py, fast, delta)
    s.body.pz = damp(s.body.pz, target.pz, fast, delta)
    s.body.sy = damp(s.body.sy, target.sy, fast, delta)
    for (const key of BONE_KEYS) {
      const b = s.bones[key]
      const g = boneTarget[key]
      b[0] = damp(b[0], g[0], fast, delta)
      b[1] = damp(b[1], g[1], fast, delta)
      b[2] = damp(b[2], g[2], fast, delta)
    }
    for (const key of Object.keys(FACE_RATE) as (keyof typeof FACE_RATE)[]) {
      s.face[key] = damp(s.face[key], faceTarget[key], FACE_RATE[key], delta)
    }

    // --- gaze ---------------------------------------------------------------
    const gaze = s.pointer && !still ? gazeFor(s.pointer.dx, s.pointer.dy) : LEVEL_GAZE
    s.head.yaw = damp(s.head.yaw, gaze.headYaw, GAZE_SPEED.head, delta)
    s.head.pitch = damp(s.head.pitch, gaze.headPitch, GAZE_SPEED.head, delta)
    s.bodyYaw = damp(s.bodyYaw, gaze.bodyYaw, GAZE_SPEED.body, delta)
    s.face.lookX = damp(
      s.face.lookX,
      faceTarget.lookX + gaze.headYaw * EYE_GLANCE,
      GAZE_SPEED.eyes,
      delta,
    )

    // --- idle -----------------------------------------------------------------
    const idle = still ? STILL_IDLE : breath(now)
    const arrive = still ? 1 : introProgress(age)
    // The zoom-out (Q083). Written until the resting frame has been written
    // once, then left alone, so a stall that carries the arrival past its end
    // in one frame still lands the camera.
    if (!s.landed) {
      camera.position.set(...lerp3(CAMERA_FROM, CAMERA_REST, arrive))
      camera.lookAt(...lerp3(LOOK_FROM, LOOK_REST, arrive))
      s.landed = arrive >= 1
      // Once, in rendered time: a slow machine that takes three seconds to
      // rise is greeted after three seconds, not mid-rise.
      if (s.landed) onLanded()
    }

    rig.root.position.set(0, s.body.py + idle.lift - (1 - arrive) * 0.18, s.body.pz)
    rig.root.rotation.set(s.body.rx, s.body.ry, s.body.rz + idle.sway * 0.3)
    const sc = 0.94 + 0.06 * arrive
    rig.root.scale.set(sc, sc * (1 + s.body.sy), sc)

    // --- arms: a little follow-through on top of whatever they are doing -----
    // A spring driven by how fast the body rises or falls and rolls: the arms
    // lag a hop and swing back on landing, and settle on their own.
    const vy = delta > 0 ? (s.body.py - s.lastBodyY) / delta : 0
    s.lastBodyY = s.body.py
    if (!still) {
      const push = Math.max(-3, Math.min(3, vy)) * 0.9 + s.body.rz * 2
      const k = 90
      const c = 11
      const step = Math.min(delta, 0.05)
      s.arms.lv += (-k * s.arms.l - c * s.arms.lv + push * 6) * step
      s.arms.l += s.arms.lv * step
      s.arms.rv += (-k * s.arms.r - c * s.arms.rv - push * 6) * step
      s.arms.r += s.arms.rv * step
    }

    // --- the skeleton ---------------------------------------------------------
    const swing = still ? 0 : Math.sin((now / 9) * Math.PI * 2 + 0.6) * 0.03
    const clampArm = (v: number) => Math.max(-0.25, Math.min(0.35, v))
    for (const key of BONE_KEYS) {
      const base = REST_POSE[key] ?? [0, 0, 0]
      const g = s.bones[key]
      let x = base[0] + g[0]
      let y = base[1] + g[1]
      let z = base[2] + g[2]
      if (key === 'head') {
        x += s.head.pitch * 0.7
        y += (s.head.yaw - s.bodyYaw) * 0.65
        z -= s.head.yaw * 0.08
      } else if (key === 'neck') {
        x += s.head.pitch * 0.3
        y += (s.head.yaw - s.bodyYaw) * 0.35
      } else if (key === 'chest') {
        x += idle.chest
        y += s.bodyYaw * 0.6
      } else if (key === 'waist') {
        y += s.bodyYaw * 0.4 + idle.sway
      } else if (key === 'lUpper') {
        x += swing
        z += clampArm(s.arms.l)
      } else if (key === 'rUpper') {
        x -= swing
        z -= clampArm(s.arms.r)
      }
      setBone(rig, key, x, y, z)
    }

    // --- eyes -------------------------------------------------------------------
    let open = 1
    if (!still) {
      if (s.blinkAt < 0 && age > s.nextBlink) s.blinkAt = now
      open = s.blinkAt < 0 ? 1 : eyeOpen(now - s.blinkAt)
      if (s.blinkAt >= 0 && now - s.blinkAt > 0.2) {
        s.blinkAt = -1
        s.nextBlink = age + blinkDelay(Math.random())
      }
    }
    const u = rig.eyes.uniforms
    u.uOpen!.value = open
    u.uSmile!.value = Math.min(1, s.face.smile)
    u.uSquint!.value = Math.min(1, s.face.squint)
    u.uWide!.value = Math.min(1, s.face.wide)
    u.uHeart!.value = Math.min(1, s.face.heart)
    u.uWink!.value = Math.min(1, s.face.wink)
    u.uShut!.value = Math.min(1, s.face.shut)
    u.uLook!.value = Math.max(-1, Math.min(1, s.face.lookX))

    if (!ready.current) {
      ready.current = true
      onReady()
    }
  })

  return <primitive object={rig.root} />
}

/**
 * The panels every glossy surface reflects: `[position, size, intensity, colour]`.
 *
 * Three, and large: a big softbox up and to the left (the key, matching the
 * card's spotlight sweep), a tall strip front right that draws one long line
 * down the visor, and one behind for the rim.
 */
const PANELS: [[number, number, number], [number, number], number, string][] = [
  [[-4, 5, 3], [3.5, 5], 5, '#ffffff'],
  [[3.2, 2.5, 3], [0.8, 8], 2.4, '#ffffff'],
  [[4, 3, -2.5], [1.2, 9], 2, '#ffffff'],
]

/**
 * A studio environment, baked once on the GPU from a handful of lit panels.
 *
 * Made with three's own `PMREMGenerator` rather than drei's `<Environment>`,
 * which brought three more packages into the robot's chunk and, as a string,
 * the CDN address its HDR presets are fetched from.
 */
function Studio() {
  const { gl, scene } = useThree()
  useEffect(() => {
    const studio = new Scene()
    const disposables: { dispose: () => void }[] = []
    for (const [position, size, intensity, colour] of PANELS) {
      const geometry = new PlaneGeometry(size[0], size[1])
      const material = new MeshBasicMaterial({
        color: new Color(colour).multiplyScalar(intensity),
        side: DoubleSide,
        toneMapped: false,
      })
      const mesh = new Mesh(geometry, material)
      mesh.position.set(...position)
      mesh.lookAt(0, 1.4, 0)
      studio.add(mesh)
      disposables.push(geometry, material)
    }
    const pmrem = new PMREMGenerator(gl)
    const target = pmrem.fromScene(studio, 0.04)
    scene.environment = target.texture
    return () => {
      scene.environment = null
      target.dispose()
      pmrem.dispose()
      for (const d of disposables) d.dispose()
    }
  }, [gl, scene])
  return null
}

/** The key: a soft spot on the head and chest from the upper left, falling off below. */
function Key() {
  const light = useMemo(() => {
    const spot = new SpotLight('#ffffff', 90, 0, 0.32, 0.9, 2)
    spot.position.set(-3, 5, 3.2)
    spot.target.position.set(0, 1.6, 0)
    return spot
  }, [])
  return (
    <>
      <primitive object={light} />
      <primitive object={light.target as Object3D} />
    </>
  )
}

/** Low key: the spot, a strong rim from behind each side, a little ambient. */
function Lighting() {
  return (
    <>
      <ambientLight intensity={0.12} />
      <Key />
      <directionalLight position={[-3.2, 3, -3.2]} intensity={4} color="#ffffff" />
      <directionalLight position={[3.2, 2.4, -3.5]} intensity={2.5} color="#ffffff" />
      <Studio />
    </>
  )
}

export default function RobotScene({ active, still, ...robot }: RobotSceneProps) {
  return (
    <Canvas
      // Capped at 2: the card is ~200 CSS px, and past 2x the extra pixels are
      // invisible and the fill cost is not.
      dpr={[1, 2]}
      camera={{ position: [...CAMERA_REST], fov: 27, near: 0.05, far: 50 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
      // Off screen (the phone drawer closed) or held still: no frame loop.
      frameloop={still ? 'demand' : active ? 'always' : 'never'}
      onCreated={({ camera }) => camera.lookAt(...LOOK_REST)}
      style={{ width: '100%', height: '100%' }}
      aria-hidden
    >
      <Lighting />
      {/* Its own boundary, inside the canvas. Without one, the model's load
          suspended the canvas's root as it mounted, and R3F left that root
          inactive: four frames, then a loop that never ran again — a card
          with nothing in it, measured, and no error anywhere to say why. */}
      <Suspense fallback={null}>
        <Robot still={still} {...robot} />
      </Suspense>
    </Canvas>
  )
}
