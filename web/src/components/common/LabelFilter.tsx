import { useId, useState } from 'react'
import { Check, ChevronDown, Plus, Tag, Trash2, X } from 'lucide-react'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { Label, LabelTone } from '@/data/labels'
import { useLabels } from '@/lib/labels-context'
import { useToast } from '@/lib/toast-context'
import { cn } from '@/lib/utils'

const toneClass: Record<LabelTone, string> = {
  teal: 'border-info-border bg-info-soft text-info',
  amber: 'border-warning-border bg-warning-soft text-warning',
  red: 'border-danger-border bg-danger-soft text-danger',
  green: 'border-success-border bg-success-soft text-success',
  gray: 'border-hairline bg-well text-text-2',
}

/**
 * Solid fills for the swatches. The chip backgrounds above are the `-soft`
 * steps, which at swatch size are five near-identical pale discs — you cannot
 * pick a colour from a palette you cannot tell apart.
 */
const toneFill: Record<LabelTone, string> = {
  teal: 'bg-info',
  amber: 'bg-warning',
  red: 'bg-danger',
  green: 'bg-success',
  gray: 'bg-text-3',
}

/** What each tone is called out loud. 'teal' is the type's name for the blue. */
const toneName: Record<LabelTone, string> = {
  teal: 'Blue',
  green: 'Green',
  amber: 'Amber',
  red: 'Red',
  gray: 'Grey',
}

const TONE_ORDER = ['teal', 'green', 'amber', 'red', 'gray'] as const satisfies readonly LabelTone[]

/** "9 records" / "1 record" — used in the menu, the confirm and the undo toast. */
function usage(n: number) {
  return n === 1 ? '1 record' : `${n} records`
}

/**
 * The five tones, as pickable discs.
 *
 * The tick is the selection cue rather than a ring, because a ring drawn with
 * `outline` would fight the app's global focus ring and one drawn with a border
 * shrinks the disc as you click through them. It is painted `text-panel`, which
 * is white on the light theme's dark fills and near-black on the dark theme's
 * bright ones — the one token that stays legible on all five in both themes.
 */
export function ToneSwatches({
  value,
  onChange,
  label,
  className,
}: {
  value: LabelTone
  onChange: (tone: LabelTone) => void
  /** The keyword being recoloured, so the group says which one it belongs to. */
  label: string
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={`Colour for ${label}`}
      className={cn('flex items-center gap-1.5', className)}
    >
      {TONE_ORDER.map((tone) => (
        <button
          key={tone}
          type="button"
          aria-pressed={tone === value}
          aria-label={toneName[tone]}
          title={toneName[tone]}
          onClick={() => onChange(tone)}
          className={cn(
            'grid size-4 cursor-pointer place-items-center rounded-full text-panel transition-transform hover:scale-110',
            toneFill[tone],
          )}
        >
          {tone === value ? <Check className="size-2.5" strokeWidth={3.5} aria-hidden /> : null}
        </button>
      ))}
    </div>
  )
}

/**
 * The confirmation and the undo for deleting a keyword.
 *
 * Both, deliberately. The keyword itself is cheap — retype the name — but its
 * edges are not: putting "Referral" back by hand means finding the nine records
 * it was on again, which is exactly what `restore` rebuilds. So the dialog
 * guards the mis-click, and the toast guards the change of mind.
 *
 * Driven by an id rather than owning the pending state, so one dialog serves a
 * whole row of chips instead of mounting a copy per keyword.
 */
export function DeleteKeywordDialog({
  id,
  onOpenChange,
}: {
  /** The keyword awaiting confirmation, or null when nothing is pending. */
  id: string | null
  onOpenChange: (open: boolean) => void
}) {
  const { labels, removeLabel, countFor } = useLabels()
  const { toast } = useToast()

  const label = id ? (labels.find((l) => l.id === id) ?? null) : null
  const used = label ? countFor(label.id) : 0

  const onConfirm = () => {
    if (!label) return
    const { restore } = removeLabel(label.id)
    toast({
      title: `${label.name} deleted`,
      description:
        used === 0
          ? 'It was not on any record.'
          : `Taken off ${usage(used)}, and out of the keyword filter.`,
      tone: 'danger',
      action: { label: 'Undo', onClick: restore },
    })
  }

  return (
    <ConfirmDialog
      open={label !== null}
      onOpenChange={onOpenChange}
      title={label ? `Delete ${label.name}?` : 'Delete keyword?'}
      description={
        used === 0
          ? 'Not on any record yet, so nothing else changes.'
          : `Used on ${usage(used)}. Those records stay — they lose this keyword.`
      }
      confirmLabel="Delete keyword"
      tone="danger"
      onConfirm={onConfirm}
    />
  )
}

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
function KeywordChip({
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
          className="grid cursor-pointer place-items-center self-stretch rounded-r-full pr-1.5 pl-0.5"
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
