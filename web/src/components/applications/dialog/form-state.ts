import type { Application, RoleTag, Source, Stage } from '@/data/seed'
import { i18next } from '@/i18n/i18n'
import { refKey } from '@/lib/ids'

/**
 * `deadline` is not on `Application` — it is a timeline item this dialog mints.
 * `keywords` is not either: it lives in the label store, and travels here for
 * two reasons — so a discarded draft can be handed back intact by the undo in
 * its toast, and so a form opened from a posting can arrive with the keywords
 * the model matched already ticked (`matchKeywords`, in agent/read-posting).
 */
export type ApplicationInitial = Partial<Application> & {
  deadline?: string
  keywords?: string[]
  /**
   * The saved posting this form was started from — "From link" keeps the page
   * before the form opens — which is filed under the application when it is
   * created. Carried in `initial` rather than beside it so that "Draft
   * discarded · Undo" hands the form back still knowing which page it came from.
   */
  postingFileId?: string
  /**
   * The deadline the calendar holds for this record now, apart from `deadline`
   * (what the field is prefilled with). They differ after "Changes discarded ·
   * Undo": the form comes back holding the typed date, and a save diffed
   * against that prefill sent nothing, so the change was silently dropped.
   */
  storedDeadline?: string
  /**
   * Set on the draft "Changes discarded · Undo" (or "Draft discarded · Undo")
   * hands back. That draft becomes `initial`, so a form measured against
   * `initial` read as untouched, and the next Escape closed it with no toast
   * and no Undo — the edits the person had just asked for back were gone.
   */
  restored?: boolean
  /**
   * The note's formatting, ENCODED (`encodeFormat`). Not on `Application` —
   * the projection carries no spans — so the dialog reads it off the node
   * when it opens on a record, and Undo hands it back with the draft.
   */
  noteFormat?: string
}

export type FormState = {
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
  confirmationRef: string
  location: string
  comp: string
  deadline: string
  note: string
  /** Beside `note`, encoded. `''` is a plain note. */
  noteFormat: string
}

export type FieldKey = 'org' | 'role' | 'roleTag' | 'url' | 'deadline'
export type Errors = Partial<Record<FieldKey, string>>

/** Where the focus goes on a failed submit — the order the fields are read in. */
export const FIELD_ORDER: FieldKey[] = ['org', 'role', 'roleTag', 'deadline', 'url']

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function formFrom(initial?: ApplicationInitial): FormState {
  return {
    org: initial?.org ?? '',
    role: initial?.role ?? '',
    roleTag: initial?.roleTag ?? '',
    stage: initial?.stage ?? 'draft',
    source: initial?.source ?? 'none',
    url: initial?.url ?? '',
    postingId: initial?.postingId ?? '',
    confirmationRef: initial?.confirmationRef ?? '',
    location: initial?.location ?? '',
    comp: initial?.comp ?? '',
    deadline: initial?.deadline ?? '',
    note: initial?.note ?? '',
    noteFormat: initial?.noteFormat ?? '',
  }
}

/**
 * Whether closing the dialog would take something with it.
 *
 * Measured against what it opened with — except for a draft handed back by
 * Undo, which is unsaved by definition however little has changed since: its
 * `initial` IS the typed draft, so the comparison would call it clean.
 */
export function hasUnsaved(
  form: FormState,
  keywords: readonly string[],
  initial: ApplicationInitial | undefined,
  openedKeywords: readonly string[],
): boolean {
  if (initial?.restored === true) return true
  const sorted = (ids: readonly string[]) => [...ids].sort().join(' ')
  return (
    JSON.stringify(form) !== JSON.stringify(formFrom(initial)) ||
    sorted(keywords) !== sorted(openedKeywords)
  )
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

export function validate(form: FormState): Errors {
  const errors: Errors = {}
  const t = (key: string) => i18next.t(`applications:validation.${key}`)

  if (!form.org.trim()) errors.org = t('org')
  if (!form.role.trim()) errors.role = t('role')
  if (!form.roleTag) errors.roleTag = t('roleTag')

  if (form.url.trim() && !isOpenableUrl(form.url.trim())) errors.url = t('url')

  // A date field hands back '' or an ISO string, but it degrades to a plain
  // text box in browsers that do not implement it, and this value is copied
  // straight onto a timeline item where anything else would break sorting.
  if (form.deadline && !ISO_DATE.test(form.deadline)) {
    errors.deadline = t('deadline')
  }

  return errors
}

/**
 * The keywords already on this record.
 *
 * Read under both spellings. The label store keys the seeded applications by
 * bare id while `refKey` spells the same edge 'app:rice', and both are live at
 * once — reading only the canonical one would show Rice as having no keywords
 * and quietly drop the two it has the moment anything else is saved.
 */
export function keywordsOf(
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
 * What the edit dialog opens with: the stored record, then whatever the opener
 * (or a draft handed back by "Changes discarded · Undo") brought.
 *
 * `storedDeadline` is read from the calendar on every open and always wins
 * over a copy carried in the draft, so the save diffs the form against the
 * date the calendar holds now — see `deadlineWrite`.
 */
export function editInitial(
  record: Application,
  opened: ApplicationInitial | undefined,
  stored: string | undefined,
): ApplicationInitial {
  return {
    ...record,
    ...opened,
    deadline: opened?.deadline ?? stored ?? '',
    storedDeadline: stored ?? '',
  }
}

/**
 * The deadline half of a save, as `application.update` reads it.
 *
 * Absent (`undefined`) when the field still holds what the dialog was opened
 * with: whoever opened it decides what to prefill, and a save that always wrote
 * would re-stamp the item every time someone edited a location. `null` when the
 * person emptied it — the tool then deletes the item it owns.
 */
export function deadlineWrite(
  form: Pick<FormState, 'deadline'>,
  initial: Pick<ApplicationInitial, 'deadline' | 'storedDeadline'> | undefined,
): string | null | undefined {
  // Against what is stored when the opener said, not what the field was seeded
  // with — a restored draft seeds it with the very change to be saved.
  const stored = initial?.storedDeadline ?? initial?.deadline ?? ''
  if (form.deadline === stored) return undefined
  return form.deadline === '' ? null : form.deadline
}

/**
 * A refusal from the tool, put where the person will see it.
 *
 * The form validates first, but the tool is the authority — a schema can refuse
 * what `validate` let through — and a refusal used to vanish while the dialog
 * closed under a "Changes saved" toast. A message naming a field this form has
 * goes on that field; the first message is also the toast's.
 */
export function refusalOf(errors: readonly { message: string; field?: string }[]): {
  message: string
  fields: Errors
} {
  const fields: Errors = {}
  for (const error of errors) {
    const key = FIELD_ORDER.find((k) => k === error.field)
    if (key !== undefined && fields[key] === undefined) fields[key] = error.message
  }
  return {
    message: errors[0]?.message ?? i18next.t('applications:validation.refusalFallback'),
    fields,
  }
}
