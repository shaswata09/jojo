import { View } from 'react-native'
import { Trans, useTranslation } from 'react-i18next'
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

/*
 * What each relationship joins, in the app's own words, is `graph.relShape.<REL>`
 * in the guide catalog — one entry per name in `GRAPH_RELS`.
 */

export function GuideGraph() {
  const { t } = useTranslation('guide')
  const c = useColors()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()

  return (
    <>
      <Panel>
        <Txt size="sm" tone="secondary">
          <Trans
            t={t}
            i18nKey="graph.intro"
            components={{ b: <Txt size="sm" weight="medium" /> }}
          />
        </Txt>
        <Button
          label={t('graph.open')}
          icon="share-2"
          variant="outline"
          onPress={() => navigation.navigate('Graph')}
          style={{ marginTop: space[3], alignSelf: 'flex-start' }}
        />
      </Panel>

      <Columns>
        <Panel>
          <PanelTitle hint={t('graph.kinds', { count: GRAPH_NODE_TYPES.length })}>
            {t('graph.nodes')}
          </PanelTitle>
          <Txt size="xs" tone="muted" style={{ marginBottom: space[3] }}>
            {t('graph.nodesIntro')}
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
          <PanelTitle hint={t('graph.kinds', { count: GRAPH_RELS.length })}>
            {t('graph.edges')}
          </PanelTitle>
          <Txt size="xs" tone="muted" style={{ marginBottom: space[3] }}>
            {t('graph.edgesIntro')}
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
                  {t(`graph.relShape.${r}`)}
                </Txt>
              </View>
            </View>
          ))}
        </Panel>

        <Panel style={{ borderColor: c.warningBorder }}>
          <PanelTitle>{t('graph.deleteTitle')}</PanelTitle>
          <Txt size="sm" tone="secondary">
            {t('graph.deleteBody')}
          </Txt>
        </Panel>
      </Columns>
    </>
  )
}
