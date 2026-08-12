import { View } from 'react-native'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Columns } from '@/components/ui/Screen'
import { Divider, Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { GRAPH_NODE_TYPES, GRAPH_RELS, NODE_TYPE_LABEL, REL_LABEL } from '@/lib/graph'
import { typeColor } from '@/lib/graph'
import type { RootStackParamList } from '@/navigation/types'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

/**
 * What the records actually are, underneath the seven lists.
 *
 * The lists are a presentation. Underneath, every record is a node and every
 * connection between two of them is an edge with a name — which is why the
 * Graph screen can answer "applications with nothing dated against them" and
 * the Applications list, however it is sorted, never can.
 *
 * This page is the legend for that: the ten kinds of node, the six kinds of
 * link, and the one rule about deleting that follows from both. The web guide
 * draws diagrams here; the equivalent on a phone is the live graph one tap
 * away, so this page points at it rather than illustrating it twice.
 */

/** What each relationship joins, in the app's own words. */
const REL_SHAPE: Record<(typeof GRAPH_RELS)[number], string> = {
  AT: 'Application → Employer',
  IS: 'Application → Role',
  ABOUT: 'Date or reminder → Application',
  FILED_UNDER: 'File, link or snippet → Application',
  TAGS: 'Keyword → any record',
  FROM: 'Application → Saved posting or match',
}

export function GuideGraph() {
  const c = useColors()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()

  return (
    <>
      <Panel>
        <Txt size="sm" tone="secondary">
          Every list in this app is a view over one set of records. A record is a{' '}
          <Txt size="sm" weight="medium">
            node
          </Txt>
          ; a connection between two records is an{' '}
          <Txt size="sm" weight="medium">
            edge
          </Txt>{' '}
          with a name. That is the whole model, and it is why a question that crosses two lists is
          answerable at all.
        </Txt>
        <Button
          label="Open the graph"
          icon="share-2"
          variant="outline"
          onPress={() => navigation.navigate('Graph')}
          style={{ marginTop: space[3], alignSelf: 'flex-start' }}
        />
      </Panel>

      <Columns>
        <Panel>
          <PanelTitle hint={`${GRAPH_NODE_TYPES.length} kinds`}>Nodes</PanelTitle>
          <Txt size="xs" tone="muted" style={{ marginBottom: space[3] }}>
            A node per record, plus three that exist only as connections — an employer, a role and a
            keyword are each a node so that everything filed under one can be found from it.
          </Txt>
          <View style={{ gap: space[2] }}>
            {GRAPH_NODE_TYPES.map((t) => (
              <View key={t} style={s.row}>
                <View
                  style={{
                    width: 11,
                    height: 11,
                    borderRadius: 3,
                    backgroundColor: typeColor(t, c),
                  }}
                />
                <Txt size="sm" style={s.fill}>
                  {NODE_TYPE_LABEL[t]}
                </Txt>
              </View>
            ))}
          </View>
        </Panel>

        <Panel>
          <PanelTitle hint={`${GRAPH_RELS.length} kinds`}>Edges</PanelTitle>
          <Txt size="xs" tone="muted" style={{ marginBottom: space[3] }}>
            Each has a direction and a name. The name is what the Graph screen&apos;s question
            builder puts in its middle row.
          </Txt>
          {GRAPH_RELS.map((r, i) => (
            <View key={r}>
              {i > 0 ? <Divider /> : null}
              <View style={{ paddingVertical: space[2] }}>
                <View style={s.row}>
                  <Chip size="sm" tone="gray">
                    {r}
                  </Chip>
                  <Txt size="sm" style={s.fill}>
                    {REL_LABEL[r]}
                  </Txt>
                </View>
                <Txt size="xs" tone="muted" style={{ marginTop: space[1] }}>
                  {REL_SHAPE[r]}
                </Txt>
              </View>
            </View>
          ))}
        </Panel>

        <Panel style={{ borderColor: c.warningBorder }}>
          <PanelTitle>Deleting unlinks, it does not cascade</PanelTitle>
          <Txt size="sm" tone="secondary">
            Removing an application removes that node and the edges touching it. The reminders,
            files and saved postings that were filed under it stay — they are their own records, and
            they survive with nothing pointing at them. Every delete in the app says this, and the
            Graph screen&apos;s question builder is where you find what came loose: ask for files
            that do not have a link to an application.
          </Txt>
        </Panel>
      </Columns>
    </>
  )
}
