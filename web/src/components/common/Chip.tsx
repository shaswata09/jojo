import { cva, type VariantProps } from 'class-variance-authority'
import { STAGES, type Stage } from '@/data/seed'
import { cn } from '@/lib/utils'
import type { ComponentProps } from 'react'

/**
 * Small status label, or a free-form tag.
 *
 * Status defaults to `square`. It was `rounded-full` at every size once, which
 * turned every list row into pill soup; a 4px radius with a hairline reads as a
 * data label, and the border gives each tone a non-colour cue.
 *
 * `capsule` is the deliberate exception. A tag cloud *is* a tag cloud, so the
 * pill shape is right there — and the difference in silhouette is what stops a
 * reader mistaking a descriptive tag for a status.
 */
const chipVariants = cva(
  'inline-flex items-center gap-1 border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        // Was the monochrome accent, which made this identical to `gray` —
        // Academia and Industry chips became indistinguishable.
        teal: 'border-info-border bg-info-soft text-info',
        amber: 'border-warning-border bg-warning-soft text-warning',
        red: 'border-danger-border bg-danger-soft text-danger',
        green: 'border-success-border bg-success-soft text-success',
        gray: 'border-hairline bg-well text-text-2',
      },
      size: {
        sm: 'px-1 py-0 text-xs',
        md: '',
      },
      shape: {
        square: 'rounded-sm',
        capsule: 'rounded-full px-2',
      },
    },
    defaultVariants: { tone: 'gray', size: 'md', shape: 'square' },
  },
)

/**
 * Derived from STAGES so a stage added to the data cannot be missed here. The
 * class strings themselves live in `seed.ts`, which is what keeps Tailwind's
 * source scan finding them — building them by interpolation would compile to
 * nothing.
 */
const STAGE_DOT = Object.fromEntries(STAGES.map((s) => [s.id, s.dot])) as Record<Stage, string>

export function Chip({
  className,
  tone,
  size,
  shape,
  stage,
  children,
  ...props
}: ComponentProps<'span'> &
  VariantProps<typeof chipVariants> & {
    /**
     * Renders the chip as a pipeline stage: neutral body, plus the one dot in
     * the app that carries a status colour.
     *
     * This is a prop rather than a cva variant because it has to contribute an
     * element, not just classes. It exists to end a split brain: the table and
     * RecentApplications used to map stages onto the four generic tones via a
     * `STAGE_TONE` lookup (Screen teal, Interview amber, Offer green) while the
     * board painted the same six stages from the `--stage-*` ramp — so a record
     * changed colour when you toggled Board/Table, and half the funnel shared
     * a hue. The stage tokens are the single source now.
     *
     * The body stays neutral on purpose: the stage hues are tuned as 3:1 fills,
     * not as 4.5:1 text, and colour law reserves coloured pills for the user's
     * own keywords.
     */
    stage?: Stage
  }) {
  return (
    <span
      className={cn(chipVariants({ tone: stage ? 'gray' : tone, size, shape }), className)}
      {...props}
    >
      {stage ? (
        <span className={cn('size-1.5 shrink-0 rounded-full', STAGE_DOT[stage])} aria-hidden />
      ) : null}
      {children}
    </span>
  )
}
