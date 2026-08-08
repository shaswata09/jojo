import { useState } from 'react'
import { Check, Plus, Tag, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useLabels } from '@/lib/labels-context'
import { cn } from '@/lib/utils'

const toneClass: Record<string, string> = {
  teal: 'border-info-border bg-info-soft text-info',
  amber: 'border-warning-border bg-warning-soft text-warning',
  red: 'border-danger-border bg-danger-soft text-danger',
  green: 'border-success-border bg-success-soft text-success',
  gray: 'border-hairline bg-well text-text-2',
}

/**
 * Filter by the user's own keywords, and add new ones.
 *
 * Multi-select rather than the single-choice chips used for fixed buckets:
 * keywords are not mutually exclusive, and picking a second one should widen
 * the view rather than narrow it to an intersection nobody asked for.
 *
 * Selecting nothing means everything, so the list opens unfiltered and clearing
 * the filter is the same gesture as never having set one.
 */
export function LabelFilter({
  className,
  scopeIds,
}: {
  className?: string
  /**
   * Records the counts should be taken from — the collection currently on
   * screen. Without it a chip in the Files tab would report every reminder and
   * application carrying that keyword too, which is a number about somewhere
   * else. Omit to count everything.
   */
  scopeIds?: readonly string[]
}) {
  const { labels, selected, toggleSelected, clearSelected, addLabel, countFor, countWithin } =
    useLabels()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')

  const create = () => {
    const name = draft.trim()
    if (!name) return
    const id = addLabel(name)
    // Select it immediately — you added it to use it.
    if (!selected.has(id)) toggleSelected(id)
    setDraft('')
    setOpen(false)
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <Tag aria-hidden strokeWidth={1.8} className="size-3.5 shrink-0 text-text-3" />

      <div role="group" aria-label="Filter by keyword" className="flex flex-wrap gap-1.5">
        {labels.map((l) => {
          const on = selected.has(l.id)
          const count = scopeIds ? countWithin(l.id, scopeIds) : countFor(l.id)
          return (
            <button
              key={l.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggleSelected(l.id)}
              title={on ? `Stop filtering by ${l.name}` : `Filter by ${l.name}`}
              className={cn(
                'flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
                on
                  ? toneClass[l.tone]
                  : 'border-hairline bg-well text-text-3 hover:border-hairline-strong hover:text-text-2',
              )}
            >
              {l.name}
              <span className="tabular opacity-70">{count}</span>
            </button>
          )
        })}
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label="New keyword"
          title="New keyword"
          className="grid size-6 cursor-pointer place-items-center rounded-full border border-dashed border-hairline-strong text-text-3 transition-colors hover:text-text-1"
        >
          <Plus className="size-3.5" strokeWidth={2} aria-hidden />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56">
          <label htmlFor="new-keyword" className="text-xs text-text-2">
            New keyword
          </label>
          <Input
            id="new-keyword"
            value={draft}
            autoComplete="off"
            placeholder="e.g. Developer"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter is how anyone types a tag; requiring the mouse for the
              // last step would undo the point of an inline field.
              if (e.key === 'Enter') {
                e.preventDefault()
                create()
              }
            }}
          />
          <Button size="sm" onClick={create} disabled={!draft.trim()}>
            Add keyword
          </Button>
        </PopoverContent>
      </Popover>

      {selected.size > 0 ? (
        <button
          type="button"
          onClick={clearSelected}
          className="flex cursor-pointer items-center gap-1 rounded-full px-1.5 py-1 text-xs text-text-3 transition-colors hover:text-text-1"
        >
          <X className="size-3" strokeWidth={2} aria-hidden />
          Clear
        </button>
      ) : null}
    </div>
  )
}

/**
 * Attach or remove keywords on one record.
 *
 * Without this the filter is a dead end: you can invent a keyword but nothing
 * can carry it, so it would filter to nothing forever. Kept beside the record
 * rather than in a separate editor, because tagging is something you do while
 * reading the row, not a trip to a settings screen.
 */
export function LabelPicker({ recordId, className }: { recordId: string; className?: string }) {
  const { labels, labelsOf, toggleOn, addLabel } = useLabels()
  const [draft, setDraft] = useState('')
  const mine = new Set(labelsOf(recordId).map((l) => l.id))

  const create = () => {
    const name = draft.trim()
    if (!name) return
    const id = addLabel(name)
    if (!mine.has(id)) toggleOn(recordId, id)
    setDraft('')
  }

  return (
    <Popover>
      <PopoverTrigger
        aria-label="Edit keywords"
        title="Edit keywords"
        className={cn(
          'grid size-6 shrink-0 cursor-pointer place-items-center rounded-full text-text-3 transition-colors hover:bg-well hover:text-text-1 data-[state=open]:bg-well data-[state=open]:text-text-1',
          className,
        )}
      >
        <Tag className="size-3.5" strokeWidth={1.8} aria-hidden />
      </PopoverTrigger>

      <PopoverContent align="end" className="w-56">
        <div className="px-0.5 text-xs tracking-wide text-text-3 uppercase">Keywords</div>
        <ul className="flex flex-col">
          {labels.map((l) => {
            const on = mine.has(l.id)
            return (
              <li key={l.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => toggleOn(recordId, l.id)}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-1 py-1.5 text-xs text-text-2 transition-colors hover:bg-well hover:text-text-1"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'grid size-3.5 shrink-0 place-items-center rounded-[3px] border',
                      on
                        ? 'border-accent bg-accent text-[color:var(--accent-fg)]'
                        : 'border-hairline-strong',
                    )}
                  >
                    {on ? <Check className="size-2.5" strokeWidth={3} /> : null}
                  </span>
                  {l.name}
                </button>
              </li>
            )
          })}
        </ul>

        <Input
          value={draft}
          autoComplete="off"
          placeholder="New keyword…"
          aria-label="New keyword"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              create()
            }
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

/** The keywords on one record, shown inline. Read-only. */
export function LabelChips({ recordId, className }: { recordId: string; className?: string }) {
  const { labelsOf } = useLabels()
  const mine = labelsOf(recordId)
  if (mine.length === 0) return null

  return (
    <span className={cn('flex flex-wrap items-center gap-1', className)}>
      {mine.map((l) => (
        <span
          key={l.id}
          className={cn(
            'rounded-full border px-1.5 py-px text-xs whitespace-nowrap',
            toneClass[l.tone],
          )}
        >
          {l.name}
        </span>
      ))}
    </span>
  )
}
