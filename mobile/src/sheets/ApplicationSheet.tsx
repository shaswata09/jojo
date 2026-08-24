import { useState } from 'react'
import { TODAY } from '@/lib/today'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { DateField } from '@/components/common/DateField'
import { StagedKeywordPicker } from '@/components/common/Labels'
import { Button } from '@/components/ui/Button'
import { FormField, TextField } from '@/components/ui/Field'
import { MenuSheet } from '@/components/ui/Menu'
import { Segment } from '@/components/ui/Segment'
import { Sheet } from '@/components/ui/Sheet'
import { Txt } from '@/components/ui/Text'
import { SOURCES, STAGES, STAGE_LABEL, displayName } from '@jojo/service/data/seed'
import { useRoleVocabulary } from '@jojo/service/react/use-roles'
import type { Application, RoleTag, Source, Stage } from '@jojo/service/data/seed'
import { shortDate } from '@jojo/service/data/timeline'
// Imported, not redeclared. This sheet used to carry its own `deadlineUrgency`
// with the 7/21-day thresholds spelled a second time. The tool layer's copy is
// the one the store writes through, so a drift here would have shown the user
// one colour on the sheet's item and another on everything the tools mint —
// and the web dialog already imports this one.
import { deadlineUrgency } from '@jojo/service/tools/support'
import { DEADLINE_DETAIL, applicationDeadlineOf } from '@/lib/deadline'
import { refKey } from '@/lib/ids'
import { useLabels } from '@/lib/labels-context'
import { useSheets } from '@/lib/sheets-context'
import { useApplications, useTimeline } from '@/lib/store-context'
import { useToast } from '@/lib/toast-context'
import { useColors } from '@/theme/theme-context'
import { isOpenableUrl } from '@/lib/urls'
import { duplicateMessage, findDuplicate } from '@jojo/service/core/duplicates'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import type { RootStackParamList } from '@/navigation/types'
import { space } from '@/theme/tokens'

/**
 * `deadline` is not on `Application` — it is a timeline item this sheet mints.
 * `keywords` is not either: it lives in the label store, and only travels here
 * so a discarded draft can be handed back intact by the undo in its toast.
 */
export type ApplicationInitial = Partial<Application> & {
  deadline?: string
  keywords?: string[]
}

type FormState = {
  org: string
  role: string
  /** Empty until picked. There is no sensible default — see `validate`. */
  roleTag: RoleTag | ''
  stage: Stage
  /** `Source` is optional on the model, and a segment has no empty state. */
  source: Source | 'none'
  url: string
  location: string
  comp: string
  deadline: string
  note: string
}

type FieldKey = 'org' | 'role' | 'roleTag' | 'url'
type Errors = Partial<Record<FieldKey, string>>

const STAGE_OPTIONS = STAGES.map((s) => ({ value: s.id, label: s.label }))
const SOURCE_OPTIONS: { value: Source | 'none'; label: string }[] = [
  { value: 'none', label: 'Not set' },
  ...SOURCES.map((s) => ({ value: s, label: s })),
]

function formFrom(initial?: ApplicationInitial): FormState {
  return {
    org: initial?.org ?? '',
    role: initial?.role ?? '',
    roleTag: initial?.roleTag ?? '',
    stage: initial?.stage ?? 'draft',
    source: initial?.source ?? 'none',
    url: initial?.url ?? '',
    location: initial?.location ?? '',
    comp: initial?.comp ?? '',
    deadline: initial?.deadline ?? '',
    note: initial?.note ?? '',
  }
}

function validate(form: FormState): Errors {
  const errors: Errors = {}
  if (!form.org.trim()) errors.org = 'Name the employer — it is what the record is filed under.'
  if (!form.role.trim()) {
    errors.role = 'Name the role, so two applications to the same place stay apart.'
  }
  if (!form.roleTag) errors.roleTag = 'Pick a role tag — the role filter and the charts read it.'
  if (form.url.trim() && !isOpenableUrl(form.url.trim())) {
    errors.url = 'That is not a link a browser can open — include https://.'
  }
  return errors
}

