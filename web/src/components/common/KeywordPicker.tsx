import { useState } from 'react'
import { Check, Tag } from 'lucide-react'
import { Chip } from '@/components/common/Chip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useLabels } from '@/lib/labels-context'
import { cn } from '@/lib/utils'

/**
 * Pick keywords for a record that may not exist yet, without writing any.
 *
 * `LabelPicker` writes straight through to the label store. That is right beside
 * a saved row — the click *is* the edit — and wrong inside a form, for two
 * reasons: a record being created has no id to write to, and inside an edit form
 * it commits keywords that Cancel is supposed to discard. Cancelling a dialog
 * and finding half your changes kept is the kind of thing that stops people
 * trusting an app with anything they care about.
 *
 * So this holds the selection and hands it back for the caller to commit on
 * save. Lifted out of `ApplicationDialog` because the timeline dialog had the
 * same problem and had solved it a different way — with a scratch record id in
 * the label store, which meant an abandoned reminder still left keywords behind.
 */
export function KeywordPicker({
  value,
  onChange,
}: {
  value: string[]
  onChange: (next: string[]) => void
}) {
  const { labels, addLabel } = useLabels()
  const [draft, setDraft] = useState('')

  const picked = new Set(value)
  const toggle = (labelId: string) =>
    onChange(picked.has(labelId) ? value.filter((v) => v !== labelId) : [...value, labelId])

  const create = () => {
    const name = draft.trim()
    if (!name) return
    // Returns the existing id when the name is already taken, so typing a
    // keyword that exists selects it rather than minting a duplicate.
    const labelId = addLabel(name)
    if (!picked.has(labelId)) onChange([...value, labelId])
    setDraft('')
  }

  const chosen = labels.filter((l) => picked.has(l.id))

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chosen.length === 0 ? (
        <span className="text-xs text-text-3">None yet</span>
      ) : (
        chosen.map((l) => (
          <Chip key={l.id} tone={l.tone} shape="capsule">
            {l.name}
          </Chip>
        ))
      )}

      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="xs">
            <Tag aria-hidden strokeWidth={1.8} />
            Choose keywords
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56">
          <div className="px-0.5 text-xs tracking-wide text-text-3 uppercase">Keywords</div>
          <ul className="flex flex-col">
            {labels.map((l) => {
              const on = picked.has(l.id)
              return (
                <li key={l.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggle(l.id)}
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
              // Enter has to finish the keyword rather than submit the form
              // behind it — that would save the record mid-thought.
              if (e.key === 'Enter') {
                e.preventDefault()
                create()
              }
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
