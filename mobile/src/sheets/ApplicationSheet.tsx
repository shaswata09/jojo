import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDomain } from '@/i18n/domain'
import { i18next } from '@/i18n/i18n'
import { useDuplicateCheck } from '@/lib/duplicate-agent'
import type { DuplicateFound } from '@/lib/duplicate-agent'
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
// Imported, not redeclared. This sheet used to carry its own `deadlineUrgency`
// with the 7/21-day thresholds spelled a second time. The tool layer's copy is
// the one the store writes through, so a drift here would have shown the user
// one colour on the sheet's item and another on everything the tools mint —
// and the web dialog already imports this one.
import { deadlineUrgency } from '@jojo/service/tools/support'
import { DEADLINE_DETAIL, applicationDeadlineOf } from '@/lib/deadline'
import { refKey } from '@/lib/ids'
import { useLabels } from '@/lib/labels-context'
import { fromOverlay } from '@/navigation/ref'
import { useSheets } from '@/lib/sheets-context'
import { useApplications, useTimeline, useVault } from '@/lib/store-context'
import { useToast } from '@/lib/toast-context'
import { useColors } from '@/theme/theme-context'
import { isOpenableUrl } from '@/lib/urls'
import { duplicateMessage, findDuplicate } from '@jojo/service/core/duplicates'
import { postingSourceForUrl } from '@jojo/service/core/posting-source'
import { useGraph, useKg } from '@jojo/service/react/kg-context'
import { useReadFit } from '@/lib/fit-agent'
import { useModelSettings } from '@/lib/model-settings-context'
import { space } from '@/theme/tokens'
import { report } from '@/lib/analytics'

/**
 * `deadline` is not on `Application` — it is a timeline item this sheet mints.
 * `keywords` is not either: it lives in the label store, and travels here for
 * two reasons — so a discarded draft can be handed back intact by the undo in
 * its toast, and so a sheet opened from a posting can arrive with the keywords
 * the model matched already ticked (`matchKeywords`, in agent/read-posting).
 */
export type ApplicationInitial = Partial<Application> & {
  deadline?: string
  keywords?: string[]
  /** The saved posting "From link" kept, filed under the application on create. See web's `form-state.ts`. */
  postingFileId?: string
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
  /** The posting's own reference, when it states one. See `core/duplicates.ts`. */
  postingId: string
  location: string
  comp: string
  deadline: string
  note: string
}

type FieldKey = 'org' | 'role' | 'roleTag' | 'url'
type Errors = Partial<Record<FieldKey, string>>

/** Built at render, so the 'Not set' label follows the language. */
const sourceOptions = (notSet: string): { value: Source | 'none'; label: string }[] => [
  { value: 'none', label: notSet },
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
    postingId: initial?.postingId ?? '',
    location: initial?.location ?? '',
    comp: initial?.comp ?? '',
    deadline: initial?.deadline ?? '',
    note: initial?.note ?? '',
  }
}

