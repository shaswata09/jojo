import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import type { ViewProps, ViewStyle } from 'react-native'
import { Txt } from '@/components/ui/Text'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { radius, space } from '@/theme/tokens'

/**
 * The app's primary surface: opaque, hairline-bordered, lightly raised.
 *
 * Same contract as the web's `.surface` utility and `Panel` component. Depth is
 * a border plus a small shadow rather than a tint, so a panel reads the same
 * against the page in both themes.
 */
export function Panel({
  children,
  style,
  padded = true,
  ...rest
}: ViewProps & { children?: ReactNode; padded?: boolean }) {
  const c = useColors()
  return (
    <View
      {...rest}
      style={[
        styles.panel,
        { backgroundColor: c.panel, borderColor: c.hairline },
        padded && styles.panelPad,
        style,
      ]}
    >
      {children}
    </View>
  )
}
/**
 * A panel's heading, with an optional quiet hint beside it.
 *
 * The hint is where a count or a caveat goes — "8 open · 12 total", "as far as
 * each record shows". Keeping it in the title row rather than under it is what
 * stops a panel growing a second line of chrome before its first row of data.
 */
export function PanelTitle({
  children,
  hint,
  right,
  style,
}: {
  children: ReactNode
  hint?: ReactNode
  right?: ReactNode
  style?: ViewStyle
}) {
  return (
    <View style={[styles.titleRow, style]}>
      <View style={s.fill}>
        <Txt size="md" weight="medium">
          {children}
        </Txt>
        {hint ? (
          typeof hint === 'string' ? (
            <Txt size="xs" tone="muted" style={{ marginTop: 2 }}>
              {hint}
            </Txt>
          ) : (
            hint
          )
        ) : null}
      </View>
      {right ? <View style={styles.titleRight}>{right}</View> : null}
    </View>
  )
}

/** A divider between rows in a list. Hairline, in the theme's own colour. */
export function Divider({ style }: { style?: ViewStyle }) {
  const c = useColors()
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: c.hairline }, style]} />
}

/**
 * A list whose rows are separated rather than boxed.
 *
 * Boxing every row would put a border inside a border; the rule between them
 * is enough to say "these are peers", and it costs no vertical rhythm.
 */
export function RowList({ children }: { children: ReactNode[] }) {
  const items = children.filter(Boolean)
  return (
    <View>
      {items.map((child, i) => (
        <View key={i}>
          {i > 0 ? <Divider /> : null}
          {child}
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  panel: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  panelPad: { padding: space[4] },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space[3],
    marginBottom: space[3],
  },
  titleRight: { flexShrink: 0 },
})
