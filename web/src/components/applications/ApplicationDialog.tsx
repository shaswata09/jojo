import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApplicationFields } from '@/components/applications/dialog/ApplicationFields'
import {
  FIELD_ORDER,
  formFrom,
  keywordsOf,
  validate,
} from '@/components/applications/dialog/form-state'
import type {
  ApplicationInitial,
  Errors,
  FormState,
} from '@/components/applications/dialog/form-state'
import { useApplicationWrites } from '@/components/applications/dialog/use-application-writes'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { displayName } from '@/data/seed'
import type { RoleTag } from '@/data/seed'
import { useApplications } from '@/kg/react/use-applications'
import { useDialogs } from '@/lib/dialogs-context'
import { useLabels } from '@/lib/labels-context'
import { useToast } from '@/lib/toast-context'

export type { ApplicationInitial } from '@/components/applications/dialog/form-state'

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
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  initial?: ApplicationInitial
}) {
  const applications = useApplications()
  const { labelIdsOf } = useLabels()
  const { toast } = useToast()
  const { open: openDialog } = useDialogs()

  const [form, setForm] = useState<FormState>(() => formFrom(initial))
  const [keywords, setKeywords] = useState<string[]>(() => keywordsOf(initial, labelIdsOf))
  /** Errors are only shown once a submit has been attempted — see `onBlur`. */
  const [check, setCheck] = useState<{ attempted: boolean; errors: Errors }>({
    attempted: false,
    errors: {},
  })

  const { create, save } = useApplicationWrites({ form, keywords, initial })

  const orgRef = useRef<HTMLInputElement>(null)
  const roleRef = useRef<HTMLInputElement>(null)
  const roleTagRef = useRef<HTMLButtonElement>(null)
  const deadlineRef = useRef<HTMLInputElement>(null)
  const urlRef = useRef<HTMLInputElement>(null)

  /*
   * Reopening starts from the new `initial` because reopening MOUNTS this
   * component again — `DialogHost` varies its key per open (`dialog-mount.ts`)
   * and unmounts it on close, so the three initialisers above run for every
   * visit.
   *
   * There used to be a re-seed here instead: a render-phase `open !== wasOpen`
   * adjust, guarding against a reopen on an already-mounted instance. It could
   * never fire. The only mount site passes `open` as a literal `true`, so the
   * value it compared never changed — and the case it was written for did happen,
   * through the key, where it went unnoticed until someone pressed "Draft
   * discarded · Undo" over an already-open blank form and got the blank form
   * back. A guard that cannot run is worse than none, because it reads as cover.
   * Anything mounting this dialog with an `open` prop that toggles has to seed it
   * from a key that varies with the open, as the host does.
   */

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

  const selectRoleTag = (role: RoleTag) => {
    set('roleTag', role)
    if (check.attempted) {
      setCheck((c) => ({
        ...c,
        errors: validate({ ...form, roleTag: role }),
      }))
    }
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

    // There was an `onSaved?: (application) => void` here that no caller ever
    // passed — `DialogHost` is the only mount site and it passes four props —
    // and for a while the write itself lived inside the optional call:
    // `onSaved?.(create())` skips its own arguments when the callback is
    // undefined, so the dialog closed and nothing was saved, for every caller.
    // The prop is gone; the write is a statement.
    if (mode === 'create') create()
    else if (record) save(record)
    else return

    onOpenChange(false)
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
            handler runs, which would pre-empt the errors written below. */}
        <form onSubmit={onSubmit} noValidate>
          <ApplicationFields
            form={form}
            errors={errors}
            set={set}
            revalidate={revalidate}
            keywords={keywords}
            onKeywordsChange={setKeywords}
            onRoleTagSelect={selectRoleTag}
            orgRef={orgRef}
            roleRef={roleRef}
            roleTagRef={roleTagRef}
            deadlineRef={deadlineRef}
            urlRef={urlRef}
          />

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
