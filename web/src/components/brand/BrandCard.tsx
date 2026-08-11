import type { ReactNode } from 'react'
import { Moon, Sun } from 'lucide-react'
import { playSwitchClick } from '@/lib/sound'
import { useTheme } from '@/lib/theme-context'
import { SplineRobot } from '@/components/brand/SplineRobot'
import { Spotlight } from '@/components/ui/spotlight'
import { useMascot } from '@/lib/mascot-context'
import { cn } from '@/lib/utils'

/**
 * Square brand card carrying the 3D jojo robot, which tracks the cursor and
 * gestures on cue — see SplineRobot and spline-rig.ts.
 */
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
      className="grid size-8 place-items-center rounded-full border border-white/20 bg-black/25 text-white/80 backdrop-blur-sm transition-colors hover:text-white"
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

  return (
    <div
      className={cn(
        'relative aspect-square overflow-hidden rounded-lg border bg-black/[0.96]',
        className,
      )}
      style={{ borderColor: 'var(--hairline)' }}
    >
      <Spotlight className="-top-24 left-0" fill="white" />

      {/* The whole card is the hit target — the robot is decoration, so there is
          nothing smaller worth aiming at. */}
      <button
        type="button"
        onClick={() => play('nod')}
        aria-label="Poke jojo"
        className="absolute inset-0 cursor-pointer"
      >
        {/* The scene is framed for a wide hero, so it is scaled up and nudged
            down to keep the robot centred in a square. */}
        <SplineRobot className="absolute inset-0 translate-y-[6%] scale-[1.35]" />
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

      {/* Chrome over the scene: theme first, then the drawer close on mobile.
          Both are light-on-dark with a blurred backdrop, because the card is
          near-black regardless of the active theme. */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5">
        <ThemeToggle />
        {action}
      </div>
    </div>
  )
}
