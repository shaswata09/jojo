import { View } from 'react-native'
import { Feather } from '@react-native-vector-icons/feather/static'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Columns } from '@/components/ui/Screen'
import { Divider, Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { DESTINATIONS } from '@/lib/destinations'
import type { RootStackParamList } from '@/navigation/types'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'
import { Pressable } from 'react-native'

/**
 * Every screen, what it is for, and a way in.
 *
 * The web guide has a page of these because a sidebar with fourteen entries
 * needs a legend. On a phone the case is stronger, not weaker: five destinations
 * are in the tab bar and the other twelve are behind More, so "where is the
 * thing that does X" is a genuinely harder question here than it is there.
 *
 * Built from `DESTINATIONS` rather than a second list written out by hand. The
 * same array feeds the Search screen's "Go to" group, so a screen added later
 * appears in both without anyone remembering to write it twice — and, more to
 * the point, cannot appear in one and be missing from the other.
 */
export function GuideScreens() {
  const c = useColors()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()

  const inTabs = DESTINATIONS.filter((d) => d.id.startsWith('d-') && TAB_IDS.includes(d.id))
  const inVault = DESTINATIONS.filter((d) => d.hint.startsWith('Vault ·'))
  const elsewhere = DESTINATIONS.filter(
    (d) => !TAB_IDS.includes(d.id) && !d.hint.startsWith('Vault ·'),
  )

  const group = (title: string, hint: string, rows: typeof DESTINATIONS) => (
    <Panel padded={false}>
      <View style={{ paddingHorizontal: space[4], paddingTop: space[3] }}>
        <PanelTitle hint={hint}>{title}</PanelTitle>
      </View>
      {rows.map((d, i) => (
        <View key={d.id}>
          {i > 0 ? <Divider /> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${d.label}`}
            onPress={() => d.go(navigation)}
            style={({ pressed }) => [
              s.row,
              {
                paddingHorizontal: space[4],
                paddingVertical: space[3],
                backgroundColor: pressed ? c.rowHover : 'transparent',
              },
            ]}
          >
            <Feather name={d.icon} size={16} color={c.text3} />
            <View style={s.fill}>
              <Txt size="sm" weight="medium">
                {d.label}
              </Txt>
              <Txt size="xs" tone="muted">
                {d.hint}
              </Txt>
            </View>
            <Feather name="chevron-right" size={16} color={c.text3} />
          </Pressable>
        </View>
      ))}
    </Panel>
  )

  return (
    <>
      <Panel>
        <Txt size="sm" tone="secondary">
          Every screen in the app, and the one sentence that says what it is for. Tapping a row
          opens it — this page is a way in as well as a legend.
        </Txt>
      </Panel>

      <Columns>
        {group('In the tab bar', 'always one tap away', inTabs)}
        {group('Inside the Vault', 'five tools, one tab', inVault)}
        {group('Behind More', 'the rest of jojo', elsewhere)}
      </Columns>
    </>
  )
}

/** The five the tab bar carries. Kept beside the grouping that uses it. */
const TAB_IDS = ['d-today', 'd-apps', 'd-cal', 'd-more']
