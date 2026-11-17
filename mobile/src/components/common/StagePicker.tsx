import { useState } from 'react'
import { Pressable } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Chip } from '@/components/ui/Chip'
import { MenuSheet } from '@/components/ui/Menu'
import { STAGES } from '@jojo/service/data/seed'
import type { Stage } from '@jojo/service/data/seed'
import { slopFor } from '@/theme/tokens'
import { useColors } from '@/theme/theme-context'
import { useDomain } from '@/i18n/domain'

/**
 * The stage chip, as a control.
 *
 * On the web this is one of three ways to move a record — the third being a
 * drag across the board. There is no drag here: a 240px column dragged across
 * a 390px screen is a gesture that fights the horizontal scroll it lives in, so
 * this menu *is* the move, on the board and in the list alike. It was already
 * the keyboard route and the touch route there; taking the pointer route away
 * costs nothing a phone could have used.
 */
export function StagePicker({
  value,
  onSelect,
  name,
}: {
  value: Stage
  onSelect: (stage: Stage) => void
  /** The record's name, for the menu's title and the accessible label. */
  name: string
}) {
  const { t } = useTranslation('components')
  const domain = useDomain()
  const c = useColors()
  const [open, setOpen] = useState(false)

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('stagePicker.label', { name, stage: domain.stage(value) })}
        onPress={() => setOpen(true)}
        /*
         * The chip is about 24 points tall — `paddingVertical: 3` around a
         * 16-point line, plus its border — so 6 points of slop made a 36-point
         * target for the ONLY control that moves a record between stages.
         * `slopFor` takes it to 44, which is what a thumb needs.
         */
        hitSlop={slopFor(24)}
      >
        <Chip stage={value}>{domain.stage(value)}</Chip>
      </Pressable>

      <MenuSheet
        open={open}
        onClose={() => setOpen(false)}
        title={t('stagePicker.title')}
        description={name}
        actions={STAGES.map((s) => ({
          id: s.id,
          label: domain.stage(s.id),
          dotColor: c.stage[s.id],
          checked: s.id === value,
          onPress: () => onSelect(s.id),
        }))}
      />
    </>
  )
}
