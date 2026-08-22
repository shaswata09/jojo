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
   *
   * A page without options starts its title hard against the content edge —
   * there is no reserved gutter. This file used to keep one, so that the h1
   * landed on the same x whatever route you were on, and the cost was a 36px
   * band of empty space on Today, Assistant, Settings, the guide pages and
   * every placeholder: most of the app, indented for the benefit of the seven
   * routes that do have a control. Asked for and settled — the title aligns
   * with the content beneath it, and the h1 shifts by the control's width when
   * you cross between the two kinds of page. Do not reinstate the spacer.
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
              // `touch-target` because the coarse-pointer rule in `index.css`
              // enumerates `size-6`/`size-7`/`size-8` and stops there: this is
              // the app's one bare `size-9` trigger, so it was the only control
              // in a page header that kept its drawn 36x36 while the buttons
              // beside it caught 44x44. Bigger on screen, smaller under a
              // finger, which is the shape of bug nobody finds by looking.
              className="touch-target grid size-9 shrink-0 cursor-pointer place-items-center rounded-full border border-hairline bg-well text-text-2 transition-colors hover:border-hairline-strong hover:text-text-1 data-[state=open]:border-accent-border data-[state=open]:bg-accent-soft data-[state=open]:text-accent"
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
        ) : null}

        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {subtitle ? <p className="mt-0.5 text-sm text-text-2">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2.5">{actions}</div> : null}
    </div>
  )
}
