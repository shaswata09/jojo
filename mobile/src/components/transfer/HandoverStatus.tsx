import { View } from 'react-native'
import { Feather } from '@react-native-vector-icons/feather/static'
import { Txt } from '@/components/ui/Text'
import { handoverSentence, handoverStatus } from '@jojo/service/core/handover'
import { useKg } from '@jojo/service/react/kg-context'
import { useColors } from '@/theme/theme-context'
import { radius, space } from '@/theme/tokens'

/**
 * How old the copy on this phone is.
 *
 * The web component carries the argument. On a phone it reads the other way
 * round and matters more: this device only ever RECEIVES, so its records are as
 * old as the last handover and everything added on the computer since is
 * missing — which is exactly the fact a one-directional transfer never told
 * anybody, on the device most likely to be behind.
 */
export function HandoverStatus() {
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
        {handoverSentence(status)}
      </Txt>
    </View>
  )
}
