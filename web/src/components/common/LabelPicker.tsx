import { useState } from 'react'
import { Check, Tag } from 'lucide-react'
import { toneClass } from '@/components/common/label-display'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useLabels } from '@/lib/labels-context'
import { cn } from '@/lib/utils'

/**
 * The keywords on one record: the picker that edits them, and the chips that
 * show them. They sit together because they are the same thing seen twice —
 * every row that can be tagged renders both, and the reader who wants to know
 * how a record's keywords behave wants both answers in one file.
 */

/**
 * Attach or remove keywords on one record.
 *
 * Without this the filter is a dead end: you can invent a keyword but nothing
 * can carry it, so it would filter to nothing forever. Kept beside the record
 * rather than in a separate editor, because tagging is something you do while
 * reading the row, not a trip to a settings screen.
 */
export function LabelPicker({
  recordId,
  name,
  className,
}: {
  recordId: string
  /**
   * What the record is called. A table of eight rows otherwise ships eight
   * buttons all named "Edit keywords", which is unusable from a screen reader's
   * element list — there is no way to tell which row you are about to tag.
   */
  name?: string
  className?: string
}) {
  const { labels, labelsOf, toggleOn, addLabel } = useLabels()
  const [draft, setDraft] = useState('')
  const mine = new Set(labelsOf(recordId).map((l) => l.id))
  const trigger = name ? `Edit keywords on ${name}` : 'Edit keywords'

  const create = () => {
    const typed = draft.trim()
    if (!typed) return
    const id = addLabel(typed)
    if (!mine.has(id)) toggleOn(recordId, id)
    setDraft('')
  }

  return (
    <Popover>
      <PopoverTrigger
        aria-label={trigger}
        title={trigger}
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
