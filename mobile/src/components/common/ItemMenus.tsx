import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MonthPickerSheet } from '@/components/common/DateField'
import { MenuSheet } from '@/components/ui/Menu'
import type { MenuAction } from '@/components/ui/Menu'
import { addDays } from '@jojo/service/data/timeline'
import type { TimelineItem } from '@jojo/service/data/timeline'
import { SNOOZE_STEPS, anchorOf, snoozeLabel } from '@/lib/use-item-actions'
import type { ItemActions } from '@/lib/use-item-actions'
import { useDomain } from '@/i18n/domain'

/**
 * Push a dated row out by a step, or onto a day you choose.
 *
 * Built once and mounted by all three screens that list timeline items. Each
 * used to carry its own copy, and only Today's printed the date it was about to
 * write — so the same "A week" meant a visible Nov 3 in one place and an
 * unlabelled guess in another.
 *
 * "Pick a date…" is the mobile answer to the web's drag-a-chip-onto-another-day:
 * the same write, aimed with a month grid rather than with a 4px drop target.
 */
export function SnoozeMenu({
  item,
  actions,
  onClose,
}: {
  /** The row being pushed out, or null when the menu is closed. */
  item: TimelineItem | null
  actions: ItemActions
  onClose: () => void
}) {
  const { t } = useTranslation('components')
  const [picking, setPicking] = useState(false)
  const domain = useDomain()

  return (
    <>
      <MenuSheet
        open={item !== null && !picking}
        onClose={onClose}
        title={t('itemMenu.pushOutBy')}
        description={
          item
            ? t('itemMenu.currently', { title: item.title, date: domain.shortDate(item.date) })
            : undefined
        }
        actions={
          item
            ? [
                ...SNOOZE_STEPS.map((step) => ({
                  id: String(step.days),
                  label: snoozeLabel(item, step),
                  hint: domain.shortDate(addDays(anchorOf(item), step.days)),
                  onPress: () => actions.push(item, step.days),
                })),
                {
                  id: 'pick',
                  label: t('itemMenu.pickDate'),
                  icon: 'calendar' as const,
                  // Opens the grid instead of closing: `MenuSheet` closes itself
                  // before running an action, so the picker is raised from the
                  // parent's state rather than nested inside a dismissed sheet.
                  onPress: () => setPicking(true),
                },
              ]
            : []
        }
      />

      <MonthPickerSheet
        open={picking}
        onClose={() => {
          setPicking(false)
          onClose()
        }}
        value={item?.date ?? ''}
        onPick={(iso) => {
          if (item) actions.moveTo(item, iso)
          setPicking(false)
          onClose()
        }}
      />
    </>
  )
}

/**
 * The overflow menu a dated row carries, in the order the whole app uses:
 * **Edit · Duplicate · [Draft] · [Snooze] · Delete**, destructive last and red.
 *
 * Order is part of the contract. Before this, Today offered snooze-only, the
 * Vault offered a different four, and the Calendar offered a naked bin — which
 * is the thing the delete rule forbids: a delete has to cost a menu.
 */
export function ItemMenu({
  item,
  actions,
  onClose,
  onSnooze,
}: {
  item: TimelineItem | null
  actions: ItemActions
  onClose: () => void
  /** Raised by the caller so one snooze menu serves the whole screen. */
  onSnooze: (item: TimelineItem) => void
}) {
  const { t } = useTranslation(['components', 'common'])
  const domain = useDomain()
  const draftable = item ? DRAFTABLE.includes(item.kind) : false

  const menu: MenuAction[] = item
    ? [
        {
          id: 'edit',
          label: t('common:actions.edit'),
          icon: 'edit-2',
          onPress: () => actions.edit(item),
        },
        {
          id: 'duplicate',
          label: t('itemMenu.duplicate'),
          icon: 'copy',
          hint: t('itemMenu.duplicateHint'),
          onPress: () => actions.duplicate(item),
        },
        ...(draftable
          ? [
              {
                id: 'draft',
                label: t('itemMenu.draft'),
                icon: 'mail' as const,
                hint: t('itemMenu.draftHint'),
                onPress: () => actions.draft(item),
              },
            ]
          : []),
        {
          id: 'snooze',
          label: t('itemMenu.reschedule'),
          icon: 'clock',
          onPress: () => onSnooze(item),
        },
        {
          id: 'delete',
          label: t('common:actions.delete'),
          icon: 'trash-2',
          tone: 'danger',
          onPress: () => actions.destroy(item),
        },
      ]
    : []

  return (
    <MenuSheet
      open={item !== null}
      onClose={onClose}
      title={item?.title}
      description={item ? `${domain.kind(item.kind)} · ${domain.shortDate(item.date)}` : undefined}
      actions={menu}
    />
  )
}

/**
 * The kinds a message is the obvious next move on. Drafting against a campus
 * visit or a submission deadline makes no sense, and a row that offered it
 * everywhere would be four dead taps out of seven.
 */
const DRAFTABLE: readonly TimelineItem['kind'][] = ['interview', 'follow-up', 'call', 'visit']
