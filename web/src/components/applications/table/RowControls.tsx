import { useState } from 'react'
import { Copy, Flag, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import type { RowActions } from '@/components/applications/use-row-actions'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { displayName, type Application } from '@/data/seed'
import { cn } from '@/lib/utils'

const menuItem =
  'flex w-full items-center gap-2 rounded-sm px-1.5 py-1.5 text-xs text-text-2 transition-colors hover:bg-well hover:text-text-1'

/** Edit · Duplicate · Delete, behind one overflow button. */
export function RowMenu({ app, actions }: { app: Application; actions: RowActions }) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`More actions for ${displayName(app)}`}
        title="More actions"
        className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-md border border-transparent text-text-3 transition-colors hover:border-hairline hover:bg-well hover:text-text-1 data-[state=open]:border-accent-border data-[state=open]:bg-accent-soft data-[state=open]:text-accent"
      >
        <MoreHorizontal className="size-4" strokeWidth={1.9} aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 gap-1 p-1.5">
        <button
          type="button"
          className={menuItem}
          onClick={() => {
            setOpen(false)
            actions.onEdit(app)
          }}
        >
          <Pencil className="size-3.5 shrink-0" strokeWidth={1.9} aria-hidden />
          Edit
        </button>
        <button
          type="button"
          className={menuItem}
          onClick={() => {
            setOpen(false)
            actions.onDuplicate(app)
          }}
        >
          <Copy className="size-3.5 shrink-0" strokeWidth={1.9} aria-hidden />
          Duplicate
        </button>
        <button
          type="button"
          className={cn(menuItem, 'text-danger hover:bg-danger-soft hover:text-danger')}
          onClick={() => {
            setOpen(false)
            actions.requestDelete(app)
          }}
        >
          <Trash2 className="size-3.5 shrink-0" strokeWidth={1.9} aria-hidden />
          Delete
        </button>
      </PopoverContent>
    </Popover>
  )
}

export function FlagButton({
  app,
  onFlag,
}: {
  app: Application
  onFlag: (a: Application) => void
}) {
  const label = app.flagged ? 'Clear the follow-up flag' : 'Flag for follow-up'
  return (
    <button
      type="button"
      aria-pressed={Boolean(app.flagged)}
      aria-label={`${label} on ${displayName(app)}`}
      title={label}
      onClick={() => onFlag(app)}
      className={cn(
        'grid size-7 shrink-0 cursor-pointer place-items-center rounded-md border transition-colors',
        app.flagged
          ? 'border-danger-border bg-danger-soft text-danger'
          : 'border-transparent text-text-3 hover:border-hairline hover:bg-well hover:text-text-1',
      )}
    >
      <Flag className="size-3.5" strokeWidth={1.9} aria-hidden />
    </button>
  )
}
