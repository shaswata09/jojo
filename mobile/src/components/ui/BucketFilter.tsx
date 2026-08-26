import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Txt } from '@/components/ui/Text'
import { useColors } from '@/theme/theme-context'
import { radius, space } from '@/theme/tokens'

/**
 * "All · Overdue 3 · Today 1 · Upcoming 6" — a one-of-N filter carrying counts.
 *
 * The counts are scoped to whatever the caller is already showing, never to the
 * whole store. A chip promising six records above a list of four is the defect
 * this component exists to avoid, and it is only avoidable at the call site.
 */
export function BucketFilter<T extends string>({
  label,
  options,
  labels,
  counts,
  value,
  onChange,
  total,
  /** Hides a bucket that is empty. Off by default: a stable row is easier to aim at. */
  hideEmpty,
}: {
  label: string
  options: readonly T[]
  labels: Record<T, string>
  counts: Partial<Record<T, number>>
  value: T | 'all'
  onChange: (next: T | 'all') => void
  total: number
  hideEmpty?: boolean
}) {
  const c = useColors()
  const shown = hideEmpty ? options.filter((o) => (counts[o] ?? 0) > 0) : options

  const Pill = ({ id, text, count }: { id: T | 'all'; text: string; count: number }) => {
    const on = id === value
    return (
      <Pressable
        accessibilityRole="radio"
        /*
         * `checked`, not `selected`. Android reads a radio's state from
         * `accessibilityState.checked`, so with only `selected` TalkBack
         * announced EVERY option — including the active one — as "not
         * checked". Both are sent: iOS uses `selected`.
         */
        accessibilityState={{ selected: on, checked: on }}
        accessibilityLabel={`${text}, ${count}`}
        onPress={() => onChange(id)}
        style={[
          styles.pill,
          {
            backgroundColor: on ? c.accentSoft : c.well,
            borderColor: on ? c.accentBorder : c.hairline,
          },
        ]}
      >
        <Txt size="sm" weight={on ? 'medium' : 'regular'} tone={on ? 'accent' : 'secondary'}>
          {text}
        </Txt>
        <Txt size="xs" mono tone="muted">
          {count}
        </Txt>
      </Pressable>
    )
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
    >
      <View style={styles.row}>
        <Pill id="all" text="All" count={total} />
        {shown.map((o) => (
          <Pill key={o} id={o} text={labels[o]} count={counts[o] ?? 0} />
        ))}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space[2], paddingRight: space[3] },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1.5],
    minHeight: 36,
    paddingHorizontal: space[3],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
  },
})
