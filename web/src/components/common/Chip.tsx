import { cva, type VariantProps } from 'class-variance-authority'
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

export function Chip({
  className,
  tone,
  size,
  shape,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof chipVariants>) {
  return <span className={cn(chipVariants({ tone, size, shape }), className)} {...props} />
}
