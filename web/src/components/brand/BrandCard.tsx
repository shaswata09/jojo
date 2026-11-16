import { useEffect, useRef, type PointerEvent, type ReactNode } from 'react'
import { Bot, Moon, Sun } from 'lucide-react'
import { playSwitchClick } from '@/lib/sound'
import { useTheme } from '@/lib/theme-context'
import { JojoRobot } from '@/components/brand/JojoRobot'
import { MascotCredit, MoveList } from '@/components/brand/MascotMoves'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Spotlight } from '@/components/ui/spotlight'
import {
  HOLD_MS,
  HOLD_PX,
  isDoubleTap,
  poseForStroke,
  recognise,
  type PadPoint,
} from '@/lib/gesture-pad'
import { useMascot, type MascotPose } from '@/lib/mascot-context'
import { DESKTOP_QUERY, useMediaQuery } from '@/lib/use-media-query'
import { EYE_RGB } from '@/lib/robot-rig'
import { cn } from '@/lib/utils'

/**
 * Square brand card carrying the 3D jojo robot, which tracks the cursor and
 * gestures on cue — see JojoRobot, RobotScene and robot-rig.ts. The card is
 * also a gesture pad: a stroke drawn on it plays a move (lib/gesture-pad.ts),
 * and the button in its top-left corner lists every move, its stroke, and
 * the robot's credit.
 */

/** The card's round, light-on-dark corner buttons: the card is near-black in either theme. */
const CORNER_BUTTON =
  'grid size-8 place-items-center rounded-full border border-white/20 bg-black/25 text-white/80 backdrop-blur-sm transition-colors hover:text-white'

/** The trail a stroke leaves: the eyes' cyan. */
const TRAIL = `rgb(${EYE_RGB.map((c) => Math.round(c * 255)).join(' ')})`

/**
 * The moves panel. It opens beside the card rather than over it — the card is
 * anchored as a whole in BrandCard — so the robot stays in view and you can
 * watch the move you picked.
 */
function MovesPanel() {
  const { play } = useMascot()
  // Beside the card on a desktop; below it in the phone drawer, where the
  // card already fills the drawer's width and a panel to its right started
  // past the edge of the screen — two thirds of it, credit included, out of
  // reach at 390px.
  const isDesktop = useMediaQuery(DESKTOP_QUERY)
  return (
    <PopoverContent
      side={isDesktop ? 'right' : 'bottom'}
      align="start"
      sideOffset={8}
      collisionPadding={12}
      className="max-h-[min(34rem,calc(100vh-2rem))] w-80 gap-2 overflow-y-auto"
    >
      <div className="px-2 pt-1">
        <div className="text-sm font-medium">jojo&rsquo;s moves</div>
        <p className="mt-0.5 text-xs text-text-3">Pick one, or draw its stroke on the robot.</p>
      </div>
      <MoveList onPlay={play} />
      <MascotCredit className="border-t border-hairline px-2 pt-2.5 pb-1" />
    </PopoverContent>
  )
}

/**
 * The pad: pointer handlers for the card, and the trail they draw.
 *
 * The trail is written straight onto the SVG rather than through React
 * state — a pointer move is up to 120 events a second, and re-rendering the
 * card for each would re-render the robot's canvas wrapper with it.
 */
