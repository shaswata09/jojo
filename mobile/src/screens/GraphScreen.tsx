import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native'
import Svg, { Circle, Line } from 'react-native-svg'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { Screen } from '@/components/ui/Screen'
import { Divider, Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import {
  GRAPH_NODE_TYPES,
  NODE_TYPE_LABEL,
  QUERY_EXAMPLES,
  REL_LABEL,
  buildGraph,
  incidentEdges,
  otherEnd,
} from '@/lib/graph'
import type { GraphNode, GraphNodeType } from '@/lib/graph'
import { useLabels } from '@/lib/labels-context'
import { useApplications, useScout, useTimeline, useVault } from '@/lib/store-context'
import type { RootStackParamList } from '@/navigation/types'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import type { Palette } from '@/theme/tokens'
import { radius, space } from '@/theme/tokens'

/**
 * A colour per node type.
 *
 * Drawn from the chart-series namespace rather than the status one, so a red
 * node is never ambiguous between "overdue" and "type 4". Ten types over five
 * series means two types share a hue; they are ordered so the pairs are never
 * adjacent in the legend and never joined by an edge in practice.
 */
function typeColor(type: GraphNodeType, c: Palette) {
  const map: Record<GraphNodeType, string> = {
    application: c.series[0],
    org: c.series[3],
    role: c.series[4],
    item: c.series[2],
    file: c.series[1],
    link: c.info,
    snippet: c.series[4],
    posting: c.series[1],
    match: c.series[3],
    keyword: c.text3,
  }
  return map[type]
}

export function GraphScreen() {
  const c = useColors()
  const { width } = useWindowDimensions()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()

  const { all: applications } = useApplications()
  const { all: timeline } = useTimeline()
  const { links, files, snippets } = useVault()
  const { matches, postings } = useScout()
  const { labelsOf } = useLabels()

  const graph = useMemo(
    () =>
      buildGraph({ applications, timeline, links, files, snippets, postings, matches, labelsOf }),
    [applications, timeline, links, files, snippets, postings, matches, labelsOf],
  )

  const [hidden, setHidden] = useState<ReadonlySet<GraphNodeType>>(() => new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [queryId, setQueryId] = useState<string | null>(null)

  const counts = useMemo(() => {
    const map = new Map<GraphNodeType, number>()
    for (const n of graph.nodes) map.set(n.type, (map.get(n.type) ?? 0) + 1)
    return map
  }, [graph])

  const visible = useMemo(() => graph.nodes.filter((n) => !hidden.has(n.type)), [graph, hidden])

  /**
   * Laid out by type, not by force.
   *
   * Each type gets a ring and its nodes are spread around it. A real force
   * simulation on a 390pt canvas with 120 nodes settles into an unreadable
   * hairball and costs a frame budget a phone would rather spend on scrolling —
   * whereas grouping by type answers the question this preview is here to
   * answer ("what kinds of thing are in here, and what joins them") directly.
   */
  const size = Math.min(width - space[3] * 2 - space[4] * 2, 340)
  const layout = useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>()
    const shown = GRAPH_NODE_TYPES.filter((t) => !hidden.has(t) && (counts.get(t) ?? 0) > 0)
    const cx = size / 2
    const cy = size / 2
    const outer = size / 2 - 10

    /**
     * Each ring is given the radius its own population needs.
     *
     * Spacing the rings evenly is the obvious version and the wrong one: the
     * innermost ring gets the smallest circumference and there is no reason the
     * type that lands there has the fewest nodes. With twelve applications on a
     * 17pt radius the whole group collapsed into a single blob at the centre.
     * Solving for arc length first, then scaling the lot to fit, keeps every
     * ring legible whichever order the types come in.
     */
    const MIN_ARC = 13
    const radii: number[] = []
    let previous = 0
    for (const type of shown) {
      const count = visible.filter((n) => n.type === type).length
      const needed = (count * MIN_ARC) / (Math.PI * 2)
      previous = Math.max(previous + 18, needed)
      radii.push(previous)
    }
    const scale = previous > outer ? outer / previous : 1

    shown.forEach((type, ring) => {
      const nodes = visible.filter((n) => n.type === type)
      const r = radii[ring] * scale
      nodes.forEach((n, i) => {
        // The per-ring offset keeps neighbouring rings from lining their nodes
        // up along the same spokes, which reads as a grid rather than a graph.
        const angle = (Math.PI * 2 * i) / Math.max(nodes.length, 1) + ring * 0.6
        positions.set(n.id, { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r })
      })
    })
    return positions
  }, [visible, hidden, counts, size])

  const selected = selectedId ? (graph.byId.get(selectedId) ?? null) : null
  const query = QUERY_EXAMPLES.find((q) => q.id === queryId)
  const result = query ? query.run(graph) : null

  const toggleType = (type: GraphNodeType) =>
    setHidden((current) => {
      const next = new Set(current)
      if (!next.delete(type)) next.add(type)
      return next
    })

  const openRecord = (node: GraphNode) => {
    if (node.type === 'application') {
      navigation.navigate('ApplicationDetail', { id: node.recordId })
      return
    }
    if (node.type === 'item') {
      navigation.navigate('Tabs', {
        screen: 'Vault',
        params: { tool: 'reminders', focus: node.recordId },
      })
      return
    }
    if (node.type === 'file' || node.type === 'link' || node.type === 'snippet') {
      navigation.navigate('Tabs', {
        screen: 'Vault',
        params: { tool: `${node.type}s` as 'files' | 'links' | 'snippets' },
      })
      return
    }
    if (node.type === 'match' || node.type === 'posting') {
      navigation.navigate('JobScout')
    }
  }

  if (graph.nodes.length === 0) {
    return (
      <Screen title="Graph" subtitle="Your records, drawn as the network they are">
        <Panel>
          <EmptyState
            icon="share-2"
            title="Nothing to draw"
            description="Every node here is one of your own records. Add an application and the first one appears."
          />
        </Panel>
      </Screen>
    )
  }

  return (
    <Screen
      title="Graph"
      subtitle="A preview of what jojo looks like once records stop being seven separate lists"
    >
      <Panel>
        <View style={{ alignSelf: 'center' }}>
          <Svg width={size} height={size}>
            {graph.edges.map((e, i) => {
              const from = layout.get(e.from)
              const to = layout.get(e.to)
              if (!from || !to) return null
              const lit = selectedId !== null && (e.from === selectedId || e.to === selectedId)
              return (
                <Line
                  key={i}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={lit ? c.accent : c.hairline}
                  strokeWidth={lit ? 1.5 : 0.7}
                />
              )
            })}
            {visible.map((n) => {
              const at = layout.get(n.id)
              if (!at) return null
              const on = n.id === selectedId
              return (
                <Circle
                  key={n.id}
                  cx={at.x}
                  cy={at.y}
                  // Degree is the only thing size encodes: a node joined to
                  // eight things matters more than one joined to nothing.
                  r={on ? 8 : 3.5 + Math.min(n.degree, 6) * 0.7}
                  fill={typeColor(n.type, c)}
                  stroke={on ? c.accent : 'transparent'}
                  strokeWidth={2}
                  onPress={() => setSelectedId(n.id)}
                />
              )
            })}
          </Svg>
        </View>

        <Txt size="xs" tone="muted" center style={{ marginTop: space[2] }}>
          {visible.length} of {graph.nodes.length} nodes · {graph.edges.length} edges. Tap a node to
          read it; tap a type below to hide it.
        </Txt>
      </Panel>

      <Panel>
        <PanelTitle hint="tap to hide a type">Legend</PanelTitle>
        <View style={styles.legend}>
          {GRAPH_NODE_TYPES.filter((t) => (counts.get(t) ?? 0) > 0).map((t) => {
            const off = hidden.has(t)
            return (
              <Pressable
                key={t}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: !off }}
                onPress={() => toggleType(t)}
                style={[
                  styles.legendChip,
                  { backgroundColor: c.well, borderColor: off ? c.hairline : c.hairlineStrong },
                ]}
              >
                <View
                  style={[
                    styles.swatch,
                    {
                      backgroundColor: off ? 'transparent' : typeColor(t, c),
                      borderColor: typeColor(t, c),
                    },
                  ]}
                />
                <Txt
                  size="sm"
                  tone={off ? 'muted' : 'secondary'}
                  style={off ? s.struck : undefined}
                >
                  {NODE_TYPE_LABEL[t]}
                </Txt>
                <Txt size="xs" tone="muted" mono>
                  {counts.get(t) ?? 0}
                </Txt>
              </Pressable>
            )
          })}
        </View>
      </Panel>

      {selected ? (
        <Panel>
          <PanelTitle hint={NODE_TYPE_LABEL[selected.type]}>{selected.label}</PanelTitle>
          {selected.detail ? (
            <Txt size="sm" tone="secondary" style={{ marginBottom: space[3] }}>
              {selected.detail}
            </Txt>
          ) : null}

          <Txt size="xs" tone="muted" uppercase style={{ marginBottom: space[2] }}>
            Joined to
          </Txt>
          {incidentEdges(graph, selected.id).length === 0 ? (
            <Txt size="sm" tone="muted">
              Nothing points at this yet.
            </Txt>
          ) : (
            incidentEdges(graph, selected.id).map((e, i) => {
              const other = graph.byId.get(otherEnd(e, selected.id))
              if (!other) return null
              return (
                <Pressable
                  key={`${e.from}-${e.to}-${i}`}
                  accessibilityRole="button"
                  onPress={() => setSelectedId(other.id)}
                  style={styles.edgeRow}
                >
                  <View
                    style={[
                      styles.swatch,
                      {
                        backgroundColor: typeColor(other.type, c),
                        borderColor: typeColor(other.type, c),
                      },
                    ]}
                  />
                  <Txt size="sm" style={s.fill} numberOfLines={1}>
                    {other.label}
                  </Txt>
                  <Txt size="xs" tone="muted">
                    {REL_LABEL[e.rel]}
                  </Txt>
                </Pressable>
              )
            })
          )}

          <Button
            label="Open the record"
            variant="outline"
            onPress={() => openRecord(selected)}
            style={{ marginTop: space[3], alignSelf: 'flex-start' }}
          />
        </Panel>
      ) : null}

      <Panel>
        <PanelTitle hint="answers a list view cannot give">Questions</PanelTitle>
        <View style={{ gap: space[2] }}>
          {QUERY_EXAMPLES.map((q) => (
            <Button
              key={q.id}
              label={q.question}
              variant={q.id === queryId ? 'default' : 'outline'}
              onPress={() => setQueryId(q.id === queryId ? null : q.id)}
            />
          ))}
        </View>

        {query && result ? (
          <View style={{ marginTop: space[4] }}>
            <Txt size="xs" tone="muted">
              {query.why}
            </Txt>
            <Divider style={{ marginVertical: space[3] }} />
            {result.length === 0 ? (
              // A query that matched nothing has to say so next to the picture,
              // or an empty list reads as the query having failed to run.
              <Txt size="sm" tone="secondary">
                Nothing matches — which is the good answer to this one.
              </Txt>
            ) : (
              result.map((n) => (
                <Pressable
                  key={n.id}
                  accessibilityRole="button"
                  onPress={() => setSelectedId(n.id)}
                  style={styles.edgeRow}
                >
                  <View
                    style={[
                      styles.swatch,
                      { backgroundColor: typeColor(n.type, c), borderColor: typeColor(n.type, c) },
                    ]}
                  />
                  <Txt size="sm" style={s.fill} numberOfLines={1}>
                    {n.label}
                  </Txt>
                  <Chip size="sm" tone="gray">
                    {NODE_TYPE_LABEL[n.type]}
                  </Chip>
                </Pressable>
              ))
            )}
          </View>
        ) : null}
      </Panel>
    </Screen>
  )
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  legendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1.5],
    minHeight: 36,
    paddingHorizontal: space[2.5],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
  },
  swatch: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5 },
  edgeRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: 44 },
})
