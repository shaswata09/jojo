import { useState } from 'react'
import type { ReactElement } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { STAGES, STAGE_DOT, STAGE_LABEL } from '@/data/seed'
import type { Stage } from '@/data/seed'
import { cn } from '@/lib/utils'

/**
 * `STAGE_LABEL` and `STAGE_DOT` used to be declared here and imported from
 * here by seven files, while four other files built their own copy of one or
 * both. They live in `@/data/seed` now, next to `STAGE_VALUES`-derived `STAGES`
 * and typed rather than cast — import them from there.
 *
 * There used to be a third, `STAGE_TONE`, mapping the six stages onto Chip's
 * four generic tones — which meant Submitted and Screen were both teal, Draft
 * and Closed were both grey, and none of the six agreed with the `--stage-*`
 * colour the board painted for the same record. It is gone; `<Chip stage>` is
 * the one place a stage becomes a colour now.
 */

/**
 * Change an application's stage without a mouse.
 *
 * Until this existed the only way to move a card was a pointer drag on the
 * kanban board, which excludes touch and keyboard outright — the board is the
 * page the whole app is organised around, and a third of the ways to use it
 * could not operate the one gesture it offered. One control, shared by the
 * table, the board card and the detail page, so the six stages are spelled the
 * same everywhere.
 *
 * `open`/`onOpenChange` are optional: left off, the menu manages itself; passed
 * in, a caller can open it from somewhere else entirely — which is how the
 * detail page's overflow "Move to…" reaches this menu without nesting one
 * popover inside another.
 */
export function StageMenu({
  value,
  onSelect,
  open,
  onOpenChange,
  align = 'start',
  className,
  trigger,
}: {
  value: Stage
  onSelect: (stage: Stage) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  align?: 'start' | 'center' | 'end'
  className?: string
  /** Replaces the default stage pill. Must be a single element — it is `asChild`. */
  trigger?: ReactElement
}) {
  const [uncontrolled, setUncontrolled] = useState(false)
  const isOpen = open ?? uncontrolled

  const setOpen = (next: boolean) => {
    setUncontrolled(next)
    onOpenChange?.(next)
  }

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            aria-label={`Stage: ${STAGE_LABEL[value]}. Change stage`}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-sm border border-hairline bg-well px-1.5 py-0.5 text-xs font-medium text-text-2 transition-colors hover:border-hairline-strong hover:text-text-1 data-[state=open]:border-accent-border data-[state=open]:bg-accent-soft data-[state=open]:text-accent',
              className,
            )}
          >
            <span className={cn('size-1.5 shrink-0 rounded-full', STAGE_DOT[value])} aria-hidden />
            {STAGE_LABEL[value]}
            <ChevronDown className="size-3 text-text-3" strokeWidth={2} aria-hidden />
          </button>
        )}
      </PopoverTrigger>

      <PopoverContent align={align} className="w-48 gap-1 p-1.5">
        <div className="px-1 text-xs tracking-wide text-text-3 uppercase">Move to</div>
        {/*
          Plain buttons rather than role="radio": the radiogroup pattern owes a
          roving tabindex and arrow-key selection, and claiming the role without
          them promises behaviour that is not there. Tab moves between six
          buttons perfectly well.
        */}
        <ul className="flex flex-col">
          {STAGES.map((stage) => {
            const current = stage.id === value
            return (
              <li key={stage.id}>
                <button
                  type="button"
                  // Selecting the stage it is already in would be a button that
                  // does nothing, so it says why instead.
                  disabled={current}
                  title={current ? `Already in ${stage.label}` : undefined}
                  aria-current={current ? 'true' : undefined}
                  onClick={() => {
                    onSelect(stage.id)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-1 py-1.5 text-xs transition-colors',
                    // A disabled button still matches :hover, so the hover
                    // styling is withheld by branch rather than by a variant.
                    current ? 'text-text-3' : 'text-text-2 hover:bg-well hover:text-text-1',
                  )}
                >
                  <span className={cn('size-1.5 shrink-0 rounded-full', stage.dot)} aria-hidden />
                  {stage.label}
                  {current ? (
                    <>
                      <Check className="ml-auto size-3.5 shrink-0 text-accent" aria-hidden />
                      <span className="sr-only">Current stage</span>
                    </>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
