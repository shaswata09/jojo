import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { Txt } from '@/components/ui/Text'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { radius, space } from '@/theme/tokens'

export type SegmentOption<T extends string> = { value: T; label: string }

/**
 * A segmented control — one of N, all visible.
 *
 * Scrolls horizontally rather than wrapping when the options do not fit. The
 * web version wraps, which is fine in a 1440px window and produces a two-line
 * control with a border drawn around the gap at 390px. A row that runs off the
 * edge at least says there is more of it.
 */
export function Segment<T extends string>({
  options,
  value,
  onChange,
  label,
  scroll,
  style,
}: {
  options: readonly SegmentOption<T>[]
  value: T
  onChange: (next: T) => void
  /** The group's accessible name. */
  label: string
  scroll?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const c = useColors()

  const track = (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={[styles.track, { backgroundColor: c.well, borderColor: c.hairline }, !scroll && style]}
    >
      {options.map((o) => {
        const on = o.value === value
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            /*
             * `checked`, not `selected`. Android reads a radio's state from
             * `accessibilityState.checked`, so with only `selected` TalkBack
             * announced EVERY option — including the active one — as "not
             * checked". Both are sent: iOS uses `selected`.
             */
            accessibilityState={{ selected: on, checked: on }}
            onPress={() => onChange(o.value)}
            style={[
              styles.option,
              !scroll && s.fill,
              on && { backgroundColor: c.panel, borderColor: c.accentBorder },
            ]}
          >
            <Txt
              size="sm"
              weight={on ? 'medium' : 'regular'}
              tone={on ? 'primary' : 'muted'}
              numberOfLines={1}
            >
              {o.label}
            </Txt>
          </Pressable>
        )
      })}
    </View>
  )

  if (!scroll) return track

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.scroller}
      style={style}
    >
      {track}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    padding: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
  option: {
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[3],
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  scroller: { flexGrow: 1 },
})
