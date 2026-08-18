import { useCallback } from 'react'
import { ApplicationSheet } from '@/sheets/ApplicationSheet'
import type { ApplicationInitial } from '@/sheets/ApplicationSheet'
import { DraftSheet } from '@/sheets/DraftSheet'
import type { DraftSheetProps } from '@/sheets/DraftSheet'
import { TimelineItemSheet } from '@/sheets/TimelineItemSheet'
import type { TimelineItem } from '@jojo/service/data/timeline'
import { applicationDeadlineOf } from '@/lib/deadline'
import { useSheets } from '@/lib/sheets-context'
import { useApplications, useTimeline } from '@/lib/store-context'

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

type DraftProps = Pick<DraftSheetProps, 'itemId' | 'applicationId'>

/**
 * Renders whichever sheet is open. Mount once, above the navigator.
 *
 * Every name in `SheetName` has a branch here. That is the contract: a name
 * with no branch is an `open()` that type-checks and does nothing, which is
 * indistinguishable from a broken button.
 *
 * It sits OUTSIDE the navigator, so nothing reachable from here may call
 * `useNavigation`. None of the three does today — it is also why `DraftSheet`
 * has no "open in assistant" link.
 */
export function SheetHost() {
  const { current, close } = useSheets()
  const { get } = useApplications()
  const { forApplication } = useTimeline()

  // A sheet only ever reports `false` here — it closes itself, and the host
  // unmounts it rather than keeping a closed sheet mounted with stale props.
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

    // The deadline field has to be seeded from the very item the sheet will
    // write back to. It treats an unchanged field as "do not touch the
    // calendar", so a blank prefill on a record that already has a deadline
    // reads as "cleared" and deletes it — and any other date reads as a move.
    const deadline = record ? applicationDeadlineOf(forApplication(record.id))?.date : undefined
    const initial = record
      ? { ...record, ...props.initial, deadline: props.initial?.deadline ?? deadline ?? '' }
      : props.initial

    return (
      <ApplicationSheet
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
      <TimelineItemSheet
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
      <DraftSheet
        // Keyed on the record the draft is for, so opening a second reminder's
        // draft re-seeds the template rather than leaving the first one's
        // half-edited message in the editor.
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
