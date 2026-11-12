import type { ApplicationInitial, Errors, FormState } from '@/components/applications/dialog/form-state'
import { deadlineWrite, refusalOf } from '@/components/applications/dialog/form-state'
import { STAGE_LABEL, displayName } from '@/data/seed'
import type { Application, RoleTag } from '@/data/seed'
import { shortDate } from '@/data/timeline'
import { useApplications } from '@jojo/service/react/use-applications'
import { useVault } from '@jojo/service/react/use-vault'
import { report } from '@/lib/analytics'
import { postingSourceForUrl } from '@jojo/service/core/posting-source'
import { useGraph, useKg } from '@jojo/service/react/kg-context'
import { useReadFit } from '@/lib/fit-agent'
import { useModelSettings } from '@/lib/model-settings-context'
import { useToast } from '@/lib/toast-context'
import { useUndoable } from '@/lib/undo'

/** What Save came to: the record as stored, or the tool's refusal to show. */
export type SaveOutcome =
  | { ok: true; application: Application }
  | { ok: false; message: string; fields: Errors }

/**
 * Everything `ApplicationDialog` writes when Save is pressed, and nothing else.
 *
 * Kept apart from the form because the writes here — the record, its keywords,
 * the deadline timeline item, and the posting filed under it — are the part
 * with consequences outside the dialog.
 *
 * The record, its keywords and its deadline travel in ONE `application.create`
 * or `application.update` call: one transaction, one journal entry, one Undo,
 * and the deadline goes through the tool layer's `syncDeadline` — the single
 * copy of the rule that re-titles it when the employer is renamed. This file
 * used to mint and sync the deadline itself, with its own copy of that rule,
 * and the copies had drifted: only this one re-titled, so a rename through the
 * assistant left the calendar naming the old employer.
 */
