/**
 * What is still to be done before this application is sent.
 *
 * ## The one card on this page that is TOUCHED rather than read
 *
 * Fit and Tailored materials are produced once and consulted. A checklist is
 * opened on a bus and tapped four times, and almost every decision here falls
 * out of that:
 *
 *   - It is NEVER blocked. A hand-typed list on a hand-entered application with
 *     no model connected is still a checklist. `blocked` withholds the Draft
 *     button alone; the list and the add box render in every state, which is
 *     also why this panel is never a title around nothing.
 *   - Nothing is disabled while a draft runs. The list stays tickable, because
 *     the tool reads the list inside its own transaction and a person waiting a
 *     minute for a model should not be locked out of their own to-do list.
 *   - A ticked step STAYS WHERE IT IS, struck through and muted. Anything that
 *     reorders on tick moves the next target out from under the finger between
 *     two taps.
 *   - Ticking raises no toast. The law asks that nothing be unrecoverable, and
 *     the checkbox is its own visible inverse; eight ticks would be eight
 *     toasts and the host discards the early ones anyway. Deleting does raise
 *     one, because that is the only action here that can lose something typed.
 *
 * ## Escape is stopped here on purpose
 *
 * `ApplicationDetail.tsx` installs a document-level Escape handler that closes
 * the whole record, deferring only to `defaultPrevented` and to dialogs. An
 * inline input is neither, so cancelling a half-typed step would dismiss the
 * record out from under the person.
 */

import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Check, Info, ListChecks, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react'
import type { ChecklistItem } from '@jojo/service/core/model'
import { Panel } from '@/components/common/Panel'
import { EmptyState } from '@/components/common/EmptyState'
import { MenuItem, RowMenu } from '@/components/common/RowMenu'
import { Button } from '@/components/ui/button'
import { useChecklist } from '@/lib/checklist-agent'
import { useToast } from '@/lib/toast-context'
import { supersededToast } from '@jojo/service/react/undo'
import { cn } from '@/lib/utils'

