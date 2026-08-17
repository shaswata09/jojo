import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { Field, FormField, TextareaField } from '@/components/common/Field'
import { KeywordPicker } from '@/components/common/KeywordPicker'
import { ApplicationLinkField } from '@/components/timeline/dialog/ApplicationLinkField'
import { KindGrid } from '@/components/timeline/dialog/KindGrid'
import { ScheduleFields } from '@/components/timeline/dialog/ScheduleFields'
import {
  DEFAULT_DURATION_MINS,
  DEFAULT_START_MINS,
  EVENT_KIND_FOR_STAGE,
  REMINDER_KIND_FOR_STAGE,
  clockValue,
  minutesOf,
} from '@/components/timeline/dialog/item-defaults'
import { Button } from '@/components/ui/button'
import { DialogClose, DialogFooter } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { shortDate, whenLabel } from '@/data/timeline'
import type { TimelineItem, TimelineKind } from '@/data/timeline'
import { useApplications } from '@jojo/service/react/use-applications'
import { useTimeline } from '@jojo/service/react/use-timeline'
import { useLabels } from '@/lib/labels-context'
import { useToast } from '@/lib/toast-context'
import { TODAY } from '@/lib/today'

export function ItemForm({
  mode,
  initial,
  onOpenChange,
  onSaved,
}: {
  mode: 'reminder' | 'event'
  /** Pass one with an `id` to edit; anything else prefills a new record. */
  initial?: Partial<TimelineItem>
  onOpenChange: (open: boolean) => void
  onSaved?: (item: TimelineItem) => void
}) {
  const { all: applications, byId } = useApplications()
  const { get, add, update, remove } = useTimeline()
  const { labelIdsOf, setRecord, removeRecord } = useLabels()
  const { toast } = useToast()

  const editingId = initial?.id
  const stored = editingId ? get(editingId) : undefined

  const [title, setTitle] = useState(initial?.title ?? '')
  const [applicationId, setApplicationId] = useState(initial?.applicationId)
  const [date, setDate] = useState(initial?.date ?? TODAY)
  const [allDay, setAllDay] = useState(initial?.allDay ?? initial?.startMins === undefined)
  // Held apart from `allDay` so flipping the switch off and on again gives back
  // the time that was typed rather than the default.
  const [time, setTime] = useState(clockValue(initial?.startMins ?? DEFAULT_START_MINS))
  const [duration, setDuration] = useState(initial?.durationMins ?? DEFAULT_DURATION_MINS)
  const [kind, setKind] = useState<TimelineKind>(
    // A reminder is a thing you are waiting on someone else for far more often
    // than not, and `follow-up` is the only kind the dashboard's rail reads.
    initial?.kind ?? (mode === 'reminder' ? 'follow-up' : 'interview'),
  )
  // Once the user has touched Kind, linking an application must not overrule
  // them. Editing counts as touched: the stored kind is a decision already made.
  const [kindTouched, setKindTouched] = useState(initial?.kind !== undefined)
  const [detail, setDetail] = useState(initial?.detail ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [remind, setRemind] = useState(initial?.remind ?? mode === 'reminder')
  /**
   * Keywords are staged, not written on click.
   *
   * This used to write straight through to the label store against a scratch id
   * for a new record and against the real id when editing — which meant Cancel
   * kept the keywords and threw away the title. `KeywordPicker` holds the set
   * and `submit` commits it, so the whole dialog now has one answer to Cancel.
   */
  const [keywords, setKeywords] = useState<string[]>(() => (editingId ? labelIdsOf(editingId) : []))
  // Raised by a save attempt, not by typing: naming a field empty before anyone
  // has reached it is nagging, not help.
  const [submitted, setSubmitted] = useState(false)

  const remindId = useId()
  const kindHintId = useId()

  const titleError = submitted && !title.trim() ? 'Give it a title you will recognise.' : undefined
  const dateError =
    submitted && !date ? 'Pick a date — an undated item has nowhere to appear.' : undefined

  const selectedApp = applicationId ? byId.get(applicationId) : undefined

  /**
   * Linking an application is the strongest hint the dialog ever gets about what
   * the record is: "chase" for something submitted, "prep" for an interview.
   * Only applied while the user has not chosen a kind themselves.
   */
  const linkApplication = (id: string | undefined) => {
    setApplicationId(id)
    if (kindTouched || !id) return
    const stage = byId.get(id)?.stage
    if (!stage) return
    setKind(mode === 'reminder' ? REMINDER_KIND_FOR_STAGE[stage] : EVENT_KIND_FOR_STAGE[stage])
  }

  const chooseKind = (next: TimelineKind) => {
    setKindTouched(true)
    setKind(next)
  }

  /** Replaces the record's whole keyword set, or forgets it when none are left. */
  const commitKeywords = (id: string) => {
    if (keywords.length > 0) setRecord(id, keywords)
    // `setRecord(id, [])` files the record as carrying no keywords, which is a
    // different thing from never having been mentioned — and it is the second
    // that a record with every keyword removed should go back to being.
    else removeRecord(id)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setSubmitted(true)

    const cleanTitle = title.trim()
    if (!cleanTitle || !date) return

    // An empty time with the switch off is still an all-day item: the model says
    // `startMins` is undefined whenever `allDay`, and half a timed item would
    // render as a blank slot on the hour grid.
    const startMins = allDay ? undefined : minutesOf(time)
    const timed = startMins !== undefined

    const patch = {
      title: cleanTitle,
      detail: detail.trim() || undefined,
      note: note.trim() || undefined,
      date,
      allDay: !timed,
      startMins: timed ? startMins : undefined,
      // Cleared with the time it belonged to, or an all-day item keeps a stale
      // 45-minute span that `timeLabel` prints the moment the switch goes back.
      durationMins: timed ? duration : undefined,
      kind,
      applicationId,
      remind,
      // `status`, `when`, `daysLeft` and `urgency` are deliberately absent:
      // `bucketOf` and `whenLabel` derive the first three from the date, and
      // every surface that paints a colour now derives that from the date too.
      // Storing them is how one deadline ended up with five copies that
      // disagreed. New items take the store's `gray`; an edit leaves whatever
      // the seed set, since nothing reads it.
    }

    // Read before the write, or Undo restores the state it just created.
    const beforeItem = editingId ? stored : undefined
    const beforeKeywords = editingId ? labelIdsOf(editingId) : []

    let saved: TimelineItem
    if (editingId) {
      // `update` merges, so `completedOn`, `location` and `joinUrl` — none of
      // which this dialog collects — survive an edit. The copy handed to
      // `onSaved` is rebuilt the same way rather than read back from the store,
      // which has not re-rendered yet.
      update(editingId, patch)
      // `urgency` is carried across by hand for the same reason the other three
      // survive: the patch no longer collects it, and the type still requires
      // one. The fallback matches the default `add` stamps.
      saved = { ...stored, ...patch, id: editingId, urgency: stored?.urgency ?? 'gray' }
    } else {
      saved = add(patch)
    }
    commitKeywords(saved.id)

    // Named for what it will be, not for which button opened the dialog: turning
    // "show in reminders" off in reminder mode means it is not a reminder, and
    // saying otherwise sends the user to a list it is not in.
    const noun = saved.remind ? 'reminder' : 'event'
    toast({
      title: `${saved.title} ${editingId ? 'updated' : 'added'}`,
      // The consequence you cannot see from here: which two lists it just
      // joined. A follow-up is the one kind that also lands on the dashboard.
      description: [
        `${shortDate(saved.date)} · ${whenLabel(saved, TODAY)}`,
        saved.remind ? `in reminders as a ${noun}` : 'on the calendar only',
        saved.kind === 'follow-up' && saved.remind && !saved.completedOn
          ? 'and in Follow-ups due'
          : null,
      ]
        .filter(Boolean)
        .join(' — '),
      action: {
        label: 'Undo',
        onClick: () => {
          if (editingId) {
            // The whole stored record, not a diff: `update` merges, so handing
            // it back the object it had restores fields this dialog never
            // collected as well as the ones it did.
            if (beforeItem) update(editingId, beforeItem)
            if (beforeKeywords.length > 0) setRecord(editingId, beforeKeywords)
            else removeRecord(editingId)
          } else {
            remove(saved.id)
            removeRecord(saved.id)
          }
        },
      },
    })

    onSaved?.(saved)
    onOpenChange(false)
  }

  /**
   * A reminder is a cheap record — a title and a date, re-typed in seconds — so
   * it goes on an undo toast rather than a confirmation dialog. Its keywords go
   * with it and come back with it: `useTimeline().remove` restores the item
   * only, and a record that returned stripped of its keywords is not an undo.
   */
  const onDelete = () => {
    if (!editingId) return
    const stashed = labelIdsOf(editingId)
    const { restore } = remove(editingId)
    removeRecord(editingId)
    onOpenChange(false)

    toast({
      title: `${stored?.title ?? initial?.title ?? 'Reminder'} deleted`,
      description: stored?.remind
        ? 'Gone from the reminders list and from the calendar.'
        : 'Gone from the calendar.',
      tone: 'danger',
      action: {
        label: 'Undo',
        onClick: () => {
          restore()
          // Guarded, because `setRecord` with an empty list would file the
          // record as carrying no keywords rather than leaving it unmentioned.
          if (stashed.length > 0) setRecord(editingId, stashed)
        },
      },
    })
  }

  const applicationField = (
    <ApplicationLinkField
      applications={applications}
      applicationId={applicationId}
      selectedApp={selectedApp}
      onSelect={linkApplication}
      onClear={() => setApplicationId(undefined)}
    />
  )

  const scheduleFields = (
    <ScheduleFields
      date={date}
      onDateChange={setDate}
      dateError={dateError}
      allDay={allDay}
      onAllDayChange={setAllDay}
      time={time}
      onTimeChange={setTime}
      duration={duration}
      onDurationChange={setDuration}
    />
  )

  return (
    // `noValidate` because `required` is still set on the fields for assistive
    // tech, and without it the browser's own bubble fires first and hides the
    // message written for the field.
    <form
      noValidate
      onSubmit={submit}
      className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-4"
    >
      <div className="grid content-start gap-3.5 overflow-x-hidden overflow-y-auto px-0.5 py-0.5">
        {/* The switch rides beside the title because it decides what the record
            *is* — a reminder with a tick box, or a calendar entry. It used to sit
            below the fold, under the one field nobody scrolls to. */}
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <Field
            label="Title"
            required
            error={titleError}
            value={title}
            autoComplete="off"
            className="min-w-[12rem] flex-1"
            placeholder={mode === 'reminder' ? 'e.g. Chase the recruiter' : 'e.g. Committee Zoom'}
            onChange={(event) => setTitle(event.target.value)}
          />
          <div className="flex h-8 shrink-0 items-center gap-2">
            <Switch id={remindId} checked={remind} onCheckedChange={setRemind} />
            <label htmlFor={remindId} className="cursor-pointer text-sm text-text-2">
              Show in reminders
            </label>
          </div>
        </div>
        {/* Live, not static: the sentence names what the switch has just made
            this, which is the only way an unlabelled toggle earns its place. */}
        <p className="-mt-2 text-xs text-text-3">
          {remind
            ? 'Listed in the Vault with a tick box, and on the calendar for its date.'
            : 'On the calendar for its date only — no tick box in the Vault.'}
        </p>

        {/* The only ordering `mode` touches. A reminder is nearly always *about*
            an application — chase, confirm, nudge — and that edge is the one the
            old free-text reminders were missing, so it leads. An event is
            defined by when it happens, so for those the schedule leads. */}
        {mode === 'reminder' ? (
          <>
            {applicationField}
            {scheduleFields}
          </>
        ) : (
          <>
            {scheduleFields}
            {applicationField}
          </>
        )}

        <FormField
          label="Kind"
          // The `required` marker was bogus — `kind` always has a value, so the
          // asterisk pointed at a field nobody could fail to fill in.
          hint={
            <span id={kindHintId}>
              {kind === 'follow-up'
                ? 'A follow-up also appears in Follow-ups due on the dashboard, until you tick it off.'
                : 'The icon it carries on the calendar and in the reminders list.'}
            </span>
          }
        >
          <KindGrid value={kind} onChange={chooseKind} describedBy={kindHintId} />
        </FormField>

        {/* Urgency used to sit here — High / Medium / Normal, captioned "the
            colour of the dot beside it wherever it is listed". It reached
            nowhere: the calendar, the glance month, the dashboard's rail and
            Owed this week all derive their mark from the date, so the field was
            stored and never read, and the one panel that did read it painted an
            event a fortnight out the same red as a follow-up missed last week.
            There is no honest caption for it either — under the colour law red
            is past due and nothing else, so a hand-set "High" can never be
            allowed to paint one. The date is the urgency. */}

        <Field
          label="Detail"
          hint="One line of context, shown under the title."
          value={detail}
          autoComplete="off"
          onChange={(event) => setDetail(event.target.value)}
        />

        {/* Folded, not deleted. These two are the fields nobody fills in on the
            way to saving a reminder, and open they pushed Save off a 900px
            screen. `<details>` rather than state, so the browser handles the
            expanded/collapsed semantics and find-in-page still reaches inside. */}
        <details className="group rounded-lg border border-hairline">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-text-2 transition-colors hover:text-text-1">
            More details
            <span className="text-xs text-text-3">
              {[note.trim() ? 'note' : null, keywords.length > 0 ? 'keywords' : null]
                .filter(Boolean)
                .join(' · ') || 'note, keywords'}
            </span>
          </summary>
          <div className="grid gap-3.5 border-t border-hairline px-3 py-3">
            <TextareaField
              label="Note"
              hint="Your own scribble. Kept apart from the detail, so an edit never clobbers it."
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />

            <FormField
              label="Keywords"
              hint="Shared with applications, files and links — filtering by one finds all of them."
            >
              <KeywordPicker value={keywords} onChange={setKeywords} />
            </FormField>
          </div>
        </details>
      </div>

      <DialogFooter className={editingId ? 'sm:justify-between' : undefined}>
        {editingId ? (
          <Button type="button" variant="destructive" onClick={onDelete}>
            Delete
          </Button>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          {/* Left enabled with the title empty: pressing it names the missing
              field where a disabled button leaves the user hunting for it. */}
          <Button type="submit">
            {editingId ? 'Save changes' : mode === 'reminder' ? 'Add reminder' : 'Add event'}
          </Button>
        </div>
      </DialogFooter>
    </form>
  )
}
