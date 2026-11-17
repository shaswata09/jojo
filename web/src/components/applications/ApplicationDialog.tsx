import { useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useDuplicateCheck } from '@/lib/duplicate-agent'
import type { DuplicateFound } from '@/lib/duplicate-agent'
import { useModelSettings } from '@/lib/model-settings-context'
import type { Application } from '@jojo/service/data/seed'
import type { FormEvent } from 'react'
import type { TFunction } from 'i18next'
import { ApplicationFields } from '@/components/applications/dialog/ApplicationFields'
import {
  FIELD_ORDER,
  formFrom,
  hasUnsaved,
  keywordsOf,
  validate,
} from '@/components/applications/dialog/form-state'
import type {
  ApplicationInitial,
  Errors,
  FormState,
} from '@/components/applications/dialog/form-state'
import { useApplicationWrites } from '@/components/applications/dialog/use-application-writes'
import type { SaveOutcome } from '@/components/applications/dialog/use-application-writes'
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
import { findDuplicate } from '@jojo/service/core/duplicates'
import { useApplications } from '@jojo/service/react/use-applications'
import { encodeFormat } from '@jojo/service/core/note-format'
import type { NodeId } from '@jojo/service/core/model'
import { useGraph } from '@jojo/service/react/kg-context'
import { useDialogs } from '@/lib/dialogs-context'
import { appPath, hrefOutsideRouter } from '@/lib/links'
import { useLabels } from '@/lib/labels-context'
import { useToast } from '@/lib/toast-context'
import { contentModal } from '@/components/ui/dialog-width'
import { useDomain } from '@/i18n/domain'

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
  initial: given,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  initial?: ApplicationInitial
}) {
  const { t } = useTranslation('applications')
  const domain = useDomain()
  const applications = useApplications()
  const { labelIdsOf } = useLabels()
  const { toast } = useToast()
  const { open: openDialog } = useDialogs()

  /*
   * What the dialog opened with, plus the note's stored formatting (Q268). A
   * record is opened from its projection, which carries no spans, so they are
   * read off the node here — once, like the form below — and from then on
   * `initial` is what the form, `hasUnsaved` and the writes all measure
   * against. A draft handed back by Undo already carries its own.
   */
  const graph = useGraph()
  const [initial] = useState<ApplicationInitial | undefined>(() =>
    given?.id !== undefined && given.noteFormat === undefined
      ? {
          ...given,
          noteFormat:
            encodeFormat(graph.node(given.id as NodeId, 'application')?.props.noteFormat) ?? '',
        }
      : given,
  )

  const [form, setForm] = useState<FormState>(() => formFrom(initial))
  const [keywords, setKeywords] = useState<string[]>(() => keywordsOf(initial, labelIdsOf))
  /** Errors are only shown once a submit has been attempted — see `onBlur`. */
  const [check, setCheck] = useState<{ attempted: boolean; errors: Errors }>({
    attempted: false,
    errors: {},
  })

  const { create, save } = useApplicationWrites({ form, keywords, initial })
  const { settings } = useModelSettings()
  const checkDuplicate = useDuplicateCheck()
  /*
   * The duplicate found at Save, held until the person answers. While it is
   * held the dialog shows the ORIGINAL beside what is being added, and the
   * three things they can do about it; nothing has been written.
   */
  const [confirm, setConfirm] = useState<DuplicateFound<Application> | null>(null)
  const [checking, setChecking] = useState(false)
  const checkAbort = useRef<AbortController | null>(null)

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
  const blocker = mode === 'edit' && !record ? t('dialog.noRecord') : ''

  /** Guessed values need checking; typed ones do not. See `draft-from.ts`. */
  const guessed = mode === 'create' && Boolean(initial?.org || initial?.role || initial?.url)

  /**
   * Whether the prefill also ticked keywords, which only a model read does.
   *
   * `guessed` is true for every prefilled create — the address-only route, the
   * share target, a posting promoted by the scout — and none of those reads a
   * page or can produce a keyword. Naming keywords in the sentence regardless
   * pointed four routes at a picker nothing had written to.
   */
  const tagged = guessed && (initial?.keywords?.length ?? 0) > 0

  /**
   * Whether this job is already in the store.
   *
   * A NOTICE, never a blocker. Three roles at one university is the case this
   * product is for, so the rule in `core/duplicates.ts` only fires on the same
   * posting URL or the same employer AND role — and even then the reader gets a
   * link to what they already have beside a form that still saves. Recomputed as
   * they type, because the address is usually pasted after the employer.
   */
  const duplicate = findDuplicate(
    applications.all,
    { org: form.org, role: form.role, url: form.url, postingId: form.postingId },
    mode === 'edit' ? id : undefined,
  )

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  /** Anything typed that closing would take with it. */
  const dirty = hasUnsaved(form, keywords, initial, keywordsOf(initial, labelIdsOf))

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
    noteFormat: form.noteFormat,
    deadline: form.deadline,
    keywords,
    // So the form it reopens counts as unsaved — see `hasUnsaved`.
    restored: true,
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
      title: mode === 'create' ? t('dialog.draftDiscarded') : t('dialog.changesDiscarded'),
      description:
        mode === 'create'
          ? t('dialog.draftDiscardedBody')
          : record
            ? t('dialog.changesDiscardedBody', { name: displayName(record) })
            : t('dialog.changesDiscardedBodyNoName'),
      action: {
        label: t('common.undo'),
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
    if (mode === 'create') {
      void confirmThenCreate()
      return
    }
    if (!record) return
    if (settled(save(record))) onOpenChange(false)
  }

  /**
   * Closes only on a write the store took.
   *
   * A refusal keeps the dialog open with what was typed still in it, the
   * message on the field it names, and the toast saying why — it used to close
   * under "Changes saved" whatever the tool answered.
   */
  function settled(outcome: SaveOutcome): boolean {
    if (outcome.ok) return true
    setCheck({ attempted: true, errors: outcome.fields })
    return false
  }

  /**
   * The check between Save and the write.
   *
   * Arithmetic first — the same posting ID, address, or employer and role —
   * and the model second, only when there is something at the same employer
   * to compare with (`use-duplicate-check`). Either way nothing is written
   * until the person has seen the original and said "add anyway". The check
   * runs at Save and not while typing, because a model call per keystroke is
   * a model call per keystroke; the yellow notice above the form is the
   * instant half and this is the deliberate one.
   */
  async function confirmThenCreate() {
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
      // A check that threw is not a duplicate. The save must not hang on it.
      found = null
    }
    checkAbort.current = null
    setChecking(false)
    if (stop.signal.aborted) return
    if (found) {
      setConfirm(found)
      return
    }
    if (settled(create())) onOpenChange(false)
  }

  const addAnyway = () => {
    if (settled(create())) onOpenChange(false)
    // Back to the form, where the refusal is written on its field.
    else setConfirm(null)
  }

  const errors = check.attempted ? check.errors : {}
  // The stored name, not the one being typed — a heading that rewrites itself
  // on every keystroke in the organisation field is hard to read past.
  const title = record ? t('dialog.editTitle', { name: displayName(record) }) : t('dialog.newTitle')

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true)
        else {
          checkAbort.current?.abort()
          onDismiss()
        }
      }}
    >
      <DialogContent
        // Two tiers rather than one. Every dialog got wider, and this is the
        // only one laying two columns of fields out inside that width — at
        // `lg` the pair sat at about 240px each, which is narrower than the
        // dates and the compensation line want to be.
        className={contentModal}
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
            {confirm
              ? t('dialog.confirmDescription')
              : mode === 'edit'
                ? t('dialog.editDescription')
                : guessed
                  ? tagged
                    ? t('dialog.guessedTaggedDescription')
                    : t('dialog.guessedDescription')
                  : t('dialog.createDescription')}
          </DialogDescription>
        </DialogHeader>

        {/* The live warning belongs to the form, and goes with it: while the
            confirm stage is up it would say the same sentence twice, once
            here and once in the box below (seen 2026-09-12). */}
        {duplicate && confirm === null ? (
          <div className="rounded-lg border border-warning-border bg-warning-soft px-3 py-2 text-xs text-warning">
            {/* An anchor, not a `<Link>`: `DialogHost` mounts this outside the
                router, where `<Link>` throws on a null context and takes the
                app down with it. `hrefOutsideRouter` explains the basename. */}
            <Trans
              t={t}
              i18nKey="dialog.duplicateWarning"
              values={{
                message: domain.duplicate(duplicate.reason, displayName(duplicate.record)),
              }}
              components={{
                anchor: (
                  <a
                    href={hrefOutsideRouter(appPath(duplicate.record))}
                    className="underline underline-offset-2"
                  />
                ),
              }}
            />
          </div>
        ) : null}

        {confirm ? (
          <DuplicateConfirm
            found={confirm}
            adding={{ org: form.org, role: form.role, location: form.location }}
            onBack={() => setConfirm(null)}
            onDiscard={() => onOpenChange(false)}
            onAddAnyway={addAnyway}
          />
        ) : null}

        {/* Native validation is off: it fires its own bubble before the submit
            handler runs, which would pre-empt the errors written below. */}
        <form onSubmit={onSubmit} noValidate hidden={confirm !== null}>
          {/* Inert while the duplicate check runs. `create` is the one from the
              render that handled Save, closed over that render's form, so a
              field edited during a model judge's seconds would be dropped from
              the saved record without a word. Freezing the fields also keeps
              what was checked and what is saved the same record. `inert`
              rather than a disabled fieldset because the note is a rich text
              editor, which a fieldset does not reach. */}
          <div inert={checking} aria-busy={checking || undefined}>
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
              noteFormat={form.noteFormat}
              onNoteFormatChange={(format) => set('noteFormat', format)}
            />
          </div>

          <DialogFooter className="mt-4">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('common.cancel')}
              </Button>
            </DialogClose>
            {/* Never disabled for invalid input: a dead button next to an empty
                form explains nothing, where a click that surfaces the errors
                says exactly what is missing. */}
            <Button
              type="submit"
              disabled={Boolean(blocker) || checking}
              title={blocker || undefined}
            >
              {checking
                ? t('dialog.checking')
                : mode === 'create'
                  ? t('dialog.add')
                  : t('dialog.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** "today", "yesterday", "12 days ago" — the projection counts the days. */
const sinceDays = (days: number, t: TFunction): string =>
  days <= 0
    ? t('dialog.since.today')
    : days === 1
      ? t('dialog.since.yesterday')
      : t('dialog.since.daysAgo', { count: days })

/**
 * The original, beside what is about to be added, and what to do about it.
 *
 * Shown INSIDE the same dialog rather than as a second one: `DialogHost`
 * mounts exactly one and opening another replaces this form, half typed. The
 * form stays mounted underneath, hidden, so "Edit instead" returns to it with
 * everything still there.
 *
 * Both records are shown because the decision is a comparison. A sentence
 * saying "this looks like a duplicate" asks the person to trust it; the two
 * records side by side let them see for themselves — which is the whole
 * argument `assess.ts` makes about verdicts, applied to this one.
 */
function DuplicateConfirm({
  found,
  adding,
  onBack,
  onDiscard,
  onAddAnyway,
}: {
  found: DuplicateFound<Application>
  adding: { org: string; role: string; location: string }
  onBack: () => void
  onDiscard: () => void
  onAddAnyway: () => void
}) {
  const { t } = useTranslation('applications')
  const domain = useDomain()
  const original = found.record
  const why =
    found.how === 'model'
      ? (found.because ?? t('dialog.duplicate.modelSame'))
      : domain.duplicate(found.reason, displayName(original))
  return (
    <div className="space-y-4" role="alertdialog" aria-labelledby="duplicate-title">
      <div className="rounded-lg border border-warning-border bg-warning-soft px-3 py-2 text-sm text-warning">
        <p id="duplicate-title" className="font-medium">
          {t('dialog.duplicate.title')}
        </p>
        <p className="mt-0.5 text-xs">
          {found.how === 'model' ? t('dialog.duplicate.modelWhy', { why }) : why}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <section className="rounded-lg border border-hairline p-3 text-sm">
          <h3 className="text-xs font-medium tracking-wide text-text-3 uppercase">
            {t('dialog.duplicate.have')}
          </h3>
          <p className="mt-1 font-medium">{displayName(original)}</p>
          <p className="text-text-2">
            {domain.stage(original.stage)}
            {' · '}
            {domain.action(original.lastAction)} {sinceDays(original.daysAgo, t)}
          </p>
          {original.location !== undefined && <p className="text-text-2">{original.location}</p>}
          {original.comp !== undefined && <p className="text-text-2">{original.comp}</p>}
          {original.postingId !== undefined && (
            <p className="text-xs text-text-3">
              {t('dialog.duplicate.postingId', { id: original.postingId })}
            </p>
          )}
          {original.url !== undefined && (
            <p className="truncate text-xs text-text-3" title={original.url}>
              {original.url}
            </p>
          )}
          {original.note !== '' && (
            <p className="mt-1 line-clamp-3 text-xs text-text-2">{original.note}</p>
          )}
        </section>
        <section className="rounded-lg border border-hairline p-3 text-sm">
          <h3 className="text-xs font-medium tracking-wide text-text-3 uppercase">
            {t('dialog.duplicate.adding')}
          </h3>
          <p className="mt-1 font-medium">
            {[adding.org.trim(), adding.role.trim()].filter(Boolean).join(' — ') ||
              t('dialog.duplicate.untitled')}
          </p>
          {adding.location.trim() !== '' && <p className="text-text-2">{adding.location}</p>}
        </section>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" className="sm:me-auto" onClick={onBack}>
          {t('dialog.duplicate.editInstead')}
        </Button>
        {/* An anchor, not a `<Link>`: this dialog is mounted outside the router. */}
        <Button type="button" variant="outline" asChild>
          <a href={hrefOutsideRouter(appPath(original))} onClick={onDiscard}>
            {t('dialog.duplicate.open')}
          </a>
        </Button>
        <Button type="button" variant="outline" onClick={onDiscard}>
          {t('dialog.duplicate.discard')}
        </Button>
        <Button type="button" onClick={onAddAnyway}>
          {t('dialog.duplicate.addAnyway')}
        </Button>
      </DialogFooter>
    </div>
  )
}
