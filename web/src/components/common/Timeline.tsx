import { cn } from '@/lib/utils'
import type { ComponentProps, ReactNode } from 'react'

// border-red / border-amber / border-green were left behind by the token
// rename. Tailwind emits nothing for an undefined utility, so the node ring
// silently lost its colour channel — the timeline's only urgency cue.
const nodeTone = {
  red: 'border-danger bg-danger-soft',
  amber: 'border-warning bg-warning-soft',
  green: 'border-success bg-success-soft',
  accent: 'border-accent bg-accent-soft',
  gray: 'border-hairline-strong bg-well',
} as const

export type TimelineTone = keyof typeof nodeTone

/** Ordered list — chronology is the point, so `<ol>` rather than `<div>`. */
export function Timeline({ className, ...props }: ComponentProps<'ol'>) {
  return <ol className={cn('relative', className)} {...props} />
}

/**
 * One node on the rail.
 *
 * The rail is drawn per item as a pseudo-element, positioned to run through the
 * centre of every node: 6.5px across (matching the 13px node at `left-0`) and,
 * vertically, from the first node's centre to the last node's centre. Middle
 * items span their full height so the segments meet across the gap; the first
 * and last are clipped to their own node centre so the rail never trails off
 * into empty space at either end.
 *
 * It previously used `bg-well-border`, a token that does not exist. Tailwind
 * emits nothing for an undefined utility, so the rail rendered at zero opacity
 * and the timeline was a column of unconnected circles — the same failure the
 * note above `nodeTone` describes, in the same file.
 */
export function TimelineItem({
  tone = 'gray',
  time,
  title,
  subtitle,
  action,
  children,
  className,
  ...props
}: Omit<ComponentProps<'li'>, 'title'> & {
  tone?: TimelineTone
  time?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
}) {
  return (
    <li
      className={cn(
        'relative pb-4 pl-7 last:pb-0',
        // 6px + the 1px width straddles 6.5px, the centre of the 13px node.
        'before:absolute before:left-[6px] before:w-px before:bg-hairline-strong',
        'before:top-0 before:bottom-0',
        // Start at the first node's centre rather than the top of the list.
        'first:before:top-[11px]',
        // Stop at the last node's centre. `top` + `height` over-constrains the
        // box, so `bottom` is dropped — which is exactly what is wanted here.
        'last:before:h-[12px]',
        // A lone node has nothing to connect to.
        'first:last:before:hidden',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          'absolute top-[5px] left-0 size-[13px] rounded-full border-2',
          nodeTone[tone],
        )}
      />

      <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-text-1">{title}</div>
          {subtitle ? <div className="mt-0.5 text-xs text-text-3">{subtitle}</div> : null}
          {children}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>

      {time ? (
        <div className="mt-1 font-mono text-xs tracking-tight text-text-3">{time}</div>
      ) : null}
    </li>
  )
}
