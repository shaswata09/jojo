import type { Application, RoleTag, Source, Stage } from '@/data/seed'
import { refKey } from '@/lib/ids'

/**
 * `deadline` is not on `Application` — it is a timeline item this dialog mints.
 * `keywords` is not either: it lives in the label store, and only travels here
 * so a discarded draft can be handed back intact by the undo in its toast.
 */
export type ApplicationInitial = Partial<Application> & {
  deadline?: string
  keywords?: string[]
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
  location: string
  comp: string
  deadline: string
  note: string
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

export function validate(form: FormState): Errors {
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
