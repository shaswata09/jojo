import { intlLocale } from '@jojo/service/core/intl-locale'
import { GROUP_LOOSE } from '@jojo/service/core/graph-view'
import type { ClusterGroup, Folding, ViewGraph, ViewNode } from '@jojo/service/core/graph-view'
import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Icon } from '@/components/ui/Icon'
import { ShowMoreRows } from '@/components/ui/ShowMoreRows'
import { Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { GRAPH_NODE_TYPES, NODE_TYPE_LABEL, typeColor } from '@/lib/graph'
import type { Graph, GraphNode, GraphNodeType } from '@/lib/graph'
import { groupName } from '@/lib/graph-view'
import type { GroupDimension } from '@/lib/graph-view'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'
import { useGraphWords } from './use-graph-words'

const PAGE = 25

/**
 * The overview as a list: each group the canvas draws, in the same reading
 * order, opening onto its records — every one named with what is counted on
 * it, and selecting it as a tap on the canvas would.
 *
 * This is how TalkBack reaches the records of a picture with hundreds of dots
 * in it, and how anyone finds one by name. The canvas announces itself as one
 * summary and points here.
 */
export function GraphGroupList({
  viewGraph,
  folding,
  groups,
  by,
  selectedId,
  onSelect,
}: {
  viewGraph: ViewGraph
  folding: Folding
  groups: readonly ClusterGroup[]
  by: GroupDimension
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const c = useColors()
  const { t, language, byId, nameOf } = useGraphWords(viewGraph, folding)
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const [shown, setShown] = useState<Record<string, number>>({})

  return (
    <Panel>
      <PanelTitle hint={t('graph.view.groupsHint')}>{t('graph.view.groupsTitle')}</PanelTitle>
      <View style={{ marginTop: space[2] }}>
        {groups.map((group) => {
          const loose = group.key === GROUP_LOOSE
          const count = group.anchors || group.members.length
          const name = groupName(group.key, by, t)
          const label = t('graph.view.group.label', {
            name,
            // The number the canvas prints beside the name.
            records: t('graph.records', { count }),
          })
          const isOpen = open.has(group.key)
          const page = shown[group.key] ?? PAGE
          return (
            <View key={group.key}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={
                  loose ? { selected: selectedId === GROUP_LOOSE } : { expanded: isOpen }
                }
                onPress={() => {
                  if (loose) {
                    onSelect(selectedId === GROUP_LOOSE ? null : GROUP_LOOSE)
                    return
                  }
                  setOpen((current) => {
                    const next = new Set(current)
                    if (!next.delete(group.key)) next.add(group.key)
                    return next
                  })
                }}
                style={styles.groupRow}
              >
                <Icon
                  name={loose ? 'layers' : isOpen ? 'chevron-down' : 'chevron-right'}
                  size={14}
                  color={c.text3}
                />
                <Txt size="sm" weight="medium" style={s.fill} numberOfLines={1}>
                  {name}
                </Txt>
                <Txt size="xs" tone="muted" mono>
                  {count.toLocaleString(intlLocale(language))}
                </Txt>
              </Pressable>
              {isOpen ? (
                <View style={styles.members}>
                  {group.members.slice(0, page).map((id) => {
                    const node = byId.get(id)
                    return node ? (
                      <MemberRow
                        key={id}
                        node={node}
                        name={nameOf(node)}
                        folded={folding.folded.get(id)?.length ?? 0}
                        selected={selectedId === id}
                        onPress={() => onSelect(selectedId === id ? null : id)}
                      />
                    ) : null
                  })}
                  <ShowMoreRows
                    shown={Math.min(page, group.members.length)}
                    hidden={Math.max(0, group.members.length - page)}
                    onMore={() => setShown((current) => ({ ...current, [group.key]: page + PAGE }))}
                  />
                </View>
              ) : null}
            </View>
          )
        })}
      </View>
    </Panel>
  )
}

function MemberRow({
  node,
  name,
  folded,
  selected,
  onPress,
}: {
  node: ViewNode
  name: string
  folded: number
  selected: boolean
  onPress: () => void
}) {
  const c = useColors()
  const color = typeColor(node.type as GraphNodeType, c)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.memberRow, selected && { backgroundColor: c.accentSoft }]}
    >
      <View style={[styles.swatch, { backgroundColor: color, borderColor: color }]} />
      <Txt size="sm" style={s.fill} numberOfLines={1}>
        {node.label}
      </Txt>
      {folded > 0 ? (
        <Txt size="xs" tone="muted" mono>
          {`+${folded}`}
        </Txt>
      ) : null}
    </Pressable>
  )
}

/**
 * The records linked to nothing, as a list — what the overview's one counted
 * "Not linked to anything" item opens, in the place the detail panel goes.
 */
export function GraphLoosePanel({
  graph,
  ids,
  onSelect,
}: {
  graph: Graph
  ids: readonly string[]
  onSelect: (id: string) => void
}) {
  const c = useColors()
  const { t } = useTranslation('screens')
  const [shown, setShown] = useState(PAGE)

  const nodes = useMemo(() => {
    const rank = (n: GraphNode) => GRAPH_NODE_TYPES.indexOf(n.type)
    return ids
      .map((id) => graph.byId.get(id))
      .filter((n): n is GraphNode => n !== undefined)
      .sort((a, b) => rank(a) - rank(b) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
  }, [graph, ids])

  return (
    <Panel>
      <PanelTitle hint={t('graph.records', { count: nodes.length })}>
        {t('graph.view.group.loose')}
      </PanelTitle>
      <Txt size="xs" tone="muted" style={{ marginBottom: space[2] }}>
        {t('graph.view.looseHint')}
      </Txt>
      {nodes.slice(0, shown).map((node) => (
        <Pressable
          key={node.id}
          accessibilityRole="button"
          onPress={() => onSelect(node.id)}
          style={styles.memberRow}
        >
          <View
            style={[
              styles.swatch,
              { backgroundColor: typeColor(node.type, c), borderColor: typeColor(node.type, c) },
            ]}
          />
          <Txt size="sm" style={s.fill} numberOfLines={1}>
            {node.label}
          </Txt>
          <Txt size="xs" tone="muted">
            {NODE_TYPE_LABEL[node.type]}
          </Txt>
        </Pressable>
      ))}
      <ShowMoreRows
        shown={Math.min(shown, nodes.length)}
        hidden={Math.max(0, nodes.length - shown)}
        onMore={() => setShown((n) => n + PAGE)}
      />
    </Panel>
  )
}

const styles = StyleSheet.create({
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: 44 },
  members: { paddingStart: space[5], paddingBottom: space[2] },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: 44,
    paddingHorizontal: space[1],
    borderRadius: 6,
  },
  swatch: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5 },
})
