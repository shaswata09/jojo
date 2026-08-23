import { Pressable, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Txt } from '@/components/ui/Text'
import { displayName } from '@jojo/service/data/seed'
import { useApplications } from '@/lib/store-context'
import type { RootStackParamList } from '@/navigation/types'
import { space } from '@/theme/tokens'

/**
 * The jobs a vault record is filed under, each one a way in.
 *
 * `FILED_UNDER` and `ABOUT` are many-to-many, so every one of the four vault
 * lists had the same "one name, or nothing" line to turn into a row of names.
 * Four copies of a loop over `applicationIds` is four places for the deleted
 * application case to be got wrong, so it is one component and the lists ask it
 * for the whole set.
 *
 * The edge is cleared, not followed, when an application is deleted — but the
 * filter is still here, because a record read out of a store mid-repair can
 * name an id whose record has gone, and a row is not the place to find out.
 *
 * Renders nothing at all when the set is empty: an unfiled document should look
 * unfiled, not like a row with a gap where a link goes.
 */
export function FiledUnderLinks({ applicationIds }: { applicationIds: readonly string[] }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const { byId } = useApplications()

  const apps = applicationIds.map((id) => byId.get(id)).filter((a) => a !== undefined)
  if (apps.length === 0) return null

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space[2] }}>
      {apps.map((a) => (
        <Pressable
          key={a.id}
          accessibilityRole="link"
          onPress={() => navigation.navigate('ApplicationDetail', { id: a.id })}
        >
          <Txt size="xs" tone="info">
            {displayName(a)}
          </Txt>
        </Pressable>
      ))}
    </View>
  )
}
