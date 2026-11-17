import { View } from 'react-native'
import { Feather } from '@react-native-vector-icons/feather/static'
import { Txt } from '@/components/ui/Text'
import { handoverStatus } from '@jojo/service/core/handover'
import { useKg } from '@jojo/service/react/kg-context'
import { useDomain } from '@/i18n/domain'
import { useColors } from '@/theme/theme-context'
import { radius, space } from '@/theme/tokens'

/**
 * How old the copy on this phone is.
 *
 * The web component carries the argument. On a phone it matters more: a phone
 * is where records get added on the move, and whichever way the last transfer
 * went, everything added on either device since is missing from the other —
 * the fact a replace-not-merge transfer never told anybody.
 */
export function HandoverStatus() {
  // Subscribes to the language, so the sentence re-renders when it changes.
  const domain = useDomain()
  const { repo } = useKg()
  const c = useColors()

  const status = handoverStatus(repo.meta.handoverAt, repo.audit, new Date().toISOString())

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: space[2],
        backgroundColor: c.well,
        borderColor: c.hairline,
        borderWidth: 1,
        borderRadius: radius.md,
        paddingHorizontal: space[3],
        paddingVertical: space[2.5],
      }}
    >
      <Feather
        name="refresh-ccw"
        size={13}
        color={status.state === 'drifted' ? c.warning : c.text3}
        style={{ marginTop: 2 }}
      />
      <Txt size="xs" tone="secondary" style={{ flex: 1 }}>
        {domain.handover(status)}
      </Txt>
    </View>
  )
}
