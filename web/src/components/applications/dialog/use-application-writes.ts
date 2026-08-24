import { DEADLINE_DETAIL, applicationDeadlineOf } from '@/components/applications/deadline'
import type { ApplicationInitial, FormState } from '@/components/applications/dialog/form-state'
import { STAGE_LABEL, displayName } from '@/data/seed'
import type { Application, RoleTag } from '@/data/seed'
import { shortDate } from '@/data/timeline'
import { useApplications } from '@jojo/service/react/use-applications'
import { useTimeline } from '@jojo/service/react/use-timeline'
import { report } from '@/lib/analytics'
// Imported, not redeclared. This file used to carry its own `deadlineUrgency`
// with the 7/21-day thresholds spelled a second time, twenty lines from a
// comment explaining that the seed's colours mix proximity with readiness. The
// tool layer's copy is the one the store writes through, so a drift here would
// have shown the user one colour on the form's item and another on everything
// the tools mint.
import { deadlineUrgency } from '@jojo/service/tools/support'
import { refKey } from '@/lib/ids'
import { useLabels } from '@/lib/labels-context'
import { useToast } from '@/lib/toast-context'
import { TODAY } from '@/lib/today'
import { useUndoable } from '@/lib/undo'

/**
 * Everything `ApplicationDialog` writes when Save is pressed, and nothing else.
 *
 * Kept apart from the form because the three writes here — the record, its
 * keywords, and the deadline timeline item — are the part with consequences
 * outside the dialog, and the comments below are all about which of them can be
 * undone together.
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
  const timeline = useTimeline()
  const { setRecord } = useLabels()
  const { toast } = useToast()
  const undoable = useUndoable()

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

  function mintDeadline(application: Application) {
    // Without this the first application anyone adds is invisible everywhere
    // that reads dates — the calendar, This week, the priority deck — and the
    // app looks like it lost the record.
    timeline.add({
      title: displayName(application),
      detail: DEADLINE_DETAIL,
      date: form.deadline,
      kind: 'deadline',
      urgency: deadlineUrgency(TODAY, form.deadline),
      applicationIds: [application.id],
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
      urgency: dateChanged ? deadlineUrgency(TODAY, form.deadline) : existing.urgency,
    })
    return null
  }

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
      // 'manual' because this is the dialog: somebody typed it in. The other
      // three sources in the vocabulary belong to the scout, the link importer
      // and the browser capture, and each reports its own.
      report('application_created', { source: 'manual' })
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

  return { create, save }
}
