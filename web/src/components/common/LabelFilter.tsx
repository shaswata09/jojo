import { useState } from 'react'
import { Plus, Tag, X } from 'lucide-react'
import { DeleteKeywordDialog } from '@/components/common/DeleteKeywordDialog'
import { KeywordChip } from '@/components/common/KeywordChip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useLabels } from '@/lib/labels-context'
import { cn } from '@/lib/utils'

/**
 * Filter by the user's own keywords, and manage them in place.
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
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  const create = () => {
    const name = draft.trim()
    if (!name) return
    const id = addLabel(name)
    // Selected only when something already carries it — which is what happens
    // when you type the name of a keyword that exists, and is a request to
    // filter by it. A keyword that is genuinely new is on nothing yet, so
    // selecting it would empty every list on the page the moment it was
    // created, and that reads as the page breaking rather than as a filter.
    if (id && countFor(id) > 0 && !selected.has(id)) toggleSelected(id)
    setDraft('')
    setOpen(false)
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <Tag aria-hidden strokeWidth={1.8} className="size-3.5 shrink-0 text-text-3" />

      {/* Deleting the last keyword is reachable from the chip menu, and left
          the row as a bare tag icon beside an unlabelled plus — an affordance
          with nothing to say what it adds. */}
      {labels.length === 0 ? (
        <span className="text-xs text-text-3">No keywords yet — add one to filter by it.</span>
      ) : null}

      <div role="group" aria-label="Filter by keyword" className="flex flex-wrap gap-1.5">
        {labels.map((l) => (
          <KeywordChip
            key={l.id}
            label={l}
            on={selected.has(l.id)}
            count={scopeIds ? countWithin(l.id, scopeIds) : countFor(l.id)}
            onToggle={() => toggleSelected(l.id)}
            onRequestDelete={setPendingDelete}
          />
        ))}
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

      <DeleteKeywordDialog
        id={pendingDelete}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null)
        }}
      />
    </div>
  )
}