export function ChecklistPanel({ applicationId }: { applicationId: string }) {
  const c = useChecklist(applicationId)
  const { toast } = useToast()
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<string | null>(null)

  const busy = c.running !== null
  const blocker = c.blockerFor(draft)

  const commit = () => {
    const text = draft.trim()
    if (text === '' || blocker !== null) return
    const result = c.add(text)
    // Cleared and still focused: a checklist is written in a burst, and making
    // somebody click back into the box between two steps is the whole cost of
    // using it.
    if (result.ok) setDraft('')
    else
      toast({
        title: 'That step was not added',
        description: result.errors[0]?.message ?? '',
        tone: 'danger',
      })
  }

  const onDelete = (item: ChecklistItem) => {
    const done = c.remove(item.id)
    if (!done) return
    toast({
      title: 'Step deleted',
      description: item.text,
      action: done.restore
        ? {
            label: 'Undo',
            onClick: () => {
              const outcome = done.restore?.()
              if (outcome && outcome.superseded.length > 0) toast(supersededToast(outcome))
            },
          }
        : undefined,
    })
  }

  return (
    <Panel aria-labelledby={`checklist-${applicationId}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`checklist-${applicationId}`} className="flex items-center gap-2 font-medium">
          <ListChecks aria-hidden className="size-4 text-muted-foreground" />
          Checklist
          {c.items.length > 0 && (
            <span className="text-sm font-normal text-text-3">
              {c.open} open · {c.items.length} total
            </span>
          )}
        </h2>
        {/* Absent rather than disabled when there is no model or no posting,
            matching both siblings. The list below does not consult `blocked`. */}
        {c.blocked === null && !busy && (
          <Button size="sm" variant="outline" onClick={c.draft}>
            <Sparkles aria-hidden className="size-3.5" strokeWidth={1.8} />
            {c.items.length === 0 ? 'Draft a checklist' : 'Draft more'}
          </Button>
        )}
      </div>

      {/* ------------------------------ working ------------------------------ */}
      {busy && (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 aria-hidden className="size-3.5 animate-spin" />
          {c.step}…
          <Button variant="ghost" size="sm" className="ml-auto" onClick={c.cancel}>
            Cancel
          </Button>
        </p>
      )}

      {/* ------------------------------- the list ---------------------------- */}
      {c.items.length > 0 ? (
        <ul className="mt-3 flex flex-col">
          {c.items.map((item) => (
            <li
              key={item.id}
              className="group flex min-w-0 items-start gap-2 border-b border-hairline py-1.5 last:border-b-0"
            >
              <button
                type="button"
                role="checkbox"
                aria-checked={item.doneOn !== undefined}
                onClick={() => c.tick(item.id, item.doneOn === undefined)}
                /* `.touch-target` is load-bearing: an 18px box matches none of
                   index.css's size selectors, so without it this is an 18×18
                   target on a phone — on the one control the card exists for. */
                className="touch-target mt-0.5 grid size-[18px] shrink-0 cursor-pointer place-items-center rounded border border-hairline text-transparent transition-colors hover:border-accent aria-checked:border-accent aria-checked:bg-accent aria-checked:text-white"
              >
                <Check className="size-3" strokeWidth={3} aria-hidden />
              </button>

              {editing === item.id ? (
                <input
                  autoFocus
                  defaultValue={item.text}
                  aria-label="Step"
                  className="min-w-0 flex-1 border-b border-accent bg-transparent text-sm outline-none"
                  onBlur={(e) => {
                    const next = e.currentTarget.value.trim()
                    if (next !== '' && next !== item.text) c.rename(item.id, next)
                    setEditing(null)
                  }}
                  onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') {
                      // Or the record itself closes. See the header.
                      e.preventDefault()
                      e.stopPropagation()
                      setEditing(null)
                    }
                  }}
                />
              ) : (
                <span
                  className={cn(
                    'min-w-0 flex-1 text-sm',
                    item.doneOn !== undefined && 'text-text-3 line-through',
                  )}
                >
                  {item.text}
                  {item.by && (
                    <span
                      className="ml-1.5 align-middle text-[11px] text-text-3"
                      title={`Drafted by ${item.by.model}`}
                    >
                      jojo
                    </span>
                  )}
                </span>
              )}

              <RowMenu name={item.text} className="-my-1 shrink-0">
                <MenuItem onSelect={() => setEditing(item.id)}>Edit</MenuItem>
                <MenuItem icon={Trash2} danger onSelect={() => onDelete(item)}>
                  Delete
                </MenuItem>
              </RowMenu>
            </li>
          ))}
        </ul>
      ) : (
        !busy && (
          <EmptyState
            icon={ListChecks}
            title="Nothing on the list yet"
            description={
              c.blocked === 'no-posting'
                ? 'There is no saved posting behind this application, so jojo cannot read what it asks you to send. You can still add your own steps.'
                : c.blocked === 'no-model'
                  ? 'Drafting a checklist needs a model. Connect one in Settings, or add your own steps below.'
                  : 'Ask jojo to read the posting for what you have to send, or add your own steps below.'
            }
          />
        )
      )}

      {/* --------------------------- add your own ---------------------------- */}
      <div className="mt-2 flex items-center gap-2 border-t border-hairline pt-2">
        <Plus aria-hidden className="size-3.5 shrink-0 text-text-3" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          placeholder="Add a step"
          aria-label="Add a step"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-text-3"
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              setDraft('')
            }
          }}
          onBlur={commit}
        />
      </div>
      {blocker !== null && <p className="mt-1 text-xs text-danger">{blocker}</p>}

      {/* ------------------------- what went wrong --------------------------- */}
      {c.error !== null && !busy && (
        <div className="mt-3 text-sm">
          <p className="text-danger">{c.error}</p>
          <Button className="mt-2" size="sm" variant="ghost" onClick={c.draft}>
            Try again
          </Button>
        </div>
      )}

      {/* Doubts, not failures: the list was drafted and saved. */}
      {c.notes.length > 0 && !busy && (
        <ul className="mt-3 space-y-1">
          {c.notes.map((note) => (
            <li key={note} className="flex items-start gap-2 text-sm text-text-3">
              <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span>{note}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
