import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import { BellPlus, Palette, Plus, StickyNote as StickyIcon, X } from 'lucide-react'
import { agoLabel } from '@jojo/service/core/dates'
import type { LabelTone, StickyNote } from '@jojo/service/core/model'
import { DEFAULT_STICKY_TONE, MAX_STICKY_TEXT } from '@jojo/service/core/model'
import { dayOf } from '@jojo/service/core/project'
import { useStickyNotes } from '@jojo/service/react/use-sticky-notes'
import { TONE_ORDER, toneClass, toneFill, toneName } from '@/components/common/label-display'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { fromReactKey, shouldSend } from '@/lib/composer-keys'
import { useDialogs } from '@/lib/dialogs-context'
import { reminderFromNote } from '@/lib/sticky'
import { TODAY } from '@/lib/today'
import { cn } from '@/lib/utils'

/**
 * The dashboard's sticky notes: notes to self, quick to write and quick to
 * throw away.
 *
 * Paper stickies are the model, and each choice follows from it. Writing one
 * is a box that is always open, because a thought that needs a button pressed
 * first is a thought lost. A note is edited where it sits. Colour is the only
 * organisation there is. And a note that turns out to have a date becomes a
 * reminder, through the reminder dialog, rather than growing a date of its own.
 */
export function StickyBoard() {
  const { notes, create, update, remove } = useStickyNotes()
  const { open } = useDialogs()
  const [draft, setDraft] = useState('')
  const [tone, setTone] = useState<LabelTone>(DEFAULT_STICKY_TONE)

  const add = () => {
    const text = draft.trim()
    if (!text) return
    if (create(text, tone) !== null) setDraft('')
  }

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!shouldSend(fromReactKey(event))) return
    event.preventDefault()
    add()
  }

  const toReminder = (note: StickyNote) =>
    open('timelineItem', { mode: 'reminder', initial: reminderFromNote(note.text, TODAY) })

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          add()
        }}
        className={cn('rounded-md border p-2', toneClass[tone], 'text-text-1')}
      >
        <Label htmlFor="sticky-draft" className="sr-only">
          New sticky note
        </Label>
        <Textarea
          id="sticky-draft"
          value={draft}
          rows={2}
          maxLength={MAX_STICKY_TEXT}
          placeholder="Jot a note to self… (Enter to stick it)"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKey}
          className="field-sizing-fixed h-14 resize-none border-0 bg-transparent p-0 text-[13px] shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <ToneMenu tone={tone} onPick={setTone} label="Colour for the new note" />
          <Button type="submit" size="xs" disabled={!draft.trim()}>
            <Plus className="size-3" strokeWidth={2} aria-hidden />
            Stick it
          </Button>
        </div>
      </form>

      {notes.length === 0 ? (
        <p className="flex items-start gap-2 text-xs leading-relaxed text-text-3">
          <StickyIcon className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.8} aria-hidden />
          Nothing stuck up yet. Notes stay here until you take them down, and any of them can become
          a reminder once it has a date.
        </p>
      ) : (
        /* Padded out to the full reach of `--shadow-sticky` (7px a side, 11px
           below) and pulled back by the same amount: a scroll box clips
           whatever overflows it, and a shadow cut off at the box's edge is a
           square-cornered smudge under a rounded note. */
        <ul
          aria-label="Sticky notes"
          className="-mx-2.5 -mt-1 -mb-3 grid max-h-[26rem] grid-cols-1 gap-2.5 overflow-y-auto px-2.5 pt-1 pb-3 min-[420px]:grid-cols-2"
        >
          {notes.map((note) => (
            <StickyCard
              key={note.id}
              note={note}
              onSave={(text) => update(note.id, { text })}
              onTone={(next) => update(note.id, { tone: next })}
              onRemove={() => remove(note.id)}
              onReminder={() => toReminder(note)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function StickyCard({
  note,
  onSave,
  onTone,
  onRemove,
  onReminder,
}: {
  note: StickyNote
  onSave: (text: string) => void
  onTone: (tone: LabelTone) => void
  onRemove: () => void
  onReminder: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(note.text)
  const first = note.text.trim().split('\n')[0] ?? ''

  const begin = () => {
    setText(note.text)
    setEditing(true)
  }

  /*
   * Saved on blur as well as on ⌘/Ctrl+Enter, because a paper sticky has no
   * Save button and clicking away is how people finish. Emptying a note does
   * not delete it — that is what ✕ is for, with an Undo — so an emptied note
   * just goes back to what it said.
   */
  const finish = () => {
    setEditing(false)
    const clean = text.trim()
    if (clean && clean !== note.text) onSave(clean)
  }

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setText(note.text)
      setEditing(false)
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      finish()
    }
  }

  return (
    <li
      className={cn(
        'flex min-h-[6.5rem] flex-col rounded-md border p-2.5 shadow-[var(--shadow-sticky)]',
        toneClass[note.tone],
        'text-text-1',
      )}
    >
      {editing ? (
        <>
          <Label htmlFor={`sticky-${note.id}`} className="sr-only">
            Edit note
          </Label>
          <Textarea
            id={`sticky-${note.id}`}
            autoFocus
            value={text}
            maxLength={MAX_STICKY_TEXT}
            onChange={(event) => setText(event.target.value)}
            // The caret at the end: clicking a note to add to it is the
            // common case, and `autoFocus` alone leaves it before the first word.
            onFocus={(event) => {
              const end = event.currentTarget.value.length
              event.currentTarget.setSelectionRange(end, end)
            }}
            onBlur={finish}
            onKeyDown={onKey}
            className="field-sizing-fixed min-h-16 flex-1 resize-none border-0 bg-transparent p-0 text-[13px] shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
        </>
      ) : (
        <button
          type="button"
          onClick={begin}
          title="Click to edit"
          aria-label={`Edit note: ${first}`}
          // A flex box so the text sits at the top: a button centres its
          // content vertically, and a one-line note floated mid-card.
          className="flex flex-1 cursor-text items-start text-left text-[13px] leading-relaxed"
        >
          <span className="line-clamp-6 wrap-anywhere whitespace-pre-wrap">{note.text}</span>
        </button>
      )}

      <div className="mt-2 flex items-center gap-0.5">
        <span className="mr-auto text-[11px] text-text-3">
          {agoLabel(dayOf(note.createdAt), TODAY)}
        </span>
        <ToneMenu tone={note.tone} onPick={onTone} label={`Colour of the note "${first}"`} />
        <button
          type="button"
          onClick={onReminder}
          title="Turn into a reminder"
          aria-label={`Turn into a reminder: ${first}`}
          className={ICON_BUTTON}
        >
          <BellPlus className="size-3.5" strokeWidth={1.8} aria-hidden />
        </button>
        <button
          type="button"
          onClick={onRemove}
          title="Take this note down"
          aria-label={`Remove note: ${first}`}
          className={ICON_BUTTON}
        >
          <X className="size-3.5" strokeWidth={1.8} aria-hidden />
        </button>
      </div>
    </li>
  )
}

const ICON_BUTTON =
  'touch-target grid size-6 shrink-0 cursor-pointer place-items-center rounded-sm text-text-3 transition-colors hover:bg-[color-mix(in_oklab,currentColor_10%,transparent)] hover:text-text-1'

/** The eight keyword colours, as swatches. Picking one closes the menu. */
function ToneMenu({
  tone,
  onPick,
  label,
}: {
  tone: LabelTone
  onPick: (tone: LabelTone) => void
  label: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger aria-label={label} title="Colour" className={ICON_BUTTON}>
        <Palette className="size-3.5" strokeWidth={1.8} aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-2">
        <div className="grid grid-cols-4 gap-1.5">
          {TONE_ORDER.map((t) => (
            <button
              key={t}
              type="button"
              aria-label={toneName[t]}
              aria-pressed={t === tone}
              title={toneName[t]}
              onClick={() => {
                setOpen(false)
                onPick(t)
              }}
              className={cn(
                'size-6 cursor-pointer rounded-full ring-offset-2 ring-offset-page transition-shadow',
                toneFill[t],
                t === tone ? 'ring-2 ring-text-1' : 'hover:ring-2 hover:ring-hairline-strong',
              )}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
