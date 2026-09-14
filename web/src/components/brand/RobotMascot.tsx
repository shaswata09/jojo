import { useEffect, useId, useRef } from 'react'
import { POSE_MS, type MascotPose } from '@/lib/mascot-context'
import { useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'

/**
 * How far the pointer must sit from the robot for the eyes to reach full
 * deflection, in CSS pixels. Roughly a forearm's sweep — close enough that
 * ordinary mousing around the app moves it, far enough that it isn't twitchy.
 */
const TRACK_RANGE = 420

/** Maximum travel, in viewBox units (the whole robot is 512 wide). */
const PUPIL_TRAVEL = { x: 15, y: 11 }
const LEAN_TRAVEL = { x: 9, y: 5 }

/** Idle blink cadence — jittered, because a metronome reads as a machine. */
const BLINK_MIN_MS = 2600
const BLINK_MAX_MS = 7200
const BLINK_MS = 150

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

/**
 * The jojo robot, rigged.
 *
 * Same mark as the favicon and RobotIcon, but split into transformable groups —
 * root, arms, head, eyes, pupils — so gestures can drive each one. Poses are CSS
 * keyframes (see index.css); only the cursor tracking runs in JS, because that
 * one has to follow input continuously rather than replay a fixed curve.
 *
 * Stands in for the 3D robot (see SplineRobot) while its scene downloads, and
 * permanently if that download never lands — the scene is a 1.35MB fetch from
 * prod.spline.design, so the card would otherwise sit empty offline. It speaks
 * the same pose vocabulary, so the fallback is never inert either.
 */
export function RobotMascot({
  pose = 'idle',
  seq = 0,
  paused = false,
  className,
}: {
  pose?: MascotPose
  /** Bumped by every play() — see the restart effect below. */
  seq?: number
  /** Stands the robot down while it is hidden, so it costs nothing offscreen. */
  paused?: boolean
  className?: string
}) {
  const rootRef = useRef<SVGSVGElement>(null)
  const leanRef = useRef<SVGGElement>(null)
  const pupilRef = useRef<SVGGElement>(null)
  const eyesRef = useRef<SVGGElement>(null)
  // Unique per instance: two mascots on one page would otherwise both resolve
  // url(#…) to whichever clipPath the document happened to parse first.
  // Stripped to word characters because React's generated ids carry delimiters
  // («r0» / :r0:) that have no business inside a url() fragment.
  const torsoClip = `jojo-torso-${useId().replace(/[^a-zA-Z0-9]/g, '')}`

  // Reduced motion turns off both the wandering gaze and the blink. Someone who
  // asked the OS to stop things moving did not ask for a robot that watches them.
  const still = useMediaQuery('(prefers-reduced-motion: reduce)') || paused

  // Gaze tracking. Writes transforms straight to the DOM rather than through
  // state — a re-render per pointermove would be absurd for a decorative eye.
  useEffect(() => {
    if (still) return

    let frame = 0
    let pointer: { x: number; y: number } | null = null

    const apply = () => {
      frame = 0
      const svg = rootRef.current
      if (!svg || !pointer) return

      const box = svg.getBoundingClientRect()
      if (!box.width) return

      const dx = clamp((pointer.x - (box.left + box.width / 2)) / TRACK_RANGE, -1, 1)
      const dy = clamp((pointer.y - (box.top + box.height / 2)) / TRACK_RANGE, -1, 1)

      pupilRef.current?.setAttribute(
        'transform',
        `translate(${dx * PUPIL_TRAVEL.x} ${dy * PUPIL_TRAVEL.y})`,
      )
      // The head leans a fraction of the eyes' travel, so the gaze leads and the
      // body follows — looking with the eyes first is what reads as alive.
      leanRef.current?.setAttribute(
        'transform',
        `translate(${dx * LEAN_TRAVEL.x} ${dy * LEAN_TRAVEL.y})`,
      )
    }

    // Coalesced to one write per frame: pointermove can fire far above 60Hz on
    // a high-polling mouse, and every extra write is a wasted layout read.
    const onMove = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY }
      frame ||= requestAnimationFrame(apply)
    }

    // On `window`, not the card — the robot should follow the cursor anywhere on
    // the page, which is what the 3D scene did via its globalEvents flag.
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [still])

  // Rewind the gesture whenever a new one is requested.
  //
  // Changing pose swaps the CSS class and the browser starts the animation on
  // its own; this only matters for the case that swap cannot express — asking
  // for the pose that is already playing. Rewinding through the Web Animations
  // API rather than toggling classes keeps it deterministic: no reflow hack, no
  // dependency on a frame callback that a background tab will never deliver.
  useEffect(() => {
    if (pose === 'idle') return
    for (const animation of rootRef.current?.getAnimations({ subtree: true }) ?? []) {
      // The idle bob is a separate, permanently running animation — rewinding
      // it would make the robot twitch every time it gestured.
      const name = (animation as CSSAnimation).animationName
      if (!name?.startsWith('jojo-mascot-') || name === 'jojo-mascot-bob') continue
      animation.currentTime = 0
      animation.play()
    }
  }, [pose, seq])

  // Blink, on a jittered timer. Toggles the class directly for the same reason
  // the gaze does: no reason to re-render the whole robot to shut its eyes.
  useEffect(() => {
    if (still) return

    let open: ReturnType<typeof setTimeout>
    let shut: ReturnType<typeof setTimeout>

    const schedule = () => {
      shut = setTimeout(
        () => {
          eyesRef.current?.classList.add('is-blinking')
          open = setTimeout(() => {
            eyesRef.current?.classList.remove('is-blinking')
            schedule()
          }, BLINK_MS)
        },
        BLINK_MIN_MS + Math.random() * (BLINK_MAX_MS - BLINK_MIN_MS),
      )
    }
    schedule()

    return () => {
      clearTimeout(shut)
      clearTimeout(open)
    }
  }, [still])

  return (
    <svg
      ref={rootRef}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="jojo"
      className={cn('jojo-mascot', className)}
      data-pose={pose}
      // Drives animation-duration, so the keyframes below hold shape only and
      // POSE_MS stays the one place a gesture's length is written down.
      style={{ '--pose-ms': `${POSE_MS[pose] || 0}ms` } as React.CSSProperties}
    >
      <defs>
        {/* The torso silhouette, reused as a clip so the shading and the
            shoulder band can be plain rectangles instead of hand-traced paths
            that have to re-derive the same rounded corners three times. */}
        <clipPath id={torsoClip}>
          <rect x="148" y="252" width="216" height="220" rx="64" />
        </clipPath>
      </defs>

      {/* Root: the idle bob, plus the gestures that move the body as a unit. */}
      <g className="jojo-mascot-root">
        {/* Neck, drawn first so both the head and the torso overlap its ends.
            The icon this is derived from had a 32-unit gap here, which reads
            fine at 16px and reads as a severed head at mascot size. */}
        <rect x="222" y="200" width="68" height="72" rx="20" fill="#98a1ab" />

        {/* Arms before the torso, so each shoulder tucks behind it. */}
        <g className="jojo-mascot-arm jojo-mascot-arm-l">
          <rect x="112" y="272" width="44" height="132" rx="22" fill="#aeb6bf" />
          <rect x="112" y="272" width="19" height="132" rx="9.5" fill="#98a1ab" />
        </g>
        <g className="jojo-mascot-arm jojo-mascot-arm-r">
          <rect x="356" y="272" width="44" height="132" rx="22" fill="#aeb6bf" />
          <rect x="356" y="272" width="19" height="132" rx="9.5" fill="#98a1ab" />
        </g>

        {/* Torso. A tapered capsule rather than the icon's sphere — a round
            body swallowed the arms entirely below the shoulder. */}
        <g className="jojo-mascot-body">
          <g clipPath={`url(#${torsoClip})`}>
            <rect x="148" y="252" width="216" height="220" fill="#e6e7e8" />
            <rect x="148" y="252" width="66" height="220" fill="#d3d5d7" />
            <rect x="148" y="252" width="216" height="76" fill="#aeb6bf" />
            <rect x="148" y="252" width="66" height="76" fill="#98a1ab" />
          </g>
          <path d="M214 366h84l-42 54z" fill="#fbb540" />
          <path d="M256 420l42-54h-25z" fill="#f09819" />
        </g>

        {/* Lean is JS-driven, the pose animation is CSS. Separate groups so the
            two compose instead of overwriting each other's transform. */}
        <g ref={leanRef}>
          <g className="jojo-mascot-head">
            {/* Ears */}
            <rect x="38" y="72" width="62" height="92" rx="18" fill="#aeb6bf" />
            <rect x="38" y="72" width="26" height="92" rx="18" fill="#98a1ab" />
            <rect x="412" y="72" width="62" height="92" rx="18" fill="#aeb6bf" />
            <rect x="448" y="72" width="26" height="92" rx="18" fill="#98a1ab" />

            {/* Head */}
            <rect x="88" y="8" width="336" height="222" rx="106" fill="#e6e7e8" />
            <path
              d="M194 8C135 8 88 55 88 114v10c0 59 47 106 106 106h-6c-59 0-72-47-72-106v-10c0-59 13-106 72-106z"
              fill="#d3d5d7"
            />

            {/* Visor */}
            <rect x="136" y="34" width="240" height="170" rx="82" fill="#57596b" />
            <path
              d="M218 34c-45 0-82 37-82 82v6c0 45 37 82 82 82h-14c-45 0-38-37-38-82v-6c0-45-7-82 38-82z"
              fill="#43455a"
            />

            {/* Eyes. Outer group blinks (scaleY), inner group tracks the cursor
                — nesting keeps a blink mid-gaze from resetting the gaze. */}
            <g ref={eyesRef} className="jojo-mascot-eyes">
              <circle cx="206" cy="119" r="33" fill="#71dcef" />
              <path d="M206 86a33 33 0 0 0 0 66 33 33 0 0 1 0-66z" fill="#5ccbe0" />
              <circle cx="310" cy="119" r="33" fill="#71dcef" />
              <path d="M310 86a33 33 0 0 0 0 66 33 33 0 0 1 0-66z" fill="#5ccbe0" />
              <g ref={pupilRef}>
                <circle cx="206" cy="119" r="13" fill="#2f3142" />
                <circle cx="310" cy="119" r="13" fill="#2f3142" />
              </g>
            </g>
          </g>
        </g>
      </g>
    </svg>
  )
}
