import { useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Check, ChevronsUpDown, Tag } from 'lucide-react'
import { DEADLINE_DETAIL, applicationDeadlineOf } from '@/components/applications/deadline'
import { Chip } from '@/components/common/Chip'
import { Field, FormField, TextareaField } from '@/components/common/Field'
import { Segment } from '@/components/common/Segment'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ROLES, SOURCES, STAGES, displayName } from '@/data/seed'
import type { Application, RoleTag, Source, Stage, Urgency } from '@/data/seed'
import { daysBetween, shortDate } from '@/data/timeline'
import { useApplications } from '@/kg/react/use-applications'
import { useTimeline } from '@/kg/react/use-timeline'
import { useDialogs } from '@/lib/dialogs-context'
import { refKey } from '@/lib/ids'
import { useLabels } from '@/lib/labels-context'
import { useToast } from '@/lib/toast-context'
import { TODAY } from '@/lib/today'
import { useUndoable } from '@/lib/undo'
import { cn } from '@/lib/utils'

/**
 * `deadline` is not on `Application` — it is a timeline item this dialog mints.
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

type FieldKey = 'org' | 'role' | 'roleTag' | 'url' | 'deadline'
type Errors = Partial<Record<FieldKey, string>>

const STAGE_OPTIONS = STAGES.map((s) => ({ value: s.id, label: s.label }))
const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.id, s.label])) as Record<Stage, string>

const SOURCE_OPTIONS: { value: Source | 'none'; label: string }[] = [
  { value: 'none', label: 'Not set' },
  ...SOURCES.map((s) => ({ value: s, label: s })),
]

/** Where the focus goes on a failed submit — the order the fields are read in. */
const FIELD_ORDER: FieldKey[] = ['org', 'role', 'roleTag', 'deadline', 'url']

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

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

/**
 * A URL a browser can actually open.
 *
 * `new URL` alone is not the test: 'javascript:alert(1)' parses perfectly and
 * would end up behind the posting link on the application's own page.
 */
function isOpenableUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
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

  // A date field hands back '' or an ISO string, but it degrades to a plain
  // text box in browsers that do not implement it, and this value is copied
  // straight onto a timeline item where anything else would break sorting.
  if (form.deadline && !ISO_DATE.test(form.deadline)) {
    errors.deadline = 'Use a date in the form 2026-11-01.'
  }

  return errors
}

/**
 * How loud a new deadline reads on the calendar.
 *
 * The seed mixes proximity with readiness — Rice is red at three weeks because
 * nothing is written yet. Readiness is not something a form can know, so this
 * uses the half that is knowable and lets the user override it later.
 */
function deadlineUrgency(date: string): Urgency {
  const days = daysBetween(TODAY, date)
  if (days <= 7) return 'red'
  if (days <= 21) return 'amber'
  return 'gray'
}

/**
 * Create and edit an application.
 *
 * One component for both, because the two forms are the same eleven fields and
 * the same validation — the differences are the title, which verb the toast
 * uses, and whether the deadline is minted or rescheduled.
 *
 * Nothing is written until Save. Every field, keywords included, is staged in
 * local state so Cancel means cancel; a picker that wrote through on click
 * would leave the record half-edited behind a dialog the user just dismissed.
 */
