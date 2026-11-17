import { useMemo } from 'react'
import { i18next } from '@/i18n/i18n'
import { addDays } from '@jojo/service/data/timeline'
import type { TimelineItem } from '@jojo/service/data/timeline'
import { TODAY } from '@/lib/today'
import { useLabels } from '@/lib/labels-context'
import { useSheets } from '@/lib/sheets-context'
import { useTimeline } from '@/lib/store-context'
import { useToast } from '@/lib/toast-context'
import { domain } from '@/i18n/domain'

/**
 * Where a snooze counts from.
 *
 * The store counts from today only when an item is already overdue; for
 * anything dated ahead it counts from that date. Mirrored here so a menu can
 * print the date it is about to write — change one and change the other, or the
 * label promises a Tuesday and the store writes a Thursday.
 */
export const anchorOf = (item: TimelineItem) => (item.date < TODAY ? TODAY : item.date)

/**
 * The snooze steps, spelled two ways.
 *
 * "Tomorrow" is a lie on a reminder due next Friday — it would land on the
 * Saturday. The `later` spelling is used whenever the anchor is not today,
 * which is the only way the label can never claim a date the store will not
 * write.
 */
export const SNOOZE_STEPS = [
  { days: 1, soon: 'snooze.soon1', later: 'snooze.later1' },
  { days: 3, soon: 'snooze.soon3', later: 'snooze.later3' },
  { days: 7, soon: 'snooze.soon7', later: 'snooze.later7' },
] as const

/** What a snooze step should be called for this item. */
export const snoozeLabel = (item: TimelineItem, step: (typeof SNOOZE_STEPS)[number]) =>
  i18next.t(`messages:${anchorOf(item) === TODAY ? step.soon : step.later}`)

/**
 * Everything a dated row can do to itself, with the toast each one owes.
 *
 * Three screens list timeline items — Today's owed-this-week, the Vault's
 * reminders and the Calendar's day list — and each had grown its own copy of
 * tick / snooze / delete, each with its own toast wording. They had already
 * drifted: the same completion was announced as "It leaves the deck and this
 * week" in one place and "It leaves this list and counts towards today" in
 * another, and only two of the three put the keywords back on an undone delete.
 *
 * One hook, so a row behaves the same whichever screen it is on and a new
 * action lands everywhere at once.
 *
 * Every write here is reversible and says so. The rule the app follows: anything
 * the store can restore gets an undo toast rather than a confirmation, because a
 * confirmation fires on the way out of the one path a user takes when they have
 * already decided.
 */
export function useItemActions() {
  const { get, add, update, remove, toggleDone, snooze, reschedule } = useTimeline()
  const { labelIdsOf, setRecord, removeRecord } = useLabels()
  const { open } = useSheets()
  const { toast } = useToast()

  return useMemo(() => {
    const t = (key: string, options?: Record<string, unknown>) =>
      i18next.t(`messages:itemActions.${key}`, options)
    const undo = i18next.t('common:actions.undo')
    /** Ticks or unticks, and says which way it went. */
    const complete = (item: TimelineItem) => {
      const wasDone = Boolean(item.completedOn)
      toggleDone(item.id)
      toast({
        title: wasDone
          ? t('reopened', { title: item.title })
          : t('completed', { title: item.title }),
        description: wasDone ? t('reopenedBody') : t('completedBody'),
        // Not a second toggle: by the time this is pressed the item may have
        // been changed elsewhere, and toggling again would flip the wrong way.
        action: {
          label: undo,
          onPress: () => update(item.id, { completedOn: item.completedOn ?? null }),
        },
      })
    }

    const push = (item: TimelineItem, days: number) => {
      const before = item.date
      snooze(item.id, days)
      toast({
        title: t('rescheduled', { title: item.title }),
        description: t('nowDue', { date: domain.shortDate(addDays(anchorOf(item), days)) }),
        // The date it came from is the one thing a second snooze cannot recover.
        action: { label: undo, onPress: () => reschedule(item.id, before) },
      })
    }

    /** A date the user picked, rather than a step. */
    const moveTo = (item: TimelineItem, iso: string) => {
      if (!iso || iso === item.date) return
      const before = item.date
      reschedule(item.id, iso)
      toast({
        title: t('movedTo', { date: domain.shortDate(iso) }),
        description: item.title,
        action: { label: undo, onPress: () => reschedule(item.id, before) },
      })
    }

    /**
     * The same date again, as a second record.
     *
     * Copies the keywords too: a duplicate that arrived untagged would be
     * filed nowhere, and re-tagging it by hand is the work the copy was
     * supposed to save.
     */
    const duplicate = (item: TimelineItem) => {
      const { id: _id, ...rest } = item
      const copy = add({ ...rest, title: t('copyTitle', { title: item.title }), completedOn: null })
      const keywords = labelIdsOf(item.id)
      if (keywords.length > 0) setRecord(copy.id, keywords)
      toast({
        title: t('added', { title: copy.title }),
        description: t('copyBody', { date: domain.shortDate(copy.date) }),
        action: {
          label: undo,
          onPress: () => {
            remove(copy.id)
            removeRecord(copy.id)
          },
        },
      })
      return copy
    }

    /**
     * A dated row is a cheap record — a title and a date, retyped in seconds —
     * so it goes on an undo toast rather than a confirmation. Its keywords go
     * with it and come back with it: the store's `remove` restores the item
     * only, and a record that returned stripped of its keywords is not an undo.
     */
    const destroy = (item: TimelineItem) => {
      const stashed = labelIdsOf(item.id)
      const { restore } = remove(item.id)
      removeRecord(item.id)
      toast({
        title: t('deleted', { title: item.title }),
        description: item.remind ? t('deletedReminder') : t('deletedEvent'),
        tone: 'danger',
        action: {
          label: undo,
          onPress: () => {
            restore()
            // Guarded, because `setRecord` with an empty list would file the
            // record as carrying no keywords rather than leaving it unmentioned.
            if (stashed.length > 0) setRecord(item.id, stashed)
          },
        },
      })
    }

    /** `mode` only picks which fields lead — it is one record either way. */
    const edit = (item: TimelineItem) =>
      open('timelineItem', { mode: item.remind ? 'reminder' : 'event', initial: item })

    const draft = (item: TimelineItem) => open('draft', { itemId: item.id })

    return { get, complete, push, moveTo, duplicate, destroy, edit, draft }
  }, [
    get,
    add,
    update,
    remove,
    toggleDone,
    snooze,
    reschedule,
    labelIdsOf,
    setRecord,
    removeRecord,
    open,
    toast,
  ])
}

export type ItemActions = ReturnType<typeof useItemActions>
