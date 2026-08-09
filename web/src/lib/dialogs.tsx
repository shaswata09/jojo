import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ApplicationDialog } from '@/components/applications/ApplicationDialog'
import type { ApplicationInitial } from '@/components/applications/ApplicationDialog'
import { applicationDeadlineOf } from '@/components/applications/deadline'
import { DraftDialog } from '@/components/draft/DraftDialog'
import type { DraftDialogProps } from '@/components/draft/DraftDialog'
import { TimelineItemDialog } from '@/components/timeline/TimelineItemDialog'
import type { TimelineItem } from '@/data/timeline'
import { DialogsContext, useDialogs, useTriggerOriginTracking } from '@/lib/dialogs-context'
import type { DialogName, OpenDialog } from '@/lib/dialogs-context'
import { useApplications, useTimeline } from '@/lib/store-context'

/**
 * One place that knows which dialog is open.
 *
 * The same create dialogs are reachable from the topbar, the command palette,
 * empty states, the board's per-column buttons and a row's overflow menu. If
 * each of those owned an `open` boolean, the same dialog would be mounted five
 * times with five drifting sets of props — so entry points name a dialog and
 * the host mounts it, once.
 *
 * Exactly one dialog at a time. Stacking modals over a prototype is a trap:
 * escape becomes ambiguous, focus has to be handed back down a chain, and no
 * flow here is long enough to need it. Opening a second dialog replaces the
 * first rather than burying it.
 *
 * Session-only, like the rest of the app's state.
 */
export function DialogsProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<OpenDialog | null>(null)

  // Remembers the control a dialog was summoned from, so the panel can grow out
  // of it instead of out of the middle of the screen. Owned here rather than by
  // `DialogContent` so the listeners are installed once for the whole app —
  // and so the dialogs that never pass through this registry (the delete
  // confirmation, the stage transition, the palette) get an origin too.
  useTriggerOriginTracking()

  const open = useCallback((name: DialogName, props: Record<string, unknown> = {}) => {
    setCurrent({ name, props })
  }, [])

  const close = useCallback(() => setCurrent(null), [])

  const value = useMemo(() => ({ open, close, current }), [open, close, current])

  return <DialogsContext value={value}>{children}</DialogsContext>
}

/** What `open('application', …)` accepts. */
type ApplicationProps = {
  mode?: 'create' | 'edit'
  /**
   * Edit mode: which record. The host reads the application and its deadline
   * out of the store, so a call site does not have to — see below for why the
   * deadline in particular cannot be left to the caller.
   */
  id?: string
  /** Create mode: whatever is already known, e.g. from a pasted URL. */
  initial?: ApplicationInitial
}

/** What `open('timelineItem', …)` accepts. Pass an `initial` with an id to edit. */
type TimelineItemProps = {
  mode?: 'reminder' | 'event'
  initial?: Partial<TimelineItem>
}

/** What `open('draft', …)` accepts. Both are optional — a draft with neither is blank. */
type DraftProps = Pick<DraftDialogProps, 'itemId' | 'applicationId'>

/**
 * Renders whichever dialog is open. Mount it once, next to the router outlet.
 *
 * It is mounted at the root, OUTSIDE the router — so nothing reachable from
 * here may call `useNavigate`, `useParams` or `useSearchParams`. None of the
 * three dialogs below does today; keep it that way, or check the mount point in
 * main.tsx before adding one that does. It is also why `DraftDialog` disables
 * its "Open in assistant" button rather than linking to the route.
 *
 * Every name in `DialogName` has a branch here. That is the contract: a name
 * with no branch is an `open()` that type-checks and does nothing, which is
 * indistinguishable from a broken button.
 */
export function DialogHost() {
  const { current, close } = useDialogs()
  const { get } = useApplications()
  const { forApplication } = useTimeline()

  // A dialog only ever reports `false` here — it closes itself, and the host
  // unmounts it rather than keeping a closed dialog mounted with stale props.
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (!open) close()
    },
    [close],
  )

  if (!current) return null

  if (current.name === 'application') {
    const props = current.props as ApplicationProps
    const mode = props.mode ?? 'create'
    const record = props.id ? get(props.id) : undefined

    // The deadline field has to be seeded from the very item the dialog will
    // write back to. It treats an unchanged field as "do not touch the
    // calendar", so a blank prefill on a record that already has a deadline
    // reads as "cleared" and deletes it — and any other date reads as a move.
    const deadline = record ? applicationDeadlineOf(forApplication(record.id))?.date : undefined
    const initial = record
      ? { ...record, ...props.initial, deadline: props.initial?.deadline ?? deadline ?? '' }
      : props.initial

    return (
      <ApplicationDialog
        // Keyed so opening a second record while one is up re-seeds the form
        // rather than leaving the first record's values in the fields.
        key={`application:${props.id ?? 'new'}`}
        open
        onOpenChange={onOpenChange}
        mode={mode}
        initial={initial}
      />
    )
  }

  if (current.name === 'timelineItem') {
    const props = current.props as TimelineItemProps
    return (
      <TimelineItemDialog
        key={`timelineItem:${props.initial?.id ?? 'new'}`}
        open
        onOpenChange={onOpenChange}
        mode={props.mode ?? 'reminder'}
        initial={props.initial}
      />
    )
  }

  if (current.name === 'draft') {
    const props = current.props as DraftProps
    return (
      <DraftDialog
        // Keyed on the record the draft is for, so opening a second reminder's
        // draft re-seeds the template and the substituted text rather than
        // leaving the first one's half-edited message in the editor.
        key={`draft:${props.itemId ?? props.applicationId ?? 'new'}`}
        open
        onOpenChange={onOpenChange}
        itemId={props.itemId}
        applicationId={props.applicationId}
      />
    )
  }

  return null
}
