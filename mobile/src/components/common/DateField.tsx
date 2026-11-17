import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TODAY, TODAY_PARTS } from '@/lib/today'
import { Pressable, StyleSheet, View } from 'react-native'
import { Feather } from '@react-native-vector-icons/feather/static'
import { Button, IconButton } from '@/components/ui/Button'
import { FormField } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import { Txt } from '@/components/ui/Text'
import { WEEKDAYS, buildMonth, stepMonth } from '@jojo/service/core/calendar'
import { addDays, isoOf, partsOf } from '@jojo/service/data/timeline'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { radius, space } from '@/theme/tokens'
import { useDomain } from '@/i18n/domain'
import { Icon } from '@/components/ui/Icon'

/**
 * A date, picked from a month rather than typed.
 *
 * The web app uses `<input type="date">`, which the browser renders as a native
 * picker and degrades to a text box where it does not. There is no equivalent
 * primitive here and no reason to want one: a phone has the room for a real
 * month grid, and typing '2026-11-01' on a keyboard with no date row is the
 * worst way to answer this question.
 *
 * The picker opens on the seed's pinned today, not the wall clock's. Every
 * bucket and countdown in the app is measured against `TODAY` (2026-10-12), so
 * a real date here would land years past the seeded data — filed as overdue for
 * a month the calendar never scrolls to.
 */
export function DateField({
  label,
  value,
  onChange,
  hint,
  error,
  required,
  /** Today · Tomorrow · In 7 days, in the app's one relative vocabulary. */
  quick = true,
  clearable,
}: {
  label: string
  value: string
  onChange: (iso: string) => void
  hint?: string
  error?: string
  required?: boolean
  quick?: boolean
  clearable?: boolean
}) {
  const domain = useDomain()
  const { t } = useTranslation(['components', 'common'])
  const c = useColors()
  const [open, setOpen] = useState(false)

  const quickDates = [
    { label: t('date.today'), iso: TODAY },
    { label: t('date.tomorrow'), iso: addDays(TODAY, 1) },
    { label: t('date.inSevenDays'), iso: addDays(TODAY, 7) },
  ]

  return (
    <FormField label={label} hint={hint} error={error} required={required}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('date.triggerLabel', {
          label,
          value: value ? domain.shortDate(value) : t('date.notSet'),
        })}
        onPress={() => setOpen(true)}
        style={[
          styles.trigger,
          {
            backgroundColor: c.well,
            borderColor: error ? c.danger : c.hairlineStrong,
          },
        ]}
      >
        <Feather name="calendar" size={16} color={c.text3} />
        <Txt size="base" tone={value ? 'primary' : 'muted'} style={s.fill}>
          {value ? `${domain.shortDate(value)} · ${value}` : t('date.pick')}
        </Txt>
        {clearable && value ? (
          <IconButton
            icon="x"
            label={t('common:actions.clearNamed', { name: label })}
            size={32}
            onPress={() => onChange('')}
          />
        ) : (
          <Icon name="chevron-right" size={16} color={c.text3} />
        )}
      </Pressable>

      {quick ? (
        <View style={styles.quickRow}>
          {quickDates.map((q) => {
            const on = value === q.iso
            return (
              <Pressable
                key={q.label}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => onChange(q.iso)}
                style={[
                  styles.quickChip,
                  {
                    backgroundColor: on ? c.accentSoft : c.well,
                    borderColor: on ? c.accentBorder : c.hairline,
                  },
                ]}
              >
                <Txt
                  size="sm"
                  tone={on ? 'accent' : 'secondary'}
                  weight={on ? 'medium' : 'regular'}
                >
                  {q.label}
                </Txt>
              </Pressable>
            )
          })}
        </View>
      ) : null}

      <MonthPickerSheet
        open={open}
        onClose={() => setOpen(false)}
        value={value || TODAY}
        onPick={(iso) => {
          onChange(iso)
          setOpen(false)
        }}
      />
    </FormField>
  )
}

/** The month grid, on its own, so the calendar screen can reuse it. */
export function MonthPickerSheet({
  open,
  onClose,
  value,
  onPick,
}: {
  open: boolean
  onClose: () => void
  value: string
  onPick: (iso: string) => void
}) {
  const { t } = useTranslation('components')
  const domain = useDomain()
  const c = useColors()
  const start = partsOf(value)
  const [view, setView] = useState({ year: start.y, month: start.m })

  // Reopening should start from the value the field is holding, not from
  // wherever the last browse left off.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setView({ year: start.y, month: start.m })
  }

  // Third argument, and the compiler will not miss it if it goes — see the note
  // at the same call in `screens/CalendarScreen.tsx`. Without it the date
  // picker draws a month with no today marker.
  const month = buildMonth(view.year, view.month, TODAY_PARTS)
  // Not `month.label`: that is core's English, and this reads the language on screen.
  const monthName = domain.month(month.month)
  const cells: (number | null)[] = [
    ...Array.from({ length: month.startsOn }, () => null),
    ...Array.from({ length: month.days }, (_, i) => i + 1),
  ]

  return (
    <Sheet open={open} onClose={onClose} title={t('date.pick')}>
      <View style={styles.monthHeader}>
        <IconButton
          icon="chevron-left"
          label={t('date.previousMonth')}
          onPress={() => setView(stepMonth(view.year, view.month, -1))}
        />
        <Txt size="md" weight="medium">
          {monthName}{' '}
          <Txt size="md" tone="muted">
            {month.year}
          </Txt>
        </Txt>
        <IconButton
          icon="chevron-right"
          label={t('date.nextMonth')}
          onPress={() => setView(stepMonth(view.year, view.month, 1))}
        />
      </View>

      <View style={styles.weekdays}>
        {WEEKDAYS.map((d, i) => (
          <Txt key={d} size="xs" tone="muted" center style={styles.cell}>
            {domain.weekdayNarrow(i)}
          </Txt>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((day, i) => {
          if (day === null) return <View key={`blank-${i}`} style={styles.cell} />
          const iso = isoOf(view.year, view.month, day)
          const selected = iso === value
          const isToday =
            view.year === TODAY_PARTS.year &&
            view.month === TODAY_PARTS.month &&
            day === TODAY_PARTS.day

          return (
            <Pressable
              key={day}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${monthName} ${day}`}
              onPress={() => onPick(iso)}
              style={styles.cell}
            >
              <View
                style={[
                  styles.dayDot,
                  selected && { backgroundColor: c.accent },
                  !selected && isToday && { borderWidth: 1.5, borderColor: c.accentBorder },
                ]}
              >
                <Txt
                  size="sm"
                  weight={selected || isToday ? 'medium' : 'regular'}
                  color={selected ? c.accentFg : isToday ? c.accent : c.text2}
                >
                  {day}
                </Txt>
              </View>
            </Pressable>
          )
        })}
      </View>

      <View style={styles.monthFooter}>
        <Button
          label={t('date.backTo', { month: domain.month(TODAY_PARTS.month) })}
          variant="outline"
          size="md"
          onPress={() => setView({ year: TODAY_PARTS.year, month: TODAY_PARTS.month })}
        />
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    height: 44,
    paddingHorizontal: space[3],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
  quickRow: { flexDirection: 'row', gap: space[2], marginTop: space[1] },
  quickChip: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: space[3],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
  },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space[2],
  },
  weekdays: { flexDirection: 'row' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 3 },
  dayDot: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthFooter: { marginTop: space[3], alignItems: 'center', paddingBottom: space[2] },
})
