import { Pressable, View } from 'react-native'
import { Feather } from '@react-native-vector-icons/feather/static'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { EmptyState } from '@/components/ui/EmptyState'
import { Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { useVault } from '@/lib/store-context'
import { useThreads } from '@jojo/service/react/use-threads'
import type { FeatherName } from '@/lib/timeline-visuals'
import type { RootStackParamList, VaultTool } from '@/navigation/types'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

/**
 * Everything filed under this application.
 *
 * The three vault collections have carried an application since the graph
 * landed, and the delete confirmation on this very screen counted them — "4
 * saved items will be kept" — so the screen knew what was attached and showed
 * none of it. Filing a document under a job and then finding no trace of it on
 * the job is the shape of bug that makes people stop filing.
 *
 * That field is a LIST now — `FILED_UNDER` is `fromCardinality: 'many'` — so
 * one CV appears on every application it was sent to rather than on whichever
 * one displaced the others. Nothing here changed for it: the filter lives in
 * `forApplication`, which is the point of having the selector.
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
  // People arrive on the same `FILED_UNDER` edge a CV does, so they belong on
  // the panel headed "everything filed here" rather than on one of their own.
  { key: 'people', tool: 'people', label: 'People', icon: 'user' },
] as const satisfies readonly {
  key: 'files' | 'links' | 'snippets' | 'people'
  tool: VaultTool
  label: string
  icon: FeatherName
}[]

export function FiledPanel({ applicationId }: { applicationId: string }) {
  const c = useColors()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const { forApplication } = useVault()
  const { threads } = useThreads()
  const filed = forApplication(applicationId)

  /**
   * Conversations filed here, listed beside the documents.
   *
   * They arrive on the same `FILED_UNDER` edge a document does, which is why
   * they belong on this panel rather than one of their own: a panel headed
   * "everything filed here" that quietly left one kind out would make the filing
   * look like it had not worked.
   */
  const conversations = threads.filter((t) => t.applicationId === applicationId)

  const total =
    filed.files.length +
    filed.links.length +
    filed.snippets.length +
    filed.people.length +
    conversations.length

  return (
    <Panel>
      <PanelTitle hint={total > 0 ? `${total} filed here` : undefined}>From the Vault</PanelTitle>

      {total === 0 ? (
        <EmptyState
          icon="archive"
          title="Nothing filed under this yet"
          description="Documents, links, snippets and people can each be filed under as many jobs as they went to. File one under this job — from its row menu in the Vault — and it shows up here."
        />
      ) : (
        <View style={{ gap: space[4] }}>
          {conversations.length > 0 ? (
            <View>
              <View style={[s.row, { marginBottom: space[1.5] }]}>
                <Feather name="message-square" size={13} color={c.text3} />
                <Txt size="xs" tone="muted">
                  Conversations
                </Txt>
                <Txt size="xs" tone="muted" mono>
                  {conversations.length}
                </Txt>
              </View>
              {conversations.map((t) => (
                <Pressable
                  key={t.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${t.title} in the Assistant`}
                  onPress={() => navigation.navigate('Assistant')}
                  style={({ pressed }) => [
                    s.row,
                    {
                      minHeight: 36,
                      paddingHorizontal: space[1],
                      backgroundColor: pressed ? c.rowHover : 'transparent',
                    },
                  ]}
                >
                  <Txt size="sm" numberOfLines={1} style={s.fill}>
                    {t.title}
                  </Txt>
                  <Txt size="xs" tone="muted" mono>
                    {t.entries.filter((e) => e.kind === 'you').length}
                  </Txt>
                </Pressable>
              ))}
            </View>
          ) : null}

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
                    <Txt size="sm" style={s.fill} numberOfLines={1} mono={section.key === 'files'}>
                      {'name' in row ? row.name : row.title}
                    </Txt>
                    {/* The one word saying which of its own lists it sits in.
                        Read here rather than declared in SECTIONS because it is
                        a different field on each of the four shapes — and on a
                        person it can be absent, since a name is the only thing
                        they are required to have. */}
                    <Txt size="xs" tone="muted" numberOfLines={1}>
                      {'bucket' in row
                        ? row.bucket
                        : 'category' in row
                          ? row.category
                          : 'tag' in row
                            ? row.tag
                            : row.role}
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
