import { createContext, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

/**
 * The one overflow menu, so a row's actions never move between tabs.
 *
 * Before this, Reminders had a 24px circular ⋯, Files a 28px rounded-square ⋯,
 * and Links and Snippets had no menu at all — a naked pencil and a naked bin
 * sitting where the other tabs put one button. Delete as a one-click icon is
 * also the thing the Delete law forbids: it has to cost a menu.
 *
 * Order is part of the contract and reads the same everywhere:
 * **Edit · Duplicate · [move section] · Delete**, destructive last and red.
 */

/** Closes the popover before running the action, so no menu outlives its row. */
const CloseMenu = createContext<() => void>(() => {})

export function RowMenu({
  name,
  className,
  children,
}: {
  /** The record the menu belongs to, for the accessible name. */
  name: string
  className?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`More actions for ${name}`}
        title="More actions"
        className={cn(
          'grid size-7 shrink-0 cursor-pointer place-items-center rounded-md border border-transparent text-text-3 transition-colors',
          'hover:border-hairline hover:bg-well hover:text-text-1',
          'data-[state=open]:border-accent-border data-[state=open]:bg-accent-soft data-[state=open]:text-accent',
          className,
        )}
      >
        <MoreHorizontal className="size-4" strokeWidth={1.9} aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 gap-1 p-1.5">
        <CloseMenu.Provider value={() => setOpen(false)}>{children}</CloseMenu.Provider>
      </PopoverContent>
    </Popover>
  )
}

const itemClass =
  'flex w-full cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1.5 text-xs text-text-2 transition-colors hover:bg-well hover:text-text-1'

export function MenuItem({
  icon: Icon,
  danger,
  current,
  children,
  onSelect,
}: {
  icon?: LucideIcon
  /** Destructive. Always the last item in the menu. */
  danger?: boolean
  /** The option already in force — listed so the set reads whole, but inert. */
  current?: boolean
  children: ReactNode
  onSelect: () => void
}) {
  const close = useContext(CloseMenu)

  return (
    <button
      type="button"
      disabled={current}
      aria-current={current ? 'true' : undefined}
      onClick={() => {
        close()
        onSelect()
      }}
      className={cn(
        itemClass,
        danger && 'text-danger hover:bg-danger-soft hover:text-danger',
        // A disabled button still matches :hover, so the hover styling is
        // withheld by branch rather than by a variant.
        current && 'cursor-default text-text-3 hover:bg-transparent hover:text-text-3',
      )}
    >
      {Icon ? <Icon className="size-3.5 shrink-0" strokeWidth={1.9} aria-hidden /> : null}
      <span className="truncate">{children}</span>
    </button>
  )
}

/**
 * A titled group — "Move to", and the rule above Delete.
 *
 * The move options are listed flat rather than behind a submenu: one popover
 * inside another traps focus in a chain nothing in this app needs, and there
 * are never more than four of them.
 */
export function MenuSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="mt-1 border-t border-hairline pt-1.5">
      {title ? (
        <div className="px-1.5 pb-0.5 text-xs tracking-wide text-text-3 uppercase">{title}</div>
      ) : null}
      {children}
    </div>
  )
}
