import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { DateField } from '@/components/common/DateField'
import { StagedKeywordPicker } from '@/components/common/Labels'
import { Button } from '@/components/ui/Button'
import { FormField, SettingRow, TextField, Toggle } from '@/components/ui/Field'
import { MenuSheet } from '@/components/ui/Menu'
import { Sheet } from '@/components/ui/Sheet'
import { Txt } from '@/components/ui/Text'
import { displayName } from '@/data/seed'
import type { Stage } from '@/data/seed'
import { TODAY, shortDate, whenLabel } from '@/data/timeline'
import type { TimelineItem, TimelineKind } from '@/data/timeline'
import { useLabels } from '@/lib/labels-context'
import { useApplications, useTimeline } from '@/lib/store-context'
import { KIND_ICON, KIND_LABEL, TIMELINE_KINDS } from '@/lib/timeline-visuals'
import { useToast } from '@/lib/toast-context'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { radius, space } from '@/theme/tokens'

/**
 * Write a reminder or a calendar entry. One sheet, because they are one record.
 *
 * A `TimelineItem` with `remind` on shows in the Vault's reminders list, and the
 * same item on its date shows on the calendar — so a separate "add event" form
 * would be a second write path into a single array, and the two would drift the
 * way the five old dated types did. `mode` changes exactly three things: the
 * title, which field leads, and what `kind` and `remind` start as.
 */
export type TimelineItemSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'reminder' | 'event'
  /** Pass one with an `id` to edit; anything else prefills a new record. */
  initial?: Partial<TimelineItem>
}

const DURATIONS = [
  { mins: 15, label: '15 min' },
  { mins: 30, label: '30 min' },
  { mins: 45, label: '45 min' },
  { mins: 60, label: '1 hour' },
  { mins: 90, label: '1.5 hours' },
  { mins: 120, label: '2 hours' },
  { mins: 180, label: '3 hours' },
]

/**
 * What a reminder about an application at this stage almost always is.
 *
 * The old default was `admin` for every mode and every context, and `admin` is
 * the one kind no panel in the app looks for. So the canonical journey — "remind
 * me to chase them" — filed a record that never reached the follow-ups the
 * dashboard reads. Waiting on someone else is a follow-up; work that is yours
 * to do is prep; a decision you owe is admin.
 */
const REMINDER_KIND_FOR_STAGE: Record<Stage, TimelineKind> = {
  draft: 'prep',
  submitted: 'follow-up',
  screen: 'follow-up',
  interview: 'prep',
  offer: 'admin',
  closed: 'admin',
}

/** The same question for a dated event: what actually happens on the day. */
const EVENT_KIND_FOR_STAGE: Record<Stage, TimelineKind> = {
  draft: 'deadline',
  submitted: 'deadline',
  screen: 'call',
  interview: 'interview',
  offer: 'deadline',
  closed: 'admin',
}

const DEFAULT_START_MINS = 9 * 60
const DEFAULT_DURATION_MINS = 30

const pad = (n: number) => String(n).padStart(2, '0')
const clockValue = (mins: number) => `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`

/** Back to minutes from midnight. Undefined for anything unparseable, never NaN. */
function minutesOf(value: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return undefined
  const mins = Number(match[1]) * 60 + Number(match[2])
  return Number.isFinite(mins) && mins >= 0 && mins < 24 * 60 ? mins : undefined
}

