import { useId, useState } from 'react'
import { ChevronDown, Trash2 } from 'lucide-react'
import { toneClass, usage } from '@/components/common/label-display'
import { ToneSwatches } from '@/components/common/ToneSwatches'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { Label } from '@/data/labels'
import { useLabels } from '@/lib/labels-context'
import { cn } from '@/lib/utils'

/** Rename, recolour, delete — the body of a chip's menu. */
function KeywordMenu({
  label,
  onClose,
  onRequestDelete,
}: {
  label: Label
  onClose: () => void
  onRequestDelete: (id: string) => void
}) {
  const { renameLabel, setTone, countFor } = useLabels()
  const [draft, setDraft] = useState(label.name)
  const [error, setError] = useState<string | null>(null)
  const nameId = useId()
  const errorId = `${nameId}-error`
  const used = countFor(label.id)

  const save = () => {
    const next = draft.trim()
    if (next === label.name) {
      onClose()
      return
    }
    // Left open on failure with the reason in place. Closing would look like it
    // worked, and the chip behind the popover would still read the old name.
    if (!renameLabel(label.id, next)) {
      setError(next ? 'Another keyword already has that name.' : 'A keyword needs a name.')
      return
    }
    onClose()
  }

  return (
    <>
      <div className="space-y-1.5">
        <label htmlFor={nameId} className="text-xs text-text-2">
          Rename
        </label>
        <div className="flex items-center gap-1.5">
          <Input
            id={nameId}
            value={draft}
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => {
              setDraft(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                save()
              }
            }}
          />
          <Button size="sm" onClick={save} disabled={!draft.trim()}>
            Save
          </Button>
        </div>
        {error ? (
          <p id={errorId} role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <span className="text-xs text-text-2">Colour</span>
        <ToneSwatches
          label={label.name}
          value={label.tone}
          onChange={(tone) => setTone(label.id, tone)}
        />
      </div>

      <button
        type="button"
        onClick={() => {
          // Closed first: the popover and the dialog both want focus, and the
          // one being dismissed should let go before the other takes it.
          onClose()
          onRequestDelete(label.id)
        }}
        className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-1 py-1.5 text-xs text-danger transition-colors hover:bg-danger-soft"
      >
        <Trash2 className="size-3.5 shrink-0" strokeWidth={1.9} aria-hidden />
        Delete keyword
        <span className="tabular ml-auto opacity-70">{usage(used)}</span>
      </button>
    </>
  )
}

/**
 * One keyword in the filter row: a toggle, and a menu for the keyword itself.
 *
 * The two are siblings inside the pill rather than nested, because a button
 * inside a button is invalid and the browser stops dispatching the inner one.
 * The border and tone therefore live on the wrapper, and each half rounds its
 * own end of it.
 */
export function KeywordChip({
  label,
  count,
  on,
  onToggle,
  onRequestDelete,
}: {
  label: Label
  count: number
  on: boolean
  onToggle: () => void
  onRequestDelete: (id: string) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <span
        // Right-click is the first thing anyone tries on a tag, and it is worth
        // honouring — but it is invisible and unreachable from a keyboard, so it
        // is the shortcut to the caret beside it, never the only way in.
        onContextMenu={(e) => {
          e.preventDefault()
          setOpen(true)
        }}
        className={cn(
          'flex items-center rounded-full border text-xs transition-colors',
          on
            ? toneClass[label.tone]
            : 'border-hairline bg-well text-text-3 hover:border-hairline-strong hover:text-text-2',
        )}
      >
        <button
          type="button"
          aria-pressed={on}
          onClick={onToggle}
          title={on ? `Stop filtering by ${label.name}` : `Filter by ${label.name}`}
          className="flex cursor-pointer items-center gap-1.5 rounded-l-full py-1 pr-1 pl-2.5"
        >
          {label.name}
          <span className="tabular opacity-70">{count}</span>
        </button>

        <PopoverTrigger
          aria-label={`Edit the keyword ${label.name}`}
          title="Rename, recolour or delete"
          // Full colour rather than dimmed until hover: it is a control, so the
          // glyph owes 3:1, and --text-3 has no headroom left to spend on
          // opacity — 60% of it lands at 2.3:1 on the chip's own background.
          //
          // `touch-target` because this is the control `index.css` names as the
          // example of one too small for any `size-*` selector to reach, and it
          // was not actually opted in: measured on a 390x844 phone it was a
          // 20x23 box with a 21x24 tap area, against the 44x44 the rest of the
          // app gets. Growing the chevron itself is not available — it is
          // stretched to the pill's height, and the pill's height is the
          // keyword's type size — so the catch area is the only lever.
          className="touch-target grid cursor-pointer place-items-center self-stretch rounded-r-full pr-1.5 pl-0.5"
        >
          <ChevronDown className="size-3" strokeWidth={2} aria-hidden />
        </PopoverTrigger>
      </span>

      <PopoverContent align="start" className="w-60">
        <KeywordMenu
          label={label}
          onClose={() => setOpen(false)}
          onRequestDelete={onRequestDelete}
        />
      </PopoverContent>
    </Popover>
  )
}
