import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Txt } from '@/components/ui/Text'
import type { FeatherName } from '@/lib/timeline-visuals'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

/**
 * What a panel says when it has nothing to show.
 *
 * The rule the web app calls the empty-state law: never render a titled panel
 * wrapped around nothing, and never invent a figure to fill it. Say what would
 * fill it, and leave something to press.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  compact,
}: {
  icon?: FeatherName
  title: string
  description?: string
  action?: ReactNode
  compact?: boolean
}) {
  const c = useColors()
  return (
    <View style={[styles.root, compact && styles.compact]}>
      {icon ? (
        <View style={[styles.badge, { backgroundColor: c.well, borderColor: c.hairline }]}>
          <Feather name={icon} size={20} color={c.text3} />
        </View>
      ) : null}
      <Txt size="base" weight="medium" center>
        {title}
      </Txt>
      {description ? (
        <Txt size="sm" tone="muted" center style={styles.description}>
          {description}
        </Txt>
      ) : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', paddingVertical: space[8], paddingHorizontal: space[2] },
  compact: { paddingVertical: space[5] },
  badge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: space[3],
  },
  description: { marginTop: space[1.5], maxWidth: 340 },
  action: { marginTop: space[4], flexDirection: 'row', gap: space[2], flexWrap: 'wrap' },
})