export function TimelineItemSheet({ open, onOpenChange, mode, initial }: TimelineItemSheetProps) {
  const c = useColors()
  const { all: applications, byId } = useApplications()
  const { get, add, update, remove } = useTimeline()
  const { labelIdsOf, setRecord, removeRecord } = useLabels()
  const { toast } = useToast()

  const editingId = initial?.id
  const stored = editingId ? get(editingId) : undefined
  const editing = Boolean(editingId)
  const noun = mode === 'reminder' ? 'reminder' : 'event'

  const [title, setTitle] = useState(initial?.title ?? '')
  const [applicationId, setApplicationId] = useState(initial?.applicationId)
  const [date, setDate] = useState(initial?.date ?? TODAY)
  const [allDay, setAllDay] = useState(initial?.allDay ?? initial?.startMins === undefined)
  // Held apart from `allDay` so flipping the switch off and on again gives back
  // the time that was typed rather than the default.
  const [time, setTime] = useState(clockValue(initial?.startMins ?? DEFAULT_START_MINS))
  const [duration, setDuration] = useState(initial?.durationMins ?? DEFAULT_DURATION_MINS)
  const [kind, setKind] = useState<TimelineKind>(
    initial?.kind ?? (mode === 'reminder' ? 'follow-up' : 'interview'),
  )
  // Once the user has touched Kind, linking an application must not overrule
  // them. Editing counts as touched: the stored kind is a decision already made.
  const [kindTouched, setKindTouched] = useState(initial?.kind !== undefined)
  const [detail, setDetail] = useState(initial?.detail ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [remind, setRemind] = useState(initial?.remind ?? mode === 'reminder')
  /**
   * Keywords are staged, not written on tap — so Cancel has one answer for the
   * whole sheet rather than keeping the keywords and throwing away the title.
   */
  const [keywords, setKeywords] = useState<string[]>(() => (editingId ? labelIdsOf(editingId) : []))
  const [more, setMore] = useState(false)
  const [appPickerOpen, setAppPickerOpen] = useState(false)
  const [durationOpen, setDurationOpen] = useState(false)
  const [attempted, setAttempted] = useState(false)

  const titleError = attempted && !title.trim() ? 'Give it a title you will recognise.' : undefined
  const dateError =
    attempted && !date ? 'Pick a date — an undated item has nowhere to appear.' : undefined
  const selectedApp = applicationId ? byId.get(applicationId) : undefined

  /**
   * Linking an application is the strongest hint the form ever gets about what
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

  /** Replaces the record's whole keyword set, or forgets it when none are left. */
  const commitKeywords = (id: string) => {
    // `setRecord(id, [])` files the record as carrying no keywords, which is a
    // different thing from never having been mentioned — and the second is what
    // a record with every keyword removed should go back to being.
    if (keywords.length > 0) setRecord(id, keywords)
    else removeRecord(id)
  }

  const onSave = () => {
    setAttempted(true)
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
    }

    // Read before the write, or Undo restores the state it just created.
    const beforeItem = editingId ? stored : undefined
    const beforeKeywords = editingId ? labelIdsOf(editingId) : []

    let saved: TimelineItem
    if (editingId) {
      update(editingId, patch)
      saved = { ...stored, ...patch, id: editingId, urgency: stored?.urgency ?? 'gray' }
    } else {
      saved = add(patch)
    }
    commitKeywords(saved.id)

    // Named for what it will be, not for which button opened the sheet: turning
    // "show in reminders" off in reminder mode means it is not a reminder, and
    // saying otherwise sends the user to a list it is not in.
    toast({
      title: `${saved.title} ${editingId ? 'updated' : 'added'}`,
      description: [
        `${shortDate(saved.date)} · ${whenLabel(saved, TODAY)}`,
        saved.remind ? 'in reminders' : 'on the calendar only',
        saved.kind === 'follow-up' && saved.remind && !saved.completedOn
          ? 'and owed this week'
          : null,
      ]
        .filter(Boolean)
        .join(' — '),
      action: {
        label: 'Undo',
        onPress: () => {
          if (editingId) {
            // The whole stored record, not a diff: `update` merges, so handing
            // it back the object it had restores fields this form never
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

    onOpenChange(false)
  }

  /**
   * A reminder is a cheap record — a title and a date, retyped in seconds — so
   * it goes on an undo toast rather than a confirmation. Its keywords go with
   * it and come back with it: the store's `remove` restores the item only, and
   * a record that returned stripped of its keywords is not an undo.
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
        onPress: () => {
          restore()
          if (stashed.length > 0) setRecord(editingId, stashed)
        },
      },
    })
  }

  const scheduleFields = (
    <>
      <DateField label="Date" required value={date} error={dateError} onChange={setDate} />

      <SettingRow
        label="All day"
        description="Off gives it a start time and a length."
        control={<Toggle value={allDay} onValueChange={setAllDay} label="All day" />}
      />

      {allDay ? null : (
        <View style={styles.timeRow}>
          <TextField
            label="Start time"
            value={time}
            onChangeText={setTime}
            placeholder="09:00"
            keyboardType="numbers-and-punctuation"
            mono
            error={minutesOf(time) === undefined ? 'Use a time like 14:30.' : undefined}
            style={s.fill}
          />
          <FormField label="Length" style={s.fill}>
            <Button
              label={DURATIONS.find((d) => d.mins === duration)?.label ?? `${duration} min`}
              variant="outline"
              size="md"
              full
              onPress={() => setDurationOpen(true)}
            />
          </FormField>
        </View>
      )}
    </>
  )

  const applicationField = (
    <FormField
      label="Related application"
      hint="Links the two, so the application lists this and this leads back to it."
    >
      <View style={s.row}>
        <Button
          label={selectedApp ? displayName(selectedApp) : 'Not linked'}
          variant="outline"
          size="md"
          style={s.fill}
          onPress={() => setAppPickerOpen(true)}
        />
        {applicationId ? (
          <Button
            label="Clear"
            variant="ghost"
            size="md"
            onPress={() => setApplicationId(undefined)}
          />
        ) : null}
      </View>
    </FormField>
  )

  return (
    <Sheet
      open={open}
      onClose={() => onOpenChange(false)}
      size="tall"
      title={editing ? `Edit ${noun}` : `New ${noun}`}
      // Identical in both modes on purpose: explaining that these are the same
      // record is the whole reason there is one form.
      description="One record either way — it lands on the calendar for the date you give it, and in the Vault's reminders list while the switch is on."
      footer={
        <>
          {editing ? (
            <Button label="Delete" variant="destructive" size="md" onPress={onDelete} />
          ) : null}
          <Button label="Cancel" variant="ghost" size="md" onPress={() => onOpenChange(false)} />
          <Button
            label={editing ? 'Save' : mode === 'reminder' ? 'Add reminder' : 'Add event'}
            size="md"
            onPress={onSave}
          />
        </>
      }
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: space[3.5], paddingBottom: space[2] }}
      >
        <TextField
          label="Title"
          required
          value={title}
          error={titleError}
          placeholder={mode === 'reminder' ? 'e.g. Chase the recruiter' : 'e.g. Committee Zoom'}
          onChangeText={setTitle}
        />

        {/* The switch decides what the record *is* — a reminder with a tick box,
            or a calendar entry — so it rides beside the title rather than below
            the fold. The line under it is live: it names what the switch has
            just made this, which is the only way an unlabelled toggle earns its
            place. */}
        <SettingRow
          label="Show in reminders"
          description={
            remind
              ? 'Listed in the Vault with a tick box, and on the calendar for its date.'
              : 'On the calendar for its date only — no tick box in the Vault.'
          }
          control={<Toggle value={remind} onValueChange={setRemind} label="Show in reminders" />}
        />

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
          hint={
            kind === 'follow-up'
              ? 'A follow-up is also counted as owed on Today, until you tick it off.'
              : 'The icon it carries on the calendar and in the reminders list.'
          }
        >
          <View style={styles.kindGrid}>
            {TIMELINE_KINDS.map((k) => {
              const on = k === kind
              return (
                <Pressable
                  key={k}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  onPress={() => {
                    setKindTouched(true)
                    setKind(k)
                  }}
                  style={[
                    styles.kindOption,
                    {
                      backgroundColor: on ? c.accentSoft : c.well,
                      borderColor: on ? c.accentBorder : c.hairline,
                    },
                  ]}
                >
                  <Feather name={KIND_ICON[k]} size={17} color={on ? c.accent : c.text2} />
                  <Txt size="xs" tone={on ? 'accent' : 'secondary'} numberOfLines={1}>
                    {KIND_LABEL[k]}
                  </Txt>
                </Pressable>
              )
            })}
          </View>
        </FormField>

        <TextField
          label="Detail"
          hint="One line of context, shown under the title."
          value={detail}
          onChangeText={setDetail}
        />

        {/* Folded, not deleted. These two are the fields nobody fills in on the
            way to saving a reminder, and open they push Save off the screen. */}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: more }}
          onPress={() => setMore((v) => !v)}
          style={[styles.moreToggle, { borderColor: c.hairline }]}
        >
          <Txt size="sm" tone="secondary">
            More details
          </Txt>
          <Txt size="xs" tone="muted">
            {[note.trim() ? 'note' : null, keywords.length > 0 ? 'keywords' : null]
              .filter(Boolean)
              .join(' · ') || 'note, keywords'}
          </Txt>
          <Feather name={more ? 'chevron-up' : 'chevron-down'} size={16} color={c.text3} />
        </Pressable>

        {more ? (
          <>
            <TextField
              label="Note"
              hint="Your own scribble. Kept apart from the detail, so an edit never clobbers it."
              value={note}
              multiline
              onChangeText={setNote}
            />
            <FormField
              label="Keywords"
              hint="Shared with applications, files and links — filtering by one finds all of them."
            >
              <StagedKeywordPicker value={keywords} onChange={setKeywords} />
            </FormField>
          </>
        ) : null}
      </ScrollView>

      <MenuSheet
        open={appPickerOpen}
        onClose={() => setAppPickerOpen(false)}
        title="Related application"
        actions={
          applications.length === 0
            ? [
                {
                  id: 'none',
                  label: 'No applications yet',
                  disabled: true,
                  onPress: () => {},
                },
              ]
            : applications.map((a) => ({
                id: a.id,
                label: displayName(a),
                hint: a.roleTag,
                checked: a.id === applicationId,
                onPress: () => linkApplication(a.id),
              }))
        }
      />

      <MenuSheet
        open={durationOpen}
        onClose={() => setDurationOpen(false)}
        title="Length"
        actions={DURATIONS.map((d) => ({
          id: String(d.mins),
          label: d.label,
          checked: d.mins === duration,
          onPress: () => setDuration(d.mins),
        }))}
      />
    </Sheet>
  )
}

const styles = StyleSheet.create({
  timeRow: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start' },
  kindGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  kindOption: {
    width: '30%',
    flexGrow: 1,
    alignItems: 'center',
    gap: space[1],
    paddingVertical: space[2.5],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
  moreToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
    minHeight: 48,
    paddingHorizontal: space[3],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
})