/**
 * Create and edit an application.
 *
 * One component for both, because the two forms are the same eleven fields and
 * the same validation — the differences are the title, which verb the toast
 * uses, and whether the deadline is minted or rescheduled.
 *
 * Nothing is written until Save. Every field, keywords included, is staged in
 * local state so Cancel means cancel; a picker that wrote through on tap would
 * leave the record half-edited behind a sheet the user just dismissed.
 */
export function ApplicationSheet({
  open,
  onOpenChange,
  mode,
  initial,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  initial?: ApplicationInitial
}) {
  const applications = useApplications()
  const timeline = useTimeline()
  const { labelIdsOf, setRecord, removeRecord } = useLabels()
  const { toast } = useToast()
  const vocabulary = useRoleVocabulary()
  const { open: openSheet } = useSheets()
  const c = useColors()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()

  const [form, setForm] = useState<FormState>(() => formFrom(initial))
  const [keywords, setKeywords] = useState<string[]>(() => keywordsOf(initial, labelIdsOf))
  /** Errors are only shown once a save has been attempted. */
  const [attempted, setAttempted] = useState(false)
  const [rolesOpen, setRolesOpen] = useState(false)

  const id = initial?.id
  const record = mode === 'edit' && id ? applications.get(id) : undefined
  const blocker =
    mode === 'edit' && !record ? 'This sheet was opened without a record to edit' : undefined

  /** Guessed values need checking; typed ones do not. See `lib/draft-from.ts`. */
  const guessed = mode === 'create' && Boolean(initial?.org || initial?.role || initial?.url)

  /**
   * Whether this job is already in the store.
   *
   * A NOTICE, never a blocker — three roles at one university is the case this
   * product is for, so `core/duplicates.ts` fires only on the same posting URL
   * or the same employer AND role. It matters more on a phone than on the web,
   * because the share sheet makes adding a job a two-tap action and the same
   * board gets read on the bus twice a week.
   */
  const duplicate = findDuplicate(
    applications.all,
    { org: form.org, role: form.role, url: form.url },
    mode === 'edit' ? id : undefined,
  )

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const errors = attempted ? validate(form) : {}

  /** Anything typed that closing would take with it. */
  const dirty =
    JSON.stringify(form) !== JSON.stringify(formFrom(initial)) ||
    [...keywords].sort().join(' ') !== [...keywordsOf(initial, labelIdsOf)].sort().join(' ')

  const asInitial = (): ApplicationInitial => ({
    ...initial,
    org: form.org,
    role: form.role,
    roleTag: form.roleTag || undefined,
    stage: form.stage,
    source: form.source === 'none' ? undefined : form.source,
    url: form.url,
    location: form.location,
    comp: form.comp,
    note: form.note,
    deadline: form.deadline,
    keywords,
  })

  /**
   * The backdrop, the close button and the hardware Back all land here.
   *
   * A second modal asking "are you sure?" is the wrong guard for a form: it
   * fires on the way out of the one path a user takes when they have already
   * decided, and just as often on a form holding a single stray character. So
   * the close is never blocked — it is made reversible instead, and the undo
   * hands the sheet back with every field, keywords included, as it was.
   */
  const onDismiss = () => {
    onOpenChange(false)
    if (!dirty) return

    const draft = asInitial()
    toast({
      title: mode === 'create' ? 'Draft discarded' : 'Changes discarded',
      description:
        mode === 'create'
          ? 'Nothing was added. Undo brings the form back as you left it.'
          : `${record ? displayName(record) : 'The record'} is unchanged. Undo brings your edits back.`,
      action: {
        label: 'Undo',
        onPress: () => openSheet('application', { mode, id, initial: draft }),
      },
    })
  }

  const shared = () => ({
    org: form.org.trim(),
    role: form.role.trim(),
    roleTag: form.roleTag as RoleTag,
    stage: form.stage,
    note: form.note.trim(),
    source: form.source === 'none' ? undefined : form.source,
    location: form.location.trim() || undefined,
    comp: form.comp.trim() || undefined,
    url: form.url.trim() || undefined,
  })

  function mintDeadline(application: Application, date: string) {
    // Without this the first application anyone adds is invisible everywhere
    // that reads dates — the calendar, the week ahead, the priority deck — and
    // the app looks like it lost the record.
    timeline.add({
      title: displayName(application),
      detail: DEADLINE_DETAIL,
      date,
      kind: 'deadline',
      urgency: deadlineUrgency(TODAY, date),
      applicationIds: [application.id],
      allDay: true,
      // Off, like every seeded application deadline: this item's title IS the
      // application, so as a reminder the row would print its own name twice.
      remind: false,
    })
  }

  /** Returns the undo handle when the edit deleted a deadline, otherwise null. */
  function syncDeadline(next: Application, previous: Application) {
    // An untouched date field must not reach the calendar at all. Whoever opened
    // this sheet decides what to prefill, and a save that always wrote would
    // mint a duplicate deadline every time someone edited a location.
    if (form.deadline === (initial?.deadline ?? '')) return null

    const existing = applicationDeadlineOf(timeline.forApplication(next.id))

    if (!form.deadline) {
      if (!existing) return null
      return timeline.remove(existing.id)
    }
    if (!existing) {
      mintDeadline(next, form.deadline)
      return null
    }

    const dateChanged = existing.date !== form.deadline
    timeline.update(existing.id, {
      date: form.deadline,
      // Renaming the employer should carry to the calendar, but only while the
      // item still holds the name this sheet gave it. Once someone has retitled
      // it by hand that title is theirs, not a derived string to overwrite.
      title: existing.title === displayName(previous) ? displayName(next) : existing.title,
      urgency: dateChanged ? deadlineUrgency(TODAY, form.deadline) : existing.urgency,
    })
    return null
  }

  const onSave = () => {
    setAttempted(true)
    if (Object.keys(validate(form)).length > 0 || blocker) return

    if (mode === 'create') {
      const fields = shared()
      const created = applications.add({
        ...fields,
        // The store's own default reads 'Draft created', which is a lie for
        // anything logged at a later stage — people add an interview they are
        // already booked for.
        lastAction: fields.stage === 'draft' ? undefined : `Added at ${STAGE_LABEL[fields.stage]}`,
      })
      setRecord(refKey('app', created.id), keywords)
      if (form.deadline) mintDeadline(created, form.deadline)

      toast({
        title: `${displayName(created)} added`,
        description: form.deadline
          ? `Deadline ${shortDate(form.deadline)} is on the calendar.`
          : 'No deadline yet — add one and it shows up in the week ahead.',
      })
    } else if (record) {
      const fields = shared()
      const moved = record.stage !== fields.stage
      const lastAction = moved ? `Moved to ${STAGE_LABEL[fields.stage]}` : 'Details edited'

      applications.update(record.id, { ...fields, lastAction })
      setRecord(refKey('app', record.id), keywords)
      // The seeded applications are still keyed by bare id in the label store,
      // and `keywordsOf` read that copy in. Leaving it behind would count the
      // record twice in the filter's totals.
      removeRecord(record.id)

      const next: Application = { ...record, ...fields, lastAction, daysAgo: 0 }
      const removed = syncDeadline(next, record)

      toast({
        title: 'Changes saved',
        description: removed
          ? `${displayName(next)} — its deadline is off the calendar.`
          : displayName(next),
        // The record's own fields can be typed back; a timeline item deleted as
        // a side effect of clearing one field cannot, so the one destructive
        // part of this save is the part that gets the undo.
        action: removed ? { label: 'Restore deadline', onPress: removed.restore } : undefined,
      })
    }

    onOpenChange(false)
  }

  const title = record ? `Edit ${displayName(record)}` : 'New application'

  return (
    <Sheet
      open={open}
      onClose={onDismiss}
      size="tall"
      title={title}
      description={
        mode === 'edit'
          ? 'Changes replace the current details, and the deadline moves with them.'
          : guessed
            ? 'Prefilled from what you pasted — check the employer and role before saving.'
            : 'Track a job you are applying for. Starred fields are required.'
      }
      footer={
        <>
          <Button label="Cancel" variant="ghost" size="md" onPress={onDismiss} />
          {/* Never disabled for invalid input: a dead button next to an empty
              form explains nothing, where a tap that surfaces the errors says
              exactly what is missing. */}
          <Button
            label={mode === 'create' ? 'Add application' : 'Save changes'}
            size="md"
            blocker={blocker}
            onPress={onSave}
          />
        </>
      }
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: space[3.5], paddingBottom: space[2] }}
      >
        {duplicate ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Open ${displayName(duplicate.record)}, which you already have`}
            onPress={() => {
              onDismiss()
              navigation.navigate('ApplicationDetail', { id: duplicate.record.id })
            }}
            style={[
              styles.duplicate,
              { backgroundColor: c.warningSoft, borderColor: c.warningBorder },
            ]}
          >
            <Txt size="xs" style={{ color: c.warning }}>
              {duplicateMessage(duplicate.reason, displayName(duplicate.record))} Tap to open it, or
              carry on and add this as a second record.
            </Txt>
          </Pressable>
        ) : null}

        <TextField
          label="Organisation"
          required
          value={form.org}
          error={errors.org}
          autoCapitalize="words"
          // Placeholders name the shape of the answer, never a plausible one.
          // The web version once reproduced the Rice record field for field, so
          // the empty create form read as a filled duplicate of a record the
          // user already had — and the only tell was that the text was grey.
          placeholder="Employer or institution"
          onChangeText={(v) => set('org', v)}
        />
        <TextField
          label="Role title"
          required
          value={form.role}
          error={errors.role}
          placeholder="e.g. Senior data analyst"
          onChangeText={(v) => set('role', v)}
        />

        <FormField label="Role tag" required error={errors.roleTag}>
          <Button
            label={form.roleTag || 'Pick a role tag'}
            variant="outline"
            size="md"
            icon="chevrons-down"
            full
            onPress={() => setRolesOpen(true)}
          />
        </FormField>

        <FormField label="Stage" required>
          <Segment
            label="Stage"
            scroll
            options={STAGE_OPTIONS}
            value={form.stage}
            onChange={(s) => set('stage', s)}
          />
        </FormField>

        <DateField
          label="Deadline"
          value={form.deadline}
          onChange={(iso) => set('deadline', iso)}
          hint="Puts a dated entry on the calendar and in the week ahead."
          clearable
        />

        <FormField label="Source">
          <Segment
            label="Source"
            scroll
            options={SOURCE_OPTIONS}
            value={form.source}
            onChange={(s) => set('source', s)}
          />
        </FormField>

        <TextField
          label="Location"
          value={form.location}
          placeholder="City, or Remote"
          onChangeText={(v) => set('location', v)}
        />
        <TextField
          label="Comp"
          value={form.comp}
          placeholder="e.g. $96k + equity"
          onChangeText={(v) => set('comp', v)}
        />
        <TextField
          label="Posting URL"
          value={form.url}
          error={errors.url}
          mono
          autoCapitalize="none"
          keyboardType="url"
          placeholder="https://…"
          onChangeText={(v) => set('url', v)}
        />
        <TextField
          label="Note"
          value={form.note}
          multiline
          placeholder="What still has to happen before this goes out."
          onChangeText={(v) => set('note', v)}
        />

        <FormField label="Keywords">
          <StagedKeywordPicker value={keywords} onChange={setKeywords} />
        </FormField>

        <View style={{ height: space[2] }} />
      </ScrollView>

      <MenuSheet
        open={rolesOpen}
        onClose={() => setRolesOpen(false)}
        title="Role tag"
        description="The axis the role filter and the charts read."
        actions={vocabulary.map((role) => ({
          id: role,
          label: role,
          checked: role === form.roleTag,
          onPress: () => set('roleTag', role),
        }))}
      />
    </Sheet>
  )
}

/**
 * The keywords already on this record.
 *
 * Read under both spellings. The label store keys the seeded applications by
 * bare id while `refKey` spells the same edge 'app:rice', and both are live at
 * once — reading only the canonical one would show Rice as having no keywords
 * and quietly drop the two it has the moment anything else is saved.
 */
function keywordsOf(
  initial: ApplicationInitial | undefined,
  labelIdsOf: (recordId: string) => string[],
) {
  // A restored draft wins over the store: it is what the user had typed, which
  // by definition has not been committed anywhere yet.
  if (initial?.keywords) return initial.keywords
  const id = initial?.id
  if (!id) return []
  return [...new Set([...labelIdsOf(refKey('app', id)), ...labelIdsOf(id)])]
}

/** Re-exported so the detail screen can name the type without the sheet. */
export type { Application }

const styles = StyleSheet.create({
  duplicate: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: space[3],
    paddingVertical: space[2.5],
  },
})