export function useApplicationWrites({
  form,
  keywords,
  initial,
}: {
  form: FormState
  keywords: string[]
  initial?: ApplicationInitial
}) {
  const applications = useApplications()
  const graph = useGraph()
  const { projections } = useKg()
  const { settings } = useModelSettings()
  const readFit = useReadFit()
  const { toast } = useToast()
  const undoable = useUndoable()
  const vault = useVault()

  /**
   * The saved posting this form was started from, while it is still in the
   * Vault. "From link" keeps the page before the form opens and hands its id
   * over in `initial`; a person who deleted the page in the meantime gets an
   * application with nothing filed under it, not an edge to a missing record.
   */
  const postingId = initial?.postingFileId
  const posting = postingId === undefined ? undefined : vault.files.find((f) => f.id === postingId)

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
    postingId: form.postingId.trim() || undefined,
    confirmationRef: form.confirmationRef.trim() || undefined,
  })

  /**
   * Reads what the posting asks for, now, so the record opens with an answer.
   *
   * The fit assessment is meant to happen when an application is created, and
   * creating one does not navigate to it — so without this the model call
   * starts when somebody eventually opens the record and they watch it run.
   * Started here, it overlaps whatever they do next and `fit-agent`'s cache,
   * which is keyed on the DOCUMENT, has the answer waiting.
   *
   * Deliberately fired against the URL rather than the new record: the snapshot
   * this closure holds was taken before the write, so the application is not in
   * it yet. The saved posting is — it was written before the form opened.
   *
   * Three reasons not to fire, and each is a real cost avoided rather than a
   * guard against a crash. No posting means there is nothing to read. No model
   * means the call cannot happen. No background means the assessment would
   * come out `not-measured` whatever the posting says, and spending somebody's
   * GPU — or their metered API key — to be told that is the one case where
   * waiting for them to ask is right.
   *
   * Nothing is awaited and nothing is shown. A failure here costs the
   * prewarming and nothing else: the panel runs the same read itself, reports
   * the same reason in place, and offers a retry.
   *
   * What it warms is no longer a module-level cache that dies with the tab —
   * the reading is stored on the posting — so a form filled in on Monday is
   * still warm on Tuesday, and the head start this buys is the whole first
   * visit rather than the first few minutes of one.
   */
  function prewarmFit(): void {
    // The page this form was started from, when there is one: then the join is
    // a fact rather than a match on the address, and it holds when the tab the
    // extension opened landed somewhere other than the address pasted.
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

  /** The refusal, said, and handed back for the form to put on its fields. */
  function refused(errors: readonly { message: string; field?: string }[]): SaveOutcome {
    const { message, fields } = refusalOf(errors)
    toast({ title: 'That did not save', description: message, tone: 'danger' })
    return { ok: false, message, fields }
  }

  /**
   * One user action: the record with its keywords and deadline in one call,
   * and the posting it came from filed under it — so the Undo covers both.
   *
   * `undoable` wraps the burst rather than the create alone, because reverting
   * only the record would have left the posting filed under an application
   * that no longer existed.
   */
  function create(): SaveOutcome {
    let failure: SaveOutcome | null = null
    const { value: created, restore } = undoable(() => {
      const fields = shared()
      let record: Application
      try {
        record = applications.add({
          ...fields,
          // The store's own default reads 'Draft created', which is a lie for
          // anything logged at a later stage — people add an interview they are
          // already booked for.
          lastAction:
            fields.stage === 'draft' ? undefined : `Added at ${STAGE_LABEL[fields.stage]}`,
          ...(form.deadline ? { deadline: form.deadline } : {}),
          keywords,
        })
      } catch (error) {
        // `add` throws on a refusal (its other callers rely on that); here the
        // form is open and the person can fix what was refused.
        failure = refused([
          { message: error instanceof Error ? error.message : String(error) },
        ])
        return null
      }
      /*
       * The posting "From link" saved, filed under what it became — inside the
       * same undo, because an Undo that took the application away and left the
       * page filed under it would be an edge to a record that no longer exists.
       * Added to whatever it is already filed under rather than replacing it:
       * `applicationIds` is a set, and the capture may have matched another
       * application by its address on the way in.
       */
      if (posting) {
        vault.updateFile(posting.id, {
          applicationIds: [...new Set([...posting.applicationIds, record.id])],
        })
      }
      // 'manual' because this is the dialog: somebody typed it in. The other
      // three sources in the vocabulary belong to the scout, the link importer
      // and the browser capture, and each reports its own.
      report('application_created', { source: 'manual' })
      return record
    })
    if (created === null) return failure ?? refused([])

    // After the transaction closes, not inside it. `undoableWith` measures the
    // journal either side of the write to decide what an Undo covers, and a
    // network call has no business inside that boundary — the closure is a
    // statement about which records moved.
    //
    // It DOES write now: the reading it fetches is stored on the posting, which
    // is the whole point of prewarming it. That write cannot land inside the
    // boundary whatever this line did — it arrives seconds later, long after the
    // journal has been measured — and it is a `system` tool, so it stays off the
    // undo ring by its own declaration rather than by where it was called.
    prewarmFit()

    toast({
      title: `${displayName(created)} added`,
      description: [
        form.deadline
          ? `Deadline ${shortDate(form.deadline)} is on the calendar.`
          : 'No deadline yet — add one and it shows up in This week.',
        posting ? 'The posting is filed under it.' : '',
      ]
        .filter(Boolean)
        .join(' '),
      action: restore ? { label: 'Undo', onClick: restore } : undefined,
    })
    return { ok: true, application: created }
  }

  function save(current: Application): SaveOutcome {
    const fields = shared()
    const moved = current.stage !== fields.stage
    const lastAction = moved ? `Moved to ${STAGE_LABEL[fields.stage]}` : 'Details edited'
    const deadline = deadlineWrite(form, initial)

    // One call: the fields, the keyword set and the deadline. There used to be
    // a `removeRecord(current.id)` beside the keyword write, sweeping the
    // bare-id spelling the seeded applications were keyed by; both spellings
    // now resolve to the same node (D14), so that call cleared the keywords
    // this one had just set.
    const { value: result, restore } = undoable(() =>
      applications.update(
        current.id,
        { ...fields, lastAction },
        { keywords, ...(deadline === undefined ? {} : { deadline }) },
      ),
    )
    // The tool's answer decides the toast. It used to be thrown away, so a
    // refused edit ("Cannot be blank.") closed the dialog under "Changes saved".
    if (!result.ok) return refused(result.errors)

    // Mirrors what `update` stamps, so the caller gets the record the store
    // now holds rather than one with a stale activity line.
    const next: Application = { ...current, ...fields, lastAction, daysAgo: 0 }
    const removed = deadline === null

    toast({
      title: 'Changes saved',
      description: removed
        ? `${displayName(next)} — its deadline is off the calendar.`
        : displayName(next),
      // The record's own fields can be typed back; a deadline deleted as a side
      // effect of clearing one field cannot. The save is one journal entry now,
      // so the Undo offered for that case puts the whole save back.
      action: removed && restore ? { label: 'Undo', onClick: restore } : undefined,
    })
    return { ok: true, application: next }
  }

  return { create, save }
}