export function ApplicationDialog({
  open,
  onOpenChange,
  mode,
  initial,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  initial?: ApplicationInitial
  onSaved?: (application: Application) => void
}) {
  const applications = useApplications()
  const timeline = useTimeline()
  const { labelIdsOf, setRecord } = useLabels()
  const { toast } = useToast()
  const { open: openDialog } = useDialogs()
  const undoable = useUndoable()

  const [form, setForm] = useState<FormState>(() => formFrom(initial))
  const [keywords, setKeywords] = useState<string[]>(() => keywordsOf(initial, labelIdsOf))
  /** Errors are only shown once a submit has been attempted — see `onBlur`. */
  const [check, setCheck] = useState<{ attempted: boolean; errors: Errors }>({
    attempted: false,
    errors: {},
  })
  const [rolesOpen, setRolesOpen] = useState(false)
  // A <button> is a labelable element, so pointing the field's label at the
  // trigger both names it and makes the label click through to it.
  const roleTagId = useId()

  const orgRef = useRef<HTMLInputElement>(null)
  const roleRef = useRef<HTMLInputElement>(null)
  const roleTagRef = useRef<HTMLButtonElement>(null)
  const deadlineRef = useRef<HTMLInputElement>(null)
  const urlRef = useRef<HTMLInputElement>(null)

  /**
   * Reopening has to start from the new `initial`, not from whatever the last
   * visit left behind — the same mounted dialog serves "new application" and
   * "edit Rice" one after the other. Adjusting during render rather than in an
   * effect keeps the first painted frame correct.
   */
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setForm(formFrom(initial))
      setKeywords(keywordsOf(initial, labelIdsOf))
      setCheck({ attempted: false, errors: {} })
    }
  }

  const id = initial?.id
  const record = mode === 'edit' && id ? applications.get(id) : undefined
  // An edit dialog with nothing to edit is a wiring mistake, not a user error,
  // so it says so on the button rather than failing at the point of save.
  const blocker =
    mode === 'edit' && !record ? 'This dialog was opened without a record to edit' : ''

  /** Guessed values need checking; typed ones do not. See `draft-from.ts`. */
  const guessed = mode === 'create' && Boolean(initial?.org || initial?.role || initial?.url)

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  /** Anything typed that closing would take with it. */
  const dirty =
    JSON.stringify(form) !== JSON.stringify(formFrom(initial)) ||
    [...keywords].sort().join(' ') !== [...keywordsOf(initial, labelIdsOf)].sort().join(' ')

  /** The typed values, in the shape that reopens this dialog holding them. */
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
   * Escape, the backdrop and Cancel all land here.
   *
   * A second modal asking "are you sure?" is the wrong guard for a form: it
   * fires on the way out of the one path a user takes when they have already
   * decided, and it fires just as often on a form holding a single stray
   * character. So the close is never blocked — it is made reversible instead,
   * and the undo hands the dialog back with every field, keywords included,
   * exactly as it was. One rule for all four dismissals rather than singling
   * out escape: from the user's side they are the same act and should not have
   * different consequences.
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
        onClick: () => openDialog('application', { mode, id, initial: draft }),
      },
    })
  }

  /**
   * Nothing is checked per keystroke — an error appearing under a field while
   * you are still typing the value that fixes it is noise. After the first
   * submit the errors are already on screen, so blur re-runs the whole set and
   * they clear as they are corrected.
   */
  const revalidate = () => {
    if (!check.attempted) return
    setCheck((c) => ({ ...c, errors: validate(form) }))
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const errors = validate(form)
    setCheck({ attempted: true, errors })

    if (Object.keys(errors).length > 0) {
      // Focused from the refs rather than by querying for `aria-invalid`, which
      // is only on the DOM a render later — by then the user has moved on.
      const refs = {
        org: orgRef,
        role: roleRef,
        roleTag: roleTagRef,
        deadline: deadlineRef,
        url: urlRef,
      }
      const first = FIELD_ORDER.find((key) => errors[key])
      if (first) refs[first].current?.focus()
      return
    }

    // Written out rather than `onSaved?.(create())`: an optional call skips its
    // own arguments when the callback is undefined, so the write to the store
    // never happened for any caller that did not pass `onSaved` — which is every
    // caller going through DialogHost. The dialog closed and nothing was saved.
    if (mode === 'create') {
      const created = create()
      onSaved?.(created)
    } else if (record) {
      const updated = save(record)
      onSaved?.(updated)
    } else return

    onOpenChange(false)
  }

  /** Only ever called on a form that has passed `validate`, hence the cast. */
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

  /**
   * One user action, three writes — the record, its keywords, and the deadline
   * the form minted — so the Undo has to cover all three.
   *
   * This toast had none at all, which broke the app's own law that every write
   * carries one, and it was the only "added" toast in the app that did not:
   * deleting an application offers a restore, and so does discarding this very
   * form. `undoable` wraps the whole burst rather than the create alone,
   * because reverting only the record would have left the deadline on the
   * calendar pointing at an application that no longer existed.
   */
  function create(): Application {
    const { value: created, restore } = undoable(() => {
      const fields = shared()
      const record = applications.add({
        ...fields,
        // The store's own default reads 'Draft created', which is a lie for
        // anything logged at a later stage — people add an interview they are
        // already booked for.
        lastAction: fields.stage === 'draft' ? undefined : `Added at ${STAGE_LABEL[fields.stage]}`,
      })

      setRecord(refKey('app', record.id), keywords)
      if (form.deadline) mintDeadline(record)
      return record
    })

    toast({
      title: `${displayName(created)} added`,
      description: form.deadline
        ? `Deadline ${shortDate(form.deadline)} is on the calendar.`
        : 'No deadline yet — add one and it shows up in This week.',
      action: restore ? { label: 'Undo', onClick: restore } : undefined,
    })
    return created
  }

  function save(current: Application): Application {
    const fields = shared()
    const moved = current.stage !== fields.stage
    const lastAction = moved ? `Moved to ${STAGE_LABEL[fields.stage]}` : 'Details edited'

    applications.update(current.id, { ...fields, lastAction })
    // One write, not two. There used to be a `removeRecord(current.id)` under
    // this line, sweeping the bare-id spelling the seeded applications were
    // keyed by so the record did not exist under two keys and get counted
    // twice. Both spellings now resolve to the same node (D14 — a keyword is a
    // node and tagging is a `TAGS` edge), so that call cleared the keywords this
    // one had just set.
    setRecord(refKey('app', current.id), keywords)

    // Mirrors what `update` stamps, so `onSaved` hands back the record the store
    // now holds rather than one with a stale activity line.
    const next: Application = { ...current, ...fields, lastAction, daysAgo: 0 }
    const removed = syncDeadline(next, current)

    toast({
      title: 'Changes saved',
      description: removed
        ? `${displayName(next)} — its deadline is off the calendar.`
        : displayName(next),
      // The record's own fields can be typed back; a timeline item that was
      // deleted as a side effect of clearing one field cannot, so the one
      // destructive part of this save is the part that gets the undo.
      action: removed ? { label: 'Restore deadline', onClick: removed.restore } : undefined,
    })
    return next
  }

  function mintDeadline(application: Application) {
    // Without this the first application anyone adds is invisible everywhere
    // that reads dates — the calendar, This week, the priority deck — and the
    // app looks like it lost the record.
    timeline.add({
      title: displayName(application),
      detail: DEADLINE_DETAIL,
      date: form.deadline,
      kind: 'deadline',
      urgency: deadlineUrgency(form.deadline),
      applicationId: application.id,
      allDay: true,
      // Off, like every seeded application deadline. The reminders list and the
      // command palette both caption a reminder with its related application,
      // and this item's title IS that application — so with `remind` on the row
      // rendered its own name twice. It still reaches the calendar, This week
      // and the priority deck, which read the whole timeline rather than the
      // reminders slice.
      remind: false,
    })
  }

  /** Returns the undo handle when the edit deleted a deadline, otherwise null. */
  function syncDeadline(next: Application, previous: Application) {
    // An untouched date field must not reach the calendar at all. Whoever opened
    // this dialog decides what to prefill, and a save that always wrote would
    // mint a duplicate deadline every time someone edited a location.
    if (form.deadline === (initial?.deadline ?? '')) return null

    const existing = applicationDeadlineOf(timeline.forApplication(next.id))

    if (!form.deadline) {
      if (!existing) return null
      return timeline.remove(existing.id)
    }

    if (!existing) {
      mintDeadline(next)
      return null
    }

    const dateChanged = existing.date !== form.deadline
    timeline.update(existing.id, {
      date: form.deadline,
      // Renaming the employer should carry to the calendar, but only while the
      // item still holds the name this dialog gave it. Once someone has retitled
      // it by hand that title is theirs, not a derived string to overwrite.
      title: existing.title === displayName(previous) ? displayName(next) : existing.title,
      urgency: dateChanged ? deadlineUrgency(form.deadline) : existing.urgency,
    })
    return null
  }

  const errors = check.attempted ? check.errors : {}
  // The stored name, not the one being typed — a heading that rewrites itself
  // on every keystroke in the organisation field is hard to read past.
  const title = record ? `Edit ${displayName(record)}` : 'New application'

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true)
        else onDismiss()
      }}
    >
      <DialogContent
        className="sm:max-w-lg"
        onOpenAutoFocus={(event) => {
          if (!guessed) return
          // A prefill is a guess, so focus lands on the guessed value with it
          // selected — one keystroke replaces it. The employer wins when it came
          // back empty, which is what a job-board URL usually leaves behind.
          event.preventDefault()
          const target = form.org ? roleRef.current : orgRef.current
          target?.focus()
          target?.select()
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {mode === 'edit'
              ? 'Changes replace the current details, and the deadline moves with them.'
              : guessed
                ? 'Prefilled from what you pasted — check the employer and role before saving.'
                : 'Track a job you are applying for. Starred fields are required.'}
          </DialogDescription>
        </DialogHeader>

        {/* Native validation is off: it fires its own bubble before the submit
            handler runs, which would pre-empt the errors written below.

            Placeholders name the shape of the answer, never a plausible one.
            They used to reproduce the Rice record field for field — "Rice",
            "Assistant professor, statistics", "Houston, TX", its posting URL —
            so the empty create form read as a filled duplicate of a record the
            user already had, and the only way to tell was that the text was
            grey. */}
        <form onSubmit={onSubmit} noValidate>
          <div className="-mx-1 grid max-h-[min(58vh,30rem)] gap-x-3 gap-y-3.5 overflow-y-auto px-1 pb-1 sm:grid-cols-2">
            <Field
              ref={orgRef}
              label="Organisation"
              required
              autoComplete="off"
              placeholder="Employer or institution"
              value={form.org}
              error={errors.org}
              onChange={(e) => set('org', e.target.value)}
              onBlur={revalidate}
            />
            <Field
              ref={roleRef}
              label="Role title"
              required
              autoComplete="off"
              placeholder="e.g. Senior data analyst"
              value={form.role}
              error={errors.role}
              onChange={(e) => set('role', e.target.value)}
              onBlur={revalidate}
            />

            <FormField label="Role tag" required error={errors.roleTag} htmlFor={roleTagId}>
              <Popover open={rolesOpen} onOpenChange={setRolesOpen}>
                <PopoverTrigger asChild>
                  <Button
                    ref={roleTagRef}
                    id={roleTagId}
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-haspopup="listbox"
                    aria-expanded={rolesOpen}
                    aria-invalid={errors.roleTag ? true : undefined}
                    className="w-full justify-between font-normal"
                  >
                    <span className={cn(!form.roleTag && 'text-text-3')}>
                      {form.roleTag || 'Pick a role tag'}
                    </span>
                    <ChevronsUpDown aria-hidden className="size-3.5 opacity-60" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-(--radix-popover-trigger-width) p-0"
                  // The list is five items — the field it belongs to should stay
                  // visible while you pick from it.
                  collisionPadding={12}
                >
                  <Command>
                    <CommandInput placeholder="Search role tags…" />
                    <CommandList>
                      <CommandEmpty>No role tag matches.</CommandEmpty>
                      <CommandGroup>
                        {ROLES.map((role) => (
                          <CommandItem
                            key={role}
                            value={role}
                            data-checked={role === form.roleTag}
                            onSelect={() => {
                              set('roleTag', role)
                              setRolesOpen(false)
                              if (check.attempted) {
                                setCheck((c) => ({
                                  ...c,
                                  errors: validate({ ...form, roleTag: role }),
                                }))
                              }
                            }}
                          >
                            {role}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </FormField>

            <Field
              ref={deadlineRef}
              label="Deadline"
              type="date"
              value={form.deadline}
              error={errors.deadline}
              hint="Puts a dated reminder on the calendar."
              onChange={(e) => set('deadline', e.target.value)}
              onBlur={revalidate}
            />

            {/* Full width, equal columns.
                Both tracks were `w-max` inside a scroller, so they sized to
                their own labels and stopped 55px and 58px short of the right
                edge every other field reaches — two ragged ends 3px apart from
                each other, which reads as a rendering fault rather than a
                choice. Sizing the options off the track instead of the other
                way round also retires the horizontal scrollbar the six stages
                grew at 390px. */}
            <FormField label="Stage" required className="sm:col-span-2">
              <Segment
                label="Stage"
                options={STAGE_OPTIONS}
                value={form.stage}
                onChange={(stage) => set('stage', stage)}
                className="w-full [&>button]:min-w-0 [&>button]:flex-1 [&>button]:px-1"
              />
            </FormField>

            <FormField label="Source" className="sm:col-span-2">
              <Segment
                label="Source"
                options={SOURCE_OPTIONS}
                value={form.source}
                onChange={(source) => set('source', source)}
                className="w-full [&>button]:min-w-0 [&>button]:flex-1 [&>button]:px-1"
              />
            </FormField>

            <Field
              label="Location"
              autoComplete="off"
              placeholder="City, or Remote"
              value={form.location}
              onChange={(e) => set('location', e.target.value)}
            />
            <Field
              label="Comp"
              autoComplete="off"
              placeholder="e.g. $96k + equity"
              value={form.comp}
              onChange={(e) => set('comp', e.target.value)}
            />

            <Field
              ref={urlRef}
              label="Posting URL"
              type="url"
              inputMode="url"
              autoComplete="off"
              placeholder="https://…"
              className="sm:col-span-2"
              value={form.url}
              error={errors.url}
              onChange={(e) => set('url', e.target.value)}
              onBlur={revalidate}
            />

            <TextareaField
              label="Note"
              rows={3}
              placeholder="What still has to happen before this goes out."
              className="sm:col-span-2"
              value={form.note}
              onChange={(e) => set('note', e.target.value)}
            />

            <FormField label="Keywords" className="sm:col-span-2">
              <KeywordPicker value={keywords} onChange={setKeywords} />
            </FormField>
          </div>

          <DialogFooter className="mt-4">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            {/* Never disabled for invalid input: a dead button next to an empty
                form explains nothing, where a click that surfaces the errors
                says exactly what is missing. */}
            <Button type="submit" disabled={Boolean(blocker)} title={blocker || undefined}>
              {mode === 'create' ? 'Add application' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
  const canonical = labelIdsOf(refKey('app', id))
  const legacy = labelIdsOf(id)
  return [...new Set([...canonical, ...legacy])]
}

/**
 * Pick keywords for a record that may not exist yet.
 *
 * `LabelPicker` writes straight through to the label store, which is right
 * beside a saved row and wrong inside a form: in create mode there is no record
 * id to write to, and in edit mode it would commit keywords that Cancel is
 * supposed to discard. This holds the selection instead and hands it back for
 * the caller to commit on save.
 */
function KeywordPicker({
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
              // behind it — that would save the application mid-thought.
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
