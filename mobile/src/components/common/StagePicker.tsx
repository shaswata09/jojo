import { useState } from 'react'
import { Pressable } from 'react-native'
import { Chip } from '@/components/ui/Chip'
import { MenuSheet } from '@/components/ui/Menu'
import { STAGES, STAGE_LABEL } from '@/data/seed'
import type { Stage } from '@/data/seed'
import { useColors } from '@/theme/theme-context'

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
  const c = useColors()
  const [open, setOpen] = useState(false)

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Stage of ${name}: ${STAGE_LABEL[value]}. Change stage`}
        onPress={() => setOpen(true)}
        hitSlop={6}
      >
        <Chip stage={value}>{STAGE_LABEL[value]}</Chip>
      </Pressable>

      <MenuSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Move to"
        description={name}
        actions={STAGES.map((s) => ({
          id: s.id,
          label: s.label,
          dotColor: c.stage[s.id],
          checked: s.id === value,
          onPress: () => onSelect(s.id),
        }))}
      />
    </>
  )
}
