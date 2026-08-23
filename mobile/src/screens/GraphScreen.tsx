import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native'
import Svg, { Circle, Line } from 'react-native-svg'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { Screen } from '@/components/ui/Screen'
import { PatternBuilder } from '@/components/common/PatternBuilder'
import { Divider, Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import {
  GRAPH_NODE_TYPES,
  NODE_TYPE_LABEL,
  DEFAULT_PATTERN,
  typeColor,
  QUERY_EXAMPLES,
  describePattern,
  runPattern,
  REL_LABEL,
  buildGraph,
  incidentEdges,
  otherEnd,
} from '@/lib/graph'
import type { GraphNode, GraphNodeType, PatternQuery } from '@/lib/graph'
import { useLabels } from '@/lib/labels-context'
import { useApplications, useScout, useTimeline, useVault } from '@/lib/store-context'
import type { RootStackParamList } from '@/navigation/types'
import { AskBox } from '@/components/graph/AskBox'
import { highlightFor, rowsFor } from '@/lib/graph-answer'
import type { GraphQueryResult } from '@jojo/service/agent/graph-query'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { radius, space } from '@/theme/tokens'

/** Enough to see the shape of the answer without turning a panel into a list view. */
const PATTERN_SHOWN = 8

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
  const [pattern, setPattern] = useState<PatternQuery>(DEFAULT_PATTERN)

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

  /**
   * The answer to a question asked in words, and the nodes it lights.
   *
   * Held beside the two existing question sources rather than folded into them:
   * the canned examples and the pattern builder each produce this app's own
   * rows, and this produces the SHARED engine's, which have to be mapped across
   * by `recordId`. One state, cleared whenever another question is asked,
   * because two answers on screen leave the lit nodes ambiguous about which one
   * they belong to.
   */
  const [asked, setAsked] = useState<{ answer: GraphQueryResult; question: string } | null>(null)
  const askedLit = useMemo(
    () => (asked ? highlightFor(graph, asked.answer) : null),
    [graph, asked],
  )
  const askedRows = useMemo(
    () => (asked ? rowsFor(graph, asked.answer) : []),
    [graph, asked],
  )

  const selected = selectedId ? (graph.byId.get(selectedId) ?? null) : null
  const query = QUERY_EXAMPLES.find((q) => q.id === queryId)
  const result = query ? query.run(graph) : null
  const patternRows = useMemo(() => runPattern(graph, pattern), [graph, pattern])

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
              // An answer outranks the selection: it is the question the reader
              // just asked, and the selection is where they happened to tap.
              const lit = askedLit
                ? askedLit.has(e.from) && askedLit.has(e.to)
                : selectedId !== null && (e.from === selectedId || e.to === selectedId)
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
              // Dimmed rather than hidden: the shape of the whole graph is the
              // context that makes an answer mean something, and a canvas that
              // dropped the unmatched nodes would answer a different question.
              const answered = askedLit?.has(n.id) ?? true
              return (
                <Circle
                  key={n.id}
                  cx={at.x}
                  cy={at.y}
                  // Degree is the only thing size encodes: a node joined to
                  // eight things matters more than one joined to nothing.
                  r={on ? 8 : 3.5 + Math.min(n.degree, 6) * 0.7}
                  fill={typeColor(n.type, c)}
                  opacity={answered ? 1 : 0.25}
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
        <PanelTitle hint="ask in a sentence, or pick one">Ask the graph</PanelTitle>
        <AskBox
          onAnswer={(answer, question) => {
            setAsked({ answer, question })
            // One question at a time; see the note on `asked`.
            setQueryId(null)
          }}
          onClear={() => {
            setAsked(null)
          }}
        />

        {asked ? (
          <View style={{ marginTop: space[3], gap: space[2] }}>
            <Txt size="sm" tone="secondary">
              {asked.answer.summary}
            </Txt>
            {askedRows.slice(0, PATTERN_SHOWN).map((node) => (
              <Pressable
                key={node.id}
                accessibilityRole="button"
                onPress={() => setSelectedId(node.id)}
                style={styles.edgeRow}
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
              </Pressable>
            ))}
            {askedRows.length > PATTERN_SHOWN ? (
              <Txt size="xs" tone="muted">
                and {askedRows.length - PATTERN_SHOWN} more
              </Txt>
            ) : null}
          </View>
        ) : null}

        <Divider style={{ marginVertical: space[3] }} />
        <PanelTitle hint="answers a list view cannot give">Questions</PanelTitle>
        <View style={{ gap: space[2] }}>
          {QUERY_EXAMPLES.map((q) => (
            <Button
              key={q.id}
              label={q.question}
              variant={q.id === queryId ? 'default' : 'outline'}
              onPress={() => {
                setAsked(null)
                setQueryId(q.id === queryId ? null : q.id)
              }}
            />
          ))}
        </View>

        {/* The examples are the fast path; this is the one that makes the graph
            worth having. A fixed list can only answer questions somebody
            thought of, and "files with no keyword on them" was never on it. */}
        <Divider style={{ marginVertical: space[3] }} />
        <PanelTitle hint="build your own">Ask something else</PanelTitle>
        <PatternBuilder
          value={pattern}
          onChange={(next) => {
            setPattern(next)
            // Two questions on screen at once would leave the highlighted nodes
            // ambiguous about which one they are answering.
            setQueryId(null)
            setAsked(null)
          }}
        />
        <Txt size="sm" tone="secondary" style={{ marginTop: space[3] }}>
          {describePattern(pattern)}
        </Txt>
        <Txt size="xs" tone="muted" style={{ marginTop: space[1] }}>
          {patternRows.length === 0
            ? 'Nothing matches this one.'
            : `${patternRows.length} ${patternRows.length === 1 ? 'record' : 'records'}`}
        </Txt>
        {patternRows.length > 0 ? (
          <View style={{ marginTop: space[2] }}>
            {patternRows.slice(0, PATTERN_SHOWN).map((row) => (
              <Pressable
                key={row.node.id}
                accessibilityRole="button"
                onPress={() => setSelectedId(row.node.id)}
                style={styles.edgeRow}
              >
                <View
                  style={[
                    styles.swatch,
                    {
                      backgroundColor: typeColor(row.node.type, c),
                      borderColor: typeColor(row.node.type, c),
                    },
                  ]}
                />
                <Txt size="sm" style={s.fill} numberOfLines={1}>
                  {row.node.label}
                </Txt>
                {row.matched.length > 0 ? (
                  <Chip size="sm" tone="gray">
                    {String(row.matched.length)}
                  </Chip>
                ) : null}
              </Pressable>
            ))}
            {patternRows.length > PATTERN_SHOWN ? (
              <Txt size="xs" tone="muted" style={{ marginTop: space[2] }}>
                and {patternRows.length - PATTERN_SHOWN} more
              </Txt>
            ) : null}
          </View>
        ) : null}

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
