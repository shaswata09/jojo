import { GESTURES, type MascotPose } from '@/lib/mascot-context'
import { PAD_STROKES, strokesFor } from '@/lib/gesture-pad'
import { cn } from '@/lib/utils'

/**
 * What the mascot can do, said in one place and shown in two: the moves
 * button on the brand card, and Settings › Appearance. Each move is listed
 * with the stroke that plays it when drawn on the card (lib/gesture-pad.ts),
 * and the robot's model credit closes the list — CC BY asks for it wherever
 * the work is presented, and this is where people look at the robot.
 */

/** A stroke's little picture: one SVG path on a 24-unit grid, drawn as a line. */
function StrokeIcon({ path, className }: { path: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={cn('size-4 shrink-0', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  )
}

const LABEL = Object.fromEntries(GESTURES.map((g) => [g.pose, g.label])) as Record<
  Exclude<MascotPose, 'idle'>,
  string
>

/** Every move as a button that plays it, with the stroke(s) that also do. */
export function MoveList({ onPlay }: { onPlay: (pose: MascotPose) => void }) {
  return (
    <ul className="flex flex-col">
      {GESTURES.map(({ pose, label }) => {
        const strokes = strokesFor(pose)
        return (
          <li key={pose}>
            <button
              type="button"
              onClick={() => onPlay(pose)}
              className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-foreground/5 focus-visible:bg-foreground/5 focus-visible:outline-none"
            >
              <span>{label}</span>
              {strokes.length ? (
                <span className="flex items-center gap-1.5 text-xs text-text-3">
                  {strokes.map((s) => (
                    <span key={s.id} className="flex items-center gap-1">
                      <StrokeIcon path={s.icon} className="size-3.5" />
                      {s.label}
                    </span>
                  ))}
                </span>
              ) : null}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** The strokes alone, each with the move it plays — for Settings. */
export function StrokeLegend({ className }: { className?: string }) {
  return (
    <ul className={cn('grid gap-x-4 gap-y-1.5 text-xs', className)}>
      {PAD_STROKES.map((s) => (
        <li key={s.id} className="flex items-center gap-1.5 sm:whitespace-nowrap">
          <StrokeIcon path={s.icon} className="size-3.5 text-text-3" />
          <span className="text-text-2">{s.label}</span>
          <span aria-hidden className="text-text-3">
            →
          </span>
          <span className="sr-only">plays</span>
          <span className="text-text-1">{LABEL[s.pose]}</span>
        </li>
      ))}
    </ul>
  )
}

const MODEL_URL =
  'https://sketchfab.com/3d-models/sci-fi-ob-robot-unit-th-icc02-animated-6c0764c2bc4c4aaa8e03ba1653f455a6'
const ARTIST_URL = 'https://sketchfab.com/jungle_jim'
const LICENCE_URL = 'https://creativecommons.org/licenses/by/4.0/'

const link = 'underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground'

/**
 * The model's credit, as its licence asks: title, author, source, licence, and
 * that it was changed. The full list of changes is on the Built with page and
 * in THIRD-PARTY-NOTICES.md.
 */
export function MascotCredit({ className }: { className?: string }) {
  return (
    <p className={cn('text-xs leading-relaxed text-text-3', className)}>
      Robot model:{' '}
      <a href={MODEL_URL} target="_blank" rel="noreferrer noopener" className={link}>
        &ldquo;Sci-fi O.B. Robot Unit TH-ICC02 (animated)&rdquo;
      </a>{' '}
      by{' '}
      <a href={ARTIST_URL} target="_blank" rel="noreferrer noopener" className={link}>
        Jungle Jim
      </a>
      , licensed under{' '}
      <a href={LICENCE_URL} target="_blank" rel="noreferrer noopener" className={link}>
        CC BY 4.0
      </a>
      . Changed for jojo: lighter mesh and textures, its own eyes and moves (Guide › Built with
      lists every change). The artist does not endorse jojo.
    </p>
  )
}
