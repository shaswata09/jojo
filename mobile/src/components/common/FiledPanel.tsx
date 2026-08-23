import { Pressable, View } from 'react-native'
import { Feather } from '@react-native-vector-icons/feather/static'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { EmptyState } from '@/components/ui/EmptyState'
import { Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { useVault } from '@/lib/store-context'
import type { FeatherName } from '@/lib/timeline-visuals'
import type { RootStackParamList, VaultTool } from '@/navigation/types'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

/**
 * Everything filed under this application.
 *
 * The three vault collections have carried an `applicationId` since the graph
 * landed, and the delete confirmation on this very screen counted them — "4
 * saved items will be kept" — so the screen knew what was attached and showed
 * none of it. Filing a document under a job and then finding no trace of it on
 * the job is the shape of bug that makes people stop filing.
 *
 * Three sections rather than one merged list: a link opens a URL, a file opens
 * a document and a snippet is text to copy. They are different rows going to
 * different places, and merging them would mean re-splitting them to render.
 *
 * The selector is `useVault().forApplication`, shared with the web app, so both
 * agree on what "filed under" means rather than each writing the filter.
 */

const SECTIONS = [
  { key: 'files', tool: 'files', label: 'Files', icon: 'file-text' },
  { key: 'links', tool: 'links', label: 'Links', icon: 'link-2' },
  { key: 'snippets', tool: 'snippets', label: 'Snippets', icon: 'scissors' },
] as const satisfies readonly {
  key: 'files' | 'links' | 'snippets'
  tool: VaultTool
  label: string
  icon: FeatherName
}[]

export function FiledPanel({ applicationId }: { applicationId: string }) {
  const c = useColors()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const { forApplication } = useVault()
  const filed = forApplication(applicationId)

  const total = filed.files.length + filed.links.length + filed.snippets.length

  return (
    <Panel>
      <PanelTitle hint={total > 0 ? `${total} filed here` : undefined}>From the Vault</PanelTitle>

      {total === 0 ? (
        <EmptyState
          icon="archive"
          title="Nothing filed under this yet"
          description="Documents, links and snippets each take one application. File one under this job — from its row menu in the Vault — and it shows up here."
        />
      ) : (
        <View style={{ gap: space[4] }}>
          {SECTIONS.map((section) => {
            const rows = filed[section.key]
            if (rows.length === 0) return null
            return (
              <View key={section.key}>
                <View style={[s.row, { marginBottom: space[1.5] }]}>
                  <Feather name={section.icon} size={13} color={c.text3} />
                  <Txt size="xs" tone="muted">
                    {section.label}
                  </Txt>
                  <Txt size="xs" tone="muted" mono>
                    {rows.length}
                  </Txt>
                </View>

                {rows.map((row) => (
                  <Pressable
                    key={row.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${'name' in row ? row.name : row.title} in the Vault`}
                    // `focus` is what makes the Vault scroll to the row and
                    // light it — the same arrival the calendar already uses, so
                    // the highlight means one thing across the app.
                    onPress={() =>
                      navigation.navigate('Tabs', {
                        screen: 'Vault',
                        params: { tool: section.tool, focus: row.id },
                      })
                    }
                    style={({ pressed }) => [
                      s.row,
                      {
                        minHeight: 36,
                        paddingHorizontal: space[1],
                        backgroundColor: pressed ? c.rowHover : 'transparent',
                      },
                    ]}
                  >
                    <Txt
                      size="sm"
                      style={s.fill}
                      numberOfLines={1}
                      mono={section.key === 'files'}
                    >
                      {'name' in row ? row.name : row.title}
                    </Txt>
                    {/* The one word saying which of its own lists it sits in.
                        Read here rather than declared in SECTIONS because it is
                        a different field on each of the three shapes. */}
                    <Txt size="xs" tone="muted" numberOfLines={1}>
                      {'bucket' in row ? row.bucket : 'category' in row ? row.category : row.tag}
                    </Txt>
                  </Pressable>
                ))}
              </View>
            )
          })}
        </View>
      )}
    </Panel>
  )
}
