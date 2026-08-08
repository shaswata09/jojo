import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * What a brand-new user actually sees first.
 *
 * The audit found six components rendering a titled panel wrapped around
 * nothing on zero data. An empty state should say what belongs here and offer
 * the action that fills it — not just report absence.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center gap-2 px-4 py-10 text-center', className)}>
      {Icon ? (
        <div className="mb-1 grid size-9 place-items-center rounded-lg border border-hairline bg-well text-text-3">
          <Icon className="size-4" strokeWidth={1.7} aria-hidden />
        </div>
      ) : null}
      <p className="text-sm font-medium text-text-1">{title}</p>
      {description ? <p className="max-w-xs text-xs text-text-3">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}
