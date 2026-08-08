import { cn } from '@/lib/utils'

export type DotStatus = 'on' | 'warn' | 'off'

const tone: Record<DotStatus, string> = {
  on: 'bg-success',
  warn: 'bg-warning',
  off: 'bg-text-3',
}

/** Plain 6px dot. The glow it used to carry (`box-shadow: 0 0 8px currentColor`)
 *  read as a cyberpunk status LED rather than a state indicator. */
export function StatusDot({ status, className }: { status: DotStatus; className?: string }) {
  return (
    <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', tone[status], className)} />
  )
}