function validate(form: FormState): Errors {
  const errors: Errors = {}
  // Read at call time, so the messages are in whatever language is current.
  const t = (key: string) => i18next.t(`sheets:application.errors.${key}`)
  if (!form.org.trim()) errors.org = t('org')
  if (!form.role.trim()) errors.role = t('role')
  if (!form.roleTag) errors.roleTag = t('roleTag')
  if (form.url.trim() && !isOpenableUrl(form.url.trim())) errors.url = t('url')
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
  const { t } = useTranslation('sheets')
  const domain = useDomain()
  const applications = useApplications()
  const timeline = useTimeline()
  const graph = useGraph()
  const { projections } = useKg()
  const { settings } = useModelSettings()
  const vault = useVault()
  /**
   * The saved posting this sheet was started from, while it is still in the
   * Vault. A page deleted in the meantime files nothing, rather than an edge to
   * a record that is gone.
   */
  const postingId = initial?.postingFileId
  const posting = postingId === undefined ? undefined : vault.files.find((f) => f.id === postingId)
  const readFit = useReadFit()
  const { labelIdsOf, setRecord } = useLabels()
  const { toast } = useToast()
  const vocabulary = useRoleVocabulary()
  const { open: openSheet } = useSheets()
  const c = useColors()

  const [form, setForm] = useState<FormState>(() => formFrom(initial))
  const [keywords, setKeywords] = useState<string[]>(() => keywordsOf(initial, labelIdsOf))
  /** Errors are only shown once a save has been attempted. */
  const [attempted, setAttempted] = useState(false)
  const [rolesOpen, setRolesOpen] = useState(false)

  const id = initial?.id
  const record = mode === 'edit' && id ? applications.get(id) : undefined
  const blocker = mode === 'edit' && !record ? t('application.noRecord') : undefined

  /** Guessed values need checking; typed ones do not. See `lib/draft-from.ts`. */
  const guessed = mode === 'create' && Boolean(initial?.org || initial?.role || initial?.url)

  /**
   * Whether the prefill also ticked keywords, which only a model read does.
   *
   * `guessed` is true for every prefilled create — the address-only route and
   * the share target included — and neither reads a page or can produce a
   * keyword. Web's dialog draws the same distinction for the same sentence.
   */
  const tagged = guessed && (initial?.keywords?.length ?? 0) > 0

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
    { org: form.org, role: form.role, url: form.url, postingId: form.postingId },
    mode === 'edit' ? id : undefined,
  )
  const checkDuplicate = useDuplicateCheck()
  // The duplicate found at Save, held until the person answers. See web's
  // `DuplicateConfirm`: the sheet shows the original beside what is being
  // added, and nothing has been written.
  const [confirm, setConfirm] = useState<DuplicateFound<Application> | null>(null)
  const [checking, setChecking] = useState(false)
  const checkAbort = useRef<AbortController | null>(null)

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
    checkAbort.current?.abort()
    onOpenChange(false)
    if (!dirty) return

    const draft = asInitial()
    toast({
      title:
        mode === 'create'
          ? t('application.toast.draftDiscarded')
          : t('application.toast.changesDiscarded'),
      description:
        mode === 'create'
          ? t('application.toast.nothingAdded')
          : record
            ? t('application.toast.unchanged', { name: displayName(record) })
            : t('application.toast.recordUnchanged'),
      action: {
        label: t('common.undo'),
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
    postingId: form.postingId.trim() || undefined,
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
    //
    // Compared with the deadline ON THE CALENDAR, not with what the sheet was
    // opened with: after "Changes discarded" → Undo the sheet reopens with the
    // typed values as its `initial`, so a moved deadline compared equal to
    // itself and the save left the old date on the calendar.
    const existing = applicationDeadlineOf(timeline.forApplication(next.id))
    if (form.deadline === (existing?.date ?? '')) return null

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

  /**
   * Reads what the posting asks for, now, so the record opens with an answer.
   *
   * The phone's half of the same call in web's `use-application-writes.ts`, and
   * the reasoning is there: saving does not navigate to the record, so without
   * this the model call starts when somebody eventually opens it and they watch
   * it run. Fired against the URL rather than the new record because the
   * snapshot here predates the write; the saved posting is already in it.
   *
   * Skipped when there is no posting, no model, or no background — the last
   * because the assessment would come out `not-measured` whatever the posting
   * says, and on a phone that call is somebody's battery as well as their
   * tokens.
   */
  const prewarmFit = () => {
    // The page this sheet was started from, when there is one — see `posting`.
    const source = posting
      ? { fileId: posting.id, name: posting.name }
      : postingSourceForUrl(graph, form.url.trim() || undefined)
    if (!source) return
    if (settings.model.trim() === '') return
    if (projections.background(graph).length === 0) return
    /*
     * Swallowed, and this is the one place in the app where that is right. The
     * prewarm has no UI: nobody is looking at it, and a failure costs only the
     * head start. The panel runs the same read when the record is opened,
     * reports the reason in place and offers a retry — so raising anything here
     * would be a second telling of a story the user has not started reading.
     *
     * The catch is still needed. Without it a throw is an unhandled rejection,
     * which is a console error on the web and a red box on the phone, for a
     * background task that failed exactly as designed.
     */
    void readFit({ fileId: source.fileId, name: source.name, settings }).catch(() => {})
  }

  /** The write itself, once the check has had its say. */
  const createNow = () => {
    const fields = shared()
    const created = applications.add({
      ...fields,
      // The store's own default reads 'Draft created', which is a lie for
      // anything logged at a later stage — people add an interview they are
      // already booked for.
      lastAction: fields.stage === 'draft' ? undefined : `Added at ${STAGE_LABEL[fields.stage]}`,
    })
    setRecord(refKey('app', created.id), keywords)
    // The phone's half of the web's `application_created` (Q175, review 2026-11-16).
    void report('application_created', { source: 'manual' })
    // Filed under what it became; added to any filing it already has, since
    // `applicationIds` is a set. Web does this inside its undo; see there.
    if (posting) {
      vault.updateFile(posting.id, {
        applicationIds: [...new Set([...posting.applicationIds, created.id])],
      })
    }
    if (form.deadline) mintDeadline(created, form.deadline)
    prewarmFit()

    toast({
      title: t('application.toast.added', { name: displayName(created) }),
      description: [
        form.deadline
          ? t('application.toast.deadlineOnCalendar', { date: domain.shortDate(form.deadline) })
          : t('application.toast.noDeadline'),
        posting ? t('application.toast.postingFiled') : '',
      ]
        .filter(Boolean)
        .join(' '),
    })
    onOpenChange(false)
  }

  /**
   * The check between Save and the write — arithmetic first, the model second
   * and only when there is something at the same employer to compare with.
   * Nothing is written until the person has seen the original. Web's dialog
   * does the same in `confirmThenCreate`.
   */
  const confirmThenCreate = async () => {
    const stop = new AbortController()
    checkAbort.current = stop
    setChecking(true)
    let found: DuplicateFound<Application> | null = null
    try {
      found = await checkDuplicate({
        existing: applications.all,
        candidate: {
          org: form.org,
          role: form.role,
          url: form.url,
          postingId: form.postingId,
          location: form.location,
        },
        settings,
        signal: stop.signal,
      })
    } catch {
      found = null
    }
    checkAbort.current = null
    setChecking(false)
    if (stop.signal.aborted) return
    if (found) {
      setConfirm(found)
      return
    }
    createNow()
  }

  const onSave = () => {
    setAttempted(true)
    if (Object.keys(validate(form)).length > 0 || blocker) return

    if (mode === 'create') {
      void confirmThenCreate()
      return
    } else if (record) {
      const fields = shared()
      const moved = record.stage !== fields.stage
      const lastAction = moved ? `Moved to ${STAGE_LABEL[fields.stage]}` : 'Details edited'

      applications.update(record.id, { ...fields, lastAction })
      // One write, not two. There used to be a `removeRecord(record.id)` under
      // this line, sweeping the bare-id spelling the seeded applications were
      // keyed by so the record was not counted twice in the filter's totals.
      // That premise died with D14: a keyword is a node and tagging is a `TAGS`
      // edge, and `recordKey` unwraps 'app:app:0192…' — so both spellings name
      // the SAME node and the sweep cleared the keywords the line above had
      // just set. Driven through the real tool runtime: after `setRecord` the
      // application carried its keyword, after `removeRecord` it carried none,
      // so every edit of an application silently dropped all of them. Web fixed
      // its copy in `use-application-writes.ts`; this side kept the dead line.
      setRecord(refKey('app', record.id), keywords)

      const next: Application = { ...record, ...fields, lastAction, daysAgo: 0 }
      const removed = syncDeadline(next, record)

      toast({
        title: t('application.toast.saved'),
        description: removed
          ? t('application.toast.deadlineRemoved', { name: displayName(next) })
          : displayName(next),
        // The record's own fields can be typed back; a timeline item deleted as
        // a side effect of clearing one field cannot, so the one destructive
        // part of this save is the part that gets the undo.
        action: removed
          ? { label: t('application.toast.restoreDeadline'), onPress: removed.restore }
          : undefined,
      })
    }

    onOpenChange(false)
  }

  const title = record
    ? t('application.editTitle', { name: displayName(record) })
    : t('application.newTitle')

  return (
    <Sheet
      open={open}
      onClose={onDismiss}
      size="tall"
      title={title}
      description={
        mode === 'edit'
          ? t('application.description.edit')
          : guessed
            ? tagged
              ? t('application.description.prefilledTagged')
              : t('application.description.prefilled')
            : t('application.description.create')
      }
      footer={
        confirm ? (
          <>
            <Button
              label={t('application.duplicate.editInstead')}
              variant="ghost"
              size="md"
              onPress={() => setConfirm(null)}
            />
            <Button
              label={t('application.duplicate.discard')}
              variant="outline"
              size="md"
              onPress={onDismiss}
            />
            <Button label={t('application.duplicate.addAnyway')} size="md" onPress={createNow} />
          </>
        ) : (
          <>
            <Button label={t('common.cancel')} variant="ghost" size="md" onPress={onDismiss} />
            {/* Never disabled for invalid input: a dead button next to an empty
                form explains nothing, where a tap that surfaces the errors says
                exactly what is missing. */}
            <Button
              label={
                checking
                  ? t('application.checking')
                  : mode === 'create'
                    ? t('application.add')
                    : t('application.save')
              }
              size="md"
              blocker={blocker}
              disabled={checking}
              onPress={onSave}
            />
          </>
        )
      }
    >
      {confirm ? (
        <DuplicateConfirm
          found={confirm}
          adding={{ org: form.org, role: form.role, location: form.location }}
          onOpen={() => {
            onDismiss()
            fromOverlay((nav) => nav.navigate('ApplicationDetail', { id: confirm.record.id }))
          }}
        />
      ) : null}
      <ScrollView
        style={confirm ? { display: 'none' } : undefined}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: space[3.5], paddingBottom: space[2] }}
      >
        {duplicate ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={t('application.duplicate.openExisting', {
              name: displayName(duplicate.record),
            })}
            onPress={() => {
              onDismiss()
              fromOverlay((nav) => nav.navigate('ApplicationDetail', { id: duplicate.record.id }))
            }}
            style={[
              styles.duplicate,
              { backgroundColor: c.warningSoft, borderColor: c.warningBorder },
            ]}
          >
            <Txt size="xs" style={{ color: c.warning }}>
              {duplicateMessage(duplicate.reason, displayName(duplicate.record))}{' '}
              {t('application.duplicate.tapToOpen')}
            </Txt>
          </Pressable>
        ) : null}

        <TextField
          label={t('application.fields.org')}
          required
          value={form.org}
          error={errors.org}
          autoCapitalize="words"
          // Placeholders name the shape of the answer, never a plausible one.
          // The web version once reproduced the Rice record field for field, so
          // the empty create form read as a filled duplicate of a record the
          // user already had — and the only tell was that the text was grey.
          placeholder={t('application.fields.orgPlaceholder')}
          onChangeText={(v) => set('org', v)}
        />
        <TextField
          label={t('application.fields.role')}
          required
          value={form.role}
          error={errors.role}
          placeholder={t('application.fields.rolePlaceholder')}
          onChangeText={(v) => set('role', v)}
        />

        <FormField label={t('application.fields.roleTag')} required error={errors.roleTag}>
          <Button
            label={form.roleTag || t('application.fields.pickRoleTag')}
            variant="outline"
            size="md"
            icon="chevrons-down"
            full
            onPress={() => setRolesOpen(true)}
          />
        </FormField>

        <FormField label={t('application.fields.stage')} required>
          <Segment
            label={t('application.fields.stage')}
            scroll
            options={STAGES.map((s) => ({ value: s.id, label: domain.stage(s.id) }))}
            value={form.stage}
            onChange={(s) => set('stage', s)}
          />
        </FormField>

        <DateField
          label={t('application.fields.deadline')}
          value={form.deadline}
          onChange={(iso) => set('deadline', iso)}
          hint={t('application.fields.deadlineHint')}
          clearable
        />

        <FormField label={t('application.fields.source')}>
          <Segment
            label={t('application.fields.source')}
            scroll
            options={sourceOptions(t('application.fields.sourceNotSet'))}
            value={form.source}
            onChange={(s) => set('source', s)}
          />
        </FormField>

        <TextField
          label={t('application.fields.location')}
          value={form.location}
          placeholder={t('application.fields.locationPlaceholder')}
          onChangeText={(v) => set('location', v)}
        />
        <TextField
          label={t('application.fields.comp')}
          value={form.comp}
          placeholder={t('application.fields.compPlaceholder')}
          onChangeText={(v) => set('comp', v)}
        />
        <TextField
          label={t('application.fields.url')}
          value={form.url}
          error={errors.url}
          mono
          autoCapitalize="none"
          keyboardType="url"
          placeholder="https://…"
          onChangeText={(v) => set('url', v)}
        />
        <TextField
          label={t('application.fields.postingId')}
          hint={t('application.fields.postingIdHint')}
          value={form.postingId}
          mono
          autoCapitalize="none"
          placeholder={t('application.fields.postingIdPlaceholder')}
          onChangeText={(v) => set('postingId', v)}
        />
        <TextField
          label={t('application.fields.note')}
          value={form.note}
          multiline
          placeholder={t('application.fields.notePlaceholder')}
          onChangeText={(v) => set('note', v)}
        />

        <FormField label={t('application.fields.keywords')}>
          <StagedKeywordPicker value={keywords} onChange={setKeywords} />
        </FormField>

        <View style={{ height: space[2] }} />
      </ScrollView>

      <MenuSheet
        open={rolesOpen}
        onClose={() => setRolesOpen(false)}
        title={t('application.fields.roleTag')}
        description={t('application.fields.roleTagDescription')}
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
 * Read under both spellings — belt and braces now rather than a necessity. The
 * comment here used to say the label store keyed the seeded applications by
 * bare id while `refKey` spelled the same edge 'app:rice', so both were live at
 * once. Since D14 they are not: `recordKey` in `react/use-keywords` unwraps the
 * wrapper, both spellings land on the same node, and the `Set` below therefore
 * dedupes one answer against itself. Left in place because it costs one graph
 * read and is what makes this safe while `refKey` still has call sites; the
 * wrong half of the old note is what mattered, because the same false premise
 * is what put a keyword-clearing `removeRecord` in `onSave` above.
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

/** "today", "yesterday", "12 days ago" — the projection counts the days. */
const sinceDays = (days: number): string =>
  days <= 0
    ? i18next.t('sheets:application.since.today')
    : days === 1
      ? i18next.t('sheets:application.since.yesterday')
      : i18next.t('sheets:application.since.daysAgo', { count: days })

/**
 * The original beside what is about to be added. The phone's half of web's
 * `DuplicateConfirm`: inside the same sheet, because two sheets at once means
 * the second is invisible, and the form stays mounted underneath so "Edit
 * instead" returns to it with everything still typed.
 */
function DuplicateConfirm({
  found,
  adding,
  onOpen,
}: {
  found: DuplicateFound<Application>
  adding: { org: string; role: string; location: string }
  onOpen: () => void
}) {
  const { t } = useTranslation('sheets')
  const domain = useDomain()
  const c = useColors()
  const original = found.record
  const why =
    found.how === 'model'
      ? (found.because ?? t('application.duplicate.modelSame'))
      : duplicateMessage(found.reason, displayName(original))
  const card = {
    borderWidth: 1,
    borderColor: c.hairline,
    borderRadius: 10,
    padding: space[3],
    gap: space[1],
  } as const
  return (
    <View style={{ gap: space[3] }}>
      <View
        style={[styles.duplicate, { backgroundColor: c.warningSoft, borderColor: c.warningBorder }]}
      >
        <Txt size="sm" weight="medium" style={{ color: c.warning }}>
          {t('application.duplicate.title')}
        </Txt>
        <Txt size="xs" style={{ color: c.warning }}>
          {why}
          {found.how === 'model' ? t('application.duplicate.modelReading') : ''}
        </Txt>
      </View>

      <View style={card}>
        <Txt size="xs" tone="muted" uppercase>
          {t('application.duplicate.existing')}
        </Txt>
        <Txt size="sm" weight="medium">
          {displayName(original)}
        </Txt>
        <Txt size="sm" tone="secondary">
          {domain.stage(original.stage)} · {domain.action(original.lastAction)}{' '}
          {sinceDays(original.daysAgo)}
        </Txt>
        {original.location !== undefined && (
          <Txt size="sm" tone="secondary">
            {original.location}
          </Txt>
        )}
        {original.postingId !== undefined && (
          <Txt size="xs" tone="muted">
            {t('application.duplicate.postingId', { id: original.postingId })}
          </Txt>
        )}
        {original.url !== undefined && (
          <Txt size="xs" tone="muted" numberOfLines={1}>
            {original.url}
          </Txt>
        )}
        {original.note !== '' && (
          <Txt size="xs" tone="secondary" numberOfLines={3}>
            {original.note}
          </Txt>
        )}
        <View style={{ alignItems: 'flex-start', marginTop: space[1] }}>
          <Button
            label={t('application.duplicate.openYours')}
            variant="outline"
            size="sm"
            onPress={onOpen}
          />
        </View>
      </View>

      <View style={card}>
        <Txt size="xs" tone="muted" uppercase>
          {t('application.duplicate.adding')}
        </Txt>
        <Txt size="sm" weight="medium">
          {[adding.org.trim(), adding.role.trim()].filter(Boolean).join(' — ') ||
            t('application.duplicate.untitled')}
        </Txt>
        {adding.location.trim() !== '' && (
          <Txt size="sm" tone="secondary">
            {adding.location}
          </Txt>
        )}
      </View>
    </View>
  )
}