function useGesturePad(play: (pose: MascotPose) => void) {
  const stroke = useRef<PadPoint[] | null>(null)
  const lastTap = useRef<PadPoint | null>(null)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const trail = useRef<SVGPolylineElement>(null)
  /** The card's corner, measured once a stroke: not a layout read per move. */
  const origin = useRef({ left: 0, top: 0 })

  useEffect(() => () => clearTimeout(holdTimer.current), [])

  const at = (e: PointerEvent<HTMLElement>): PadPoint => ({
    x: e.clientX - origin.current.left,
    y: e.clientY - origin.current.top,
    t: e.timeStamp,
  })
  const drawTrail = (points: PadPoint[], fade: boolean) => {
    const line = trail.current
    if (!line) return
    line.setAttribute('points', points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '))
    line.style.transition = fade ? 'opacity 450ms ease-out' : 'none'
    line.style.opacity = fade ? '0' : '1'
  }
  const end = () => {
    clearTimeout(holdTimer.current)
    const points = stroke.current
    stroke.current = null
    return points
  }

  const handlers = {
    onPointerDown(e: PointerEvent<HTMLButtonElement>) {
      if (e.button !== 0) return
      e.currentTarget.setPointerCapture(e.pointerId)
      const box = e.currentTarget.getBoundingClientRect()
      origin.current = { left: box.left, top: box.top }
      stroke.current = [at(e)]
      drawTrail([], false)
      clearTimeout(holdTimer.current)
      // Press-and-hold answers while you are still holding, not on release.
      holdTimer.current = setTimeout(() => {
        if (!stroke.current) return
        stroke.current = null
        lastTap.current = null
        play(poseForStroke('hold'))
      }, HOLD_MS)
    },
    onPointerMove(e: PointerEvent<HTMLButtonElement>) {
      const points = stroke.current
      if (!points) return
      points.push(at(e))
      const first = points[0]!
      const p = points[points.length - 1]!
      if (Math.hypot(p.x - first.x, p.y - first.y) > HOLD_PX) clearTimeout(holdTimer.current)
      if (points.length > 1) drawTrail(points, false)
    },
    onPointerUp(e: PointerEvent<HTMLButtonElement>) {
      const points = end()
      if (!points) return
      points.push(at(e))
      drawTrail(points, true)
      const id = recognise(points)
      const tap = points[points.length - 1]!
      const double = id === 'tap' && isDoubleTap(lastTap.current, tap)
      // Each stroke's move comes from the one table, PAD_STROKES.
      play(poseForStroke(double ? 'doubleTap' : id))
      lastTap.current = id === 'tap' && !double ? tap : null
    },
    onPointerCancel() {
      const points = end()
      if (points) drawTrail(points, true)
    },
  }
  return { handlers, trail }
}

function ThemeToggle() {
  const { theme, toggle } = useTheme()
  return (
    <button
      type="button"
      onClick={() => {
        // Fired together with the state change so sound and visual land on the
        // same frame — a lagging cue reads as a second, unrelated event.
        playSwitchClick()
        toggle()
      }}
      title="Toggle theme"
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      className={CORNER_BUTTON}
    >
      {theme === 'dark' ? (
        <Moon className="size-4" strokeWidth={1.7} />
      ) : (
        <Sun className="size-4" strokeWidth={1.7} />
      )}
    </button>
  )
}

export function BrandCard({ action, className }: { action?: ReactNode; className?: string }) {
  const { play } = useMascot()
  const pad = useGesturePad(play)

  return (
    <Popover>
      <PopoverAnchor asChild>
        <div
          data-tour="mascot"
          className={cn(
            'relative aspect-square overflow-hidden rounded-lg border bg-black/[0.96]',
            className,
          )}
          style={{ borderColor: 'var(--hairline)' }}
        >
          <Spotlight className="-top-24 left-0" fill="white" />

          {/* The whole card is the hit target — the robot is decoration, so there is
          nothing smaller worth aiming at. It is also the gesture pad: pointer
          strokes are read in useGesturePad, so a pointer click is handled there
          and onClick only answers the keyboard (detail 0), which would
          otherwise have no way to poke. `touch-none` lets a finger draw
          instead of scrolling the drawer. */}
          <button
            type="button"
            {...pad.handlers}
            onClick={(e) => {
              if (e.detail === 0) play('nod')
            }}
            aria-label="Poke jojo"
            className="absolute inset-0 cursor-pointer touch-none select-none"
          >
            {/* Framed by its own camera for this square, so the canvas sits
            exactly on the card. */}
            <JojoRobot className="absolute inset-0" />
            <svg
              aria-hidden
              className="pointer-events-none absolute inset-0 size-full overflow-visible"
            >
              <polyline
                ref={pad.trail}
                fill="none"
                stroke={TRAIL}
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ filter: `drop-shadow(0 0 5px ${TRAIL})`, opacity: 0 }}
              />
            </svg>
          </button>

          {/* Scrim so the wordmark stays legible over whatever the robot is doing.

          It was `h-1/3 from-black/85`, and that was sized against the 3D robot,
          whose lower body is near-black — over which 85% is plenty. It is not
          the only thing that renders here. With WebGL unavailable the 2D mascot
          takes over, and its torso is near-WHITE and lands exactly behind the
          wordmark: measured 2.13:1 at worst and 26% of the text box below
          4.5:1, on the app's own name.

          So the scrim is now sized for the worse of the two backgrounds rather
          than the better one. Solid black at the baseline, still 75% at the top
          of the wordmark, transparent by the top of the taller band — which
          holds ≥4.9:1 for the tagline and ≥10:1 for the wordmark even against a
          pure white body behind it, and is visually indistinguishable over the
          dark 3D robot it was tuned for. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black via-black/75 to-transparent"
          />

          <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3 text-center">
            <div className="text-lg leading-tight font-semibold text-white">jojo</div>
            <p className="mt-0.5 text-xs leading-snug text-white/60">Jarvis for Job Organization</p>
          </div>

          {/* Top-left: every move, its stroke, and the robot's credit. */}
          <div className="absolute top-2 left-2 z-10">
            <PopoverTrigger
              title="jojo's moves"
              aria-label="jojo's moves and credit"
              data-tour="moves"
              className={CORNER_BUTTON}
            >
              <Bot className="size-4" strokeWidth={1.7} />
            </PopoverTrigger>
          </div>

          {/* Chrome over the scene: theme first, then the drawer close on mobile.
          Both are light-on-dark with a blurred backdrop, because the card is
          near-black regardless of the active theme. */}
          <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5">
            <ThemeToggle />
            {action}
          </div>
        </div>
      </PopoverAnchor>
      <MovesPanel />
    </Popover>
  )
}
