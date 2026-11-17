import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { BellPlus, Palette, Plus, StickyNote as StickyIcon, X } from 'lucide-react'
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
import { reminderFromNote } from '@jojo/service/core/sticky'
import { TODAY } from '@/lib/today'
import { cn } from '@/lib/utils'
import { isCommitEnter } from '@/components/common/enter-key'
import { useDomain } from '@/i18n/domain'

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
  const { t } = useTranslation('dashboard')
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
        // The note shows focus, not the borderless field inside it: with the
        // field's own ring zeroed, focusing it changed nothing but the caret.
        className={cn(
          'rounded-md border p-2 transition-shadow has-[textarea:focus-visible]:ring-3 has-[textarea:focus-visible]:ring-ring/50',
          toneClass[tone],
          'text-text-1',
        )}
      >
        <Label htmlFor="sticky-draft" className="sr-only">
          {t('sticky.newNote')}
        </Label>
        <Textarea
          id="sticky-draft"
          value={draft}
          rows={2}
          maxLength={MAX_STICKY_TEXT}
          placeholder={t('sticky.placeholder')}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKey}
          className="field-sizing-fixed h-14 resize-none border-0 bg-transparent p-0 text-[13px] shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <ToneMenu tone={tone} onPick={setTone} label={t('sticky.newColour')} />
          <Button type="submit" size="xs" disabled={!draft.trim()}>
            <Plus className="size-3" strokeWidth={2} aria-hidden />
            {t('sticky.stick')}
          </Button>
        </div>
      </form>

      {notes.length === 0 ? (
        <p className="flex items-start gap-2 text-xs leading-relaxed text-text-3">
          <StickyIcon className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.8} aria-hidden />
          {t('sticky.empty')}
        </p>
      ) : (
        /* Padded out to the full reach of `--shadow-sticky` (7px a side, 11px
           below) and pulled back by the same amount: a scroll box clips
           whatever overflows it, and a shadow cut off at the box's edge is a
           square-cornered smudge under a rounded note. */
        <ul
          aria-label={t('sticky.listLabel')}
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
  const { t } = useTranslation('dashboard')
  const domain = useDomain()
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
    } else if (isCommitEnter(event) && (event.metaKey || event.ctrlKey)) {
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
            {t('sticky.editNote')}
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
          title={t('sticky.clickToEdit')}
          aria-label={t('sticky.editAria', { text: first })}
          // A flex box so the text sits at the top: a button centres its
          // content vertically, and a one-line note floated mid-card.
          className="flex flex-1 cursor-text items-start text-start text-[13px] leading-relaxed"
        >
          <span className="line-clamp-6 wrap-anywhere whitespace-pre-wrap">{note.text}</span>
        </button>
      )}

      <div className="mt-2 flex items-center gap-0.5">
        <span className="me-auto text-[11px] text-text-3">
          {domain.ago(dayOf(note.createdAt), TODAY)}
        </span>
        <ToneMenu tone={note.tone} onPick={onTone} label={t('sticky.colourOf', { text: first })} />
        <button
          type="button"
          onClick={onReminder}
          title={t('sticky.toReminder')}
          aria-label={t('sticky.toReminderAria', { text: first })}
          className={ICON_BUTTON}
        >
          <BellPlus className="size-3.5" strokeWidth={1.8} aria-hidden />
        </button>
        <button
          type="button"
          onClick={onRemove}
          title={t('sticky.takeDown')}
          aria-label={t('sticky.removeAria', { text: first })}
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
  const { t } = useTranslation('dashboard')
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger aria-label={label} title={t('sticky.colour')} className={ICON_BUTTON}>
        <Palette className="size-3.5" strokeWidth={1.8} aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-2">
        <div className="grid grid-cols-4 gap-1.5">
          {TONE_ORDER.map((swatch) => (
            <button
              key={swatch}
              type="button"
              aria-label={toneName[swatch]}
              aria-pressed={swatch === tone}
              title={toneName[swatch]}
              onClick={() => {
                setOpen(false)
                onPick(swatch)
              }}
              className={cn(
                'size-6 cursor-pointer rounded-full ring-offset-2 ring-offset-page transition-shadow',
                toneFill[swatch],
                swatch === tone ? 'ring-2 ring-text-1' : 'hover:ring-2 hover:ring-hairline-strong',
              )}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
