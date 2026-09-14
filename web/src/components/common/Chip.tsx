import { cva, type VariantProps } from 'class-variance-authority'
import { inkStyle, toneClass } from '@/components/common/label-display'
import { useTheme } from '@/lib/theme-context'
import { STAGE_DOT, type Stage } from '@/data/seed'
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
      /*
       * The palette, spread in rather than restated.
       *
       * These were the same five strings as `toneClass` in `label-display.ts`,
       * written out again here — so a keyword's chip and a keyword's swatch
       * were two places to remember, and a palette that grew in one of them
       * grew in one of them. `teal` also used to be the monochrome accent here,
       * which made it identical to `gray`: Academia and Industry chips were
       * indistinguishable, which is the version of this bug that already
       * happened.
       */
      tone: { ...toneClass },
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

export function Chip({
  className,
  tone,
  ink,
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
    /**
     * A colour off the spectrum, for a keyword whose owner wanted one the eight
     * did not have.
     *
     * Inline, where every other colour here is a class, and it has to be: the
     * eight are tokens the stylesheet swaps per theme and this one has no token
     * to swap — `inkStyle` does that swapping instead, for the theme on screen.
     * A hex that does not parse yields nothing and the chip wears its `tone`,
     * which is the fallback that field exists to be.
     *
     * Never with `stage`: a stage chip is jojo's own word about a record and
     * colour law keeps the loud colours for the user's.
     */
    ink?: string
  }) {
  const { theme } = useTheme()
  const custom = stage ? undefined : inkStyle(ink, theme)

  return (
    <span
      className={cn(
        chipVariants({ tone: stage ? 'gray' : tone, size, shape }),
        // The tone's own colours are dropped when a custom one is painted over
        // them: `bg-info-soft` and an inline `backgroundColor` would otherwise
        // both apply, and which wins is a question about specificity nobody
        // reading this file should have to answer.
        custom && 'border-transparent bg-transparent text-inherit',
        className,
      )}
      style={custom ? { ...custom, ...props.style } : props.style}
      {...props}
    >
      {stage ? (
        <span className={cn('size-1.5 shrink-0 rounded-full', STAGE_DOT[stage])} aria-hidden />
      ) : null}
      {children}
    </span>
  )
}
