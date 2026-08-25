import { cn } from '@/lib/utils'
import type { ComponentProps, ReactNode } from 'react'

/** The app's primary frosted surface. */
export function Panel({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section className={cn('surface rounded-lg px-4 py-4 sm:px-5 sm:py-5', className)} {...props} />
  )
}

/**
 * A scroll region that reaches its container's edges.
 *
 * A scroller nested inside a padded surface inherits that padding as a gutter,
 * so its scrollbar floats in from the border and reads as belonging to nothing.
 * Cancelling the padding with a negative margin and re-applying it as padding
 * *inside* the scroller puts the bar on the edge while leaving the content
 * exactly where it was — and the re-applied padding scrolls with the content,
 * so nothing butts against the border on the way past.
 *
 * The bottom is cancelled too, so a horizontal bar lands on the bottom edge
 * rather than hovering above it. That assumes this is the last child of its
 * container, which is what a scroll region filling the remaining space is.
 *
 * `min-h-0` is part of the contract: without it `flex-1` means "at least my
 * content" and the region grows its container instead of scrolling inside it.
 */
export function PanelScroll({
  className,
  axis = 'both',
  inset = 'panel',
  bleed = 'all',
  ...props
}: ComponentProps<'div'> & {
  axis?: 'x' | 'y' | 'both'
  /** Which padding to escape: a Panel's, or a tighter `p-2` surface. */
  inset?: 'panel' | 'tight'
  /**
   * Which edges the scroller is allowed to bleed past.
   *
   * `all` suits a scroller that is the LAST thing in its panel: the negative
   * bottom margin lets the final row run to the panel's edge instead of
   * stopping short at its padding, which is what makes a long list look
   * continuous rather than boxed.
   *
   * `sides` is for a scroller with a SIBLING BELOW IT — a composer, a footer,
   * a toolbar. The bottom bleed pulls that sibling UP by the margin, so it
   * comes to rest inside the scroller's own padding: measured on the assistant
   * page, the transcript's box ended at y=807 while the composer began at
   * y=795, and turns painted into that 12px strip appeared underneath the input.
   * Dropping only the bottom bleed keeps the side-to-side bleed that makes the
   * panel look right.
   */
  bleed?: 'all' | 'sides'
}) {
  return (
    <div
      className={cn(
        /*
         * `relative` is load-bearing, and the bug it fixes is not obvious.
         *
         * An absolutely positioned descendant resolves against its nearest
         * POSITIONED ancestor, and contributes to that ancestor's scrollable
         * overflow. With nothing positioned between it and the page, a
         * `sr-only` live region sitting at the bottom of a long transcript
         * resolved against the initial containing block — so its static
         * position, a thousand pixels down inside this scroller, extended the
         * DOCUMENT instead of this box. The result was a page-level scrollbar
         * next to a panel that was already scrolling correctly, 355px of empty
         * page below a layout that otherwise fitted the viewport exactly.
         *
         * Making every scroller a containing block means an absolutely
         * positioned child is clipped by the box it lives in, which is what
         * anybody writing one inside a scroll region already assumes.
         */
        'relative min-h-0 flex-1',
        inset === 'tight' ? '-mx-2 px-2' : '-mx-4 px-4 sm:-mx-5 sm:px-5',
        // The bottom half, kept separate so it can be dropped on its own. The
        // `sm:` variants have to be cancelled at the same breakpoint they are
        // set at — a bare `mb-0` loses to `sm:-mb-5` above 640px, which is the
        // trap that makes this look fixed on a phone and broken on a laptop.
        bleed === 'all'
          ? inset === 'tight'
            ? '-mb-2 pb-2'
            : '-mb-4 pb-4 sm:-mb-5 sm:pb-5'
          : 'mb-0 pb-0 sm:mb-0 sm:pb-0',
        axis === 'x' ? 'overflow-x-auto' : axis === 'y' ? 'overflow-y-auto' : 'overflow-auto',
        className,
      )}
      {...props}
    />
  )
}

export function PanelTitle({
  children,
  hint,
  right,
  className,
  ...props
}: ComponentProps<'h2'> & {
  hint?: ReactNode
  /**
   * A control belonging to the panel as a whole, on the title's own line.
   *
   * Outside the `<h2>` rather than inside it: a button nested in a heading is
   * announced as part of the heading text, and a screen reader jumping by
   * heading would read the control's label as though it were the panel's name.
   * The wrapper is what keeps them on one line without nesting one in the other.
   */
  right?: ReactNode
}) {
  const heading = (
    <h2
      className={cn('text-base font-medium', right ? 'min-w-0 flex-1' : 'mb-3.5', className)}
      {...props}
    >
      {children}
      {hint ? (
        <small className="ml-2 font-sans text-xs font-normal text-text-3">{hint}</small>
      ) : null}
    </h2>
  )
  if (!right) return heading
  return (
    <div className="mb-3.5 flex items-start gap-2">
      {heading}
      {right}
    </div>
  )
}

/**
 * Groups rows and draws dividers *between* them.
 *
 * Rows previously carried their own `border-t` plus `first:border-t-0` to drop
 * the leading one — but `first:` is `:first-child`, and PanelTitle's <h2> holds
 * that position, so no row ever matched and every panel drew a stray line under
 * its heading. Owning the dividers here is correct regardless of what else the
 * panel contains.
 */
export function RowList({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('divide-y divide-hairline', className)} {...props} />
}

/** A single list row. Wrap a group of them in <RowList>. */
export function Row({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex items-center gap-3 px-1 py-2.5 text-sm', className)} {...props} />
}
