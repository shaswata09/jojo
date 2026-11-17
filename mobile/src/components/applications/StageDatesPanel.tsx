import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { DateField } from '@/components/common/DateField'
import { Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { setStageDate, stageDateOf, stagesToDate } from '@jojo/service/core/stage-dates'
import { displayName } from '@jojo/service/data/seed'
import type { Application, Stage } from '@jojo/service/data/seed'
import { useUndoable } from '@jojo/service/react/undo'
import { useApplications } from '@/lib/store-context'
import { useToast } from '@/lib/toast-context'
import { space } from '@/theme/tokens'
import { useDomain } from '@/i18n/domain'

/**
 * When this application reached each stage — read, and corrected by hand.
 *
 * The phone's half of the web's `detail/StageDatesPanel.tsx`, and the same
 * rules, because they are core's: `stagesToDate` picks the rows (every stage
 * lived through, plus any that carries a date), `setStageDate` is the write
 * that overwrites, and a later move never undoes a date somebody typed. Every
 * row is editable for the web file's reason — a stamp is the day the board was
 * tidied, which is wrong whenever the record caught up with reality late.
 *
 * Clearing a date is allowed and means "I do not know when", and on a stage
 * the record has since moved back past it removes the row, because the date
 * was the only evidence the stage was reached. Undo brings both back, through
 * the journal, since the replaced value is gone from the screen as well.
 *
 * The one difference is the control: a month grid (`DateField`) rather than
 * a typed date, since a phone keyboard has no date row.
 */
export function StageDatesPanel({ application: a }: { application: Application }) {
  const { t } = useTranslation('screens')
  const domain = useDomain()
  const { update } = useApplications()
  const { toast } = useToast()
  const undoable = useUndoable()

  const rows = stagesToDate(a)

  const commit = (stage: Stage, picked: string) => {
    const on = picked === '' ? undefined : picked
    if (on === stageDateOf(a, stage)) return

    const { value, restore } = undoable(() => update(a.id, setStageDate(a, stage, on)))
    if (!value.ok) {
      toast({ title: value.errors[0]?.message ?? '', tone: 'danger' })
      return
    }
    toast({
      title: on
        ? t('detail.stageDates.dated', { stage: domain.stage(stage), date: domain.shortDate(on) })
        : t('detail.stageDates.undated', { stage: domain.stage(stage) }),
      description: on
        ? t('detail.stageDates.datedBody', { name: displayName(a), stage: domain.stage(stage) })
        : t('detail.stageDates.undatedBody', { name: displayName(a) }),
      // Hand-wired: this app's toast action says `onPress`, the service port's
      // `onClick`. `restore` already raises the superseded toast itself.
      ...(restore
        ? { action: { label: t('shared.undo'), onPress: () => void restore() } }
        : {}),
    })
  }

  return (
    <Panel>
      <PanelTitle
        hint={t('detail.stageDates.hint', {
          dated: rows.filter((stage) => stageDateOf(a, stage) !== undefined).length,
          total: rows.length,
        })}
      >
        {t('detail.stageDates.title')}
      </PanelTitle>

      <View style={{ gap: space[3] }}>
        {rows.map((stage) => (
          <DateField
            key={stage}
            // Where it is now, said once: the word tells you which row is
            // still being lived.
            label={
              stage === a.stage
                ? `${domain.stage(stage)} · ${t('detail.stageDates.now')}`
                : domain.stage(stage)
            }
            value={stageDateOf(a, stage) ?? ''}
            onChange={(iso) => commit(stage, iso)}
            quick={false}
            clearable
          />
        ))}
      </View>

      {/* Only where it is still news: on a record whose dates were all
          stamped, saying how they got there is noise. */}
      {rows.every((stage) => stageDateOf(a, stage) === undefined) ? (
        <Txt size="xs" tone="muted" style={{ marginTop: space[3] }}>
          {t('detail.stageDates.explain')}
        </Txt>
      ) : null}
    </Panel>
  )
}
