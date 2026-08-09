import type { ReactNode } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/** One option inside a page's settings popover. Compact by design — a popover
 *  is not a settings page and should not grow into one. */
export function PageOption({
  label,
  hint,
  control,
}: {
  label: string
  hint?: string
  control: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <div className="min-w-0">
        <div className="text-xs text-text-1">{label}</div>
        {hint ? <div className="mt-0.5 text-xs text-text-3">{hint}</div> : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  )
}

export function PageHeader({
  title,
  subtitle,
  actions,
  settings,
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  /**
   * Page-specific options, shown in a popover from a control beside the title.
   *
   * Deliberately a slot rather than a shared settings model: what is worth
   * configuring differs completely per page, and the alternative — one global
   * store keyed by route — would put every page's options in a file none of
   * them own. Pages with nothing to configure simply omit it and no control
   * appears, rather than opening an empty panel.
   */
  settings?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        {settings ? (
          <Popover>
            <PopoverTrigger
              aria-label={`${title} options`}
              title={`${title} options`}
              className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full border border-hairline bg-well text-text-2 transition-colors hover:border-hairline-strong hover:text-text-1 data-[state=open]:border-accent-border data-[state=open]:bg-accent-soft data-[state=open]:text-accent"
            >
              <SlidersHorizontal className="size-4" strokeWidth={1.8} aria-hidden />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64">
              <div className="px-0.5 pb-1 text-xs tracking-wide text-text-3 uppercase">
                {title} options
              </div>
              {settings}
            </PopoverContent>
          </Popover>
        ) : (
          /* The gutter is reserved whether or not a page has options, so the
             h1 lands on the same x on every route. Without it the title jumps
             46px sideways as you move between a page with a settings control
             and one without — which reads, every single time, as the layout
             breaking rather than as a control appearing. */
          <span aria-hidden className="size-9 shrink-0" />
        )}

        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {subtitle ? <p className="mt-0.5 text-sm text-text-2">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2.5">{actions}</div> : null}
    </div>
  )
}
