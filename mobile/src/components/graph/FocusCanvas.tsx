import { intlLocale } from '@jojo/service/core/intl-locale'
import { MORE_PREFIX, adjacency, countTypes, focusLayout } from '@jojo/service/core/graph-view'
import type { Point, ViewGraph, ViewNode } from '@jojo/service/core/graph-view'
import { useCallback, useMemo } from 'react'
import { I18nManager, StyleSheet, View } from 'react-native'
import type { AccessibilityActionEvent } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Svg, { Circle, G, Line, Path, Rect } from 'react-native-svg'
import { CanvasText } from './CanvasText'
import { Txt } from '@/components/ui/Text'
import { typeColor } from '@/lib/graph'
import type { GraphNodeType } from '@/lib/graph'
import {
  circlesPath,
  estimateWidth,
  nearestMark,
  pickLabels,
  segmentsPath,
  truncateLabel,
} from '@/lib/graph-canvas'
import type { LabelCandidate } from '@/lib/graph-canvas'
import { TYPE_ORDER, foldedPhrase, listJoiner, memberOrder } from '@/lib/graph-view'
import { useColors } from '@/theme/theme-context'
import { radius as corner, space } from '@/theme/tokens'
import { typeLabel, useGraphWords } from './use-graph-words'

/**
 * One record at the centre, what it links to on the first ring, what those
 * link to on the second — `focusLayout` from `kg/core/graph-view.ts`, the same
 * rings the web draws.
 *
 * Drawn from the whole (legend-filtered) graph, not the folded one: "what is
 * this connected to" is the question folding hid the answer to. A hub two
 * steps out is drawn closed with what it stands for counted ("Researcher · 99
 * applications"); Expand opens it, and its "+N more" item selects the hub,
 * whose detail panel lists them all.
 *
 * At most a few hundred records, so it renders plainly. A tap selects the
 * nearest record. For TalkBack every record is also a named element, in ring
 * order, whose actions select it, focus on it and expand it.
 */

type Props = {
  viewGraph: ViewGraph
  centreId: string
  expanded: ReadonlySet<string>
  width: number
  height: number
  selectedId: string | null
  onSelect: (id: string | null) => void
  onFocus: (id: string) => void
  onExpand: (id: string) => void
  answered?: ReadonlySet<string> | null
}

const TAP_REACH = 24

export function FocusCanvas({
  viewGraph,
  centreId,
  expanded,
  width,
  height,
  selectedId,
  onSelect,
  onFocus,
  onExpand,
  answered = null,
}: Props) {
  const c = useColors()
  const { t, language, byId, words } = useGraphWords(viewGraph, null)
  const rtl = I18nManager.isRTL

  const layout = useMemo(
    () =>
      focusLayout(viewGraph, centreId, {
        width,
        height,
        expanded,
        order: memberOrder,
        maxNodes: 160,
        // On a phone the room for names would take most of the width.
        margin: 24,
      }),
    [viewGraph, centreId, expanded, width, height],
  )

  const ids = useMemo(() => [...layout.positions.keys()], [layout])

  /** How many drawn records hang off each record, for thinning a hub's spokes. */
  const family = useMemo(() => {
    const map = new Map<string, number>()
    for (const parent of layout.parentOf.values()) map.set(parent, (map.get(parent) ?? 0) + 1)
    return map
  }, [layout])

  const radiusOf = useCallback(
    (id: string) => {
      const hop = layout.hop.get(id) ?? 2
      const scale = Math.max(0.6, Math.min(1, layout.cell / 24))
      return (hop === 0 ? 11 : hop === 1 ? 6.5 : 4.5) * scale
    },
    [layout],
  )

  const active = selectedId && layout.positions.has(selectedId) ? selectedId : null
  const litNodes = useMemo(() => {
    if (active) {
      const set = new Set([active])
      for (const e of layout.edges) {
        if (e.from === active) set.add(e.to)
        if (e.to === active) set.add(e.from)
      }
      return set
    }
    if (answered && answered.size > 0)
      return new Set([...answered].filter((id) => layout.positions.has(id)))
    return null
  }, [active, layout, answered])

  /** "99 applications", for a hub drawn without its neighbours. Worded once per hub. */
  const hubText = useMemo(() => {
    const typeOf = (id: string) => byId.get(id)?.type
    const join = listJoiner(t)
    const map = new Map<string, string>()
    for (const [hub, hidden] of layout.collapsed) {
      map.set(
        hub,
        foldedPhrase(
          countTypes(hidden, typeOf, TYPE_ORDER),
          (type, count) => t(`graph.view.folded.${type}`, { count }),
          join,
        ),
      )
    }
    return map
  }, [layout, byId, t])

  /** Which way a name runs: away from the centre. */
  const outward = useCallback(
    (p: { x: number; y: number }, hop: number): LabelCandidate['placement'] => {
      if (hop === 0) return 'below'
      const dx = p.x - layout.x
      const dy = p.y - layout.y
      if (Math.abs(dx) >= Math.abs(dy) * 0.9) return dx >= 0 ? 'start' : 'end'
      return dy > 0 ? 'below' : 'above'
    },
    [layout],
  )

  const moreText = useCallback(
    (count: number) =>
      t('graph.view.moreItem', {
        count,
        formatted: count.toLocaleString(intlLocale(language)),
      }),
    [t, language],
  )

  const labels = useMemo(() => {
    const candidates: LabelCandidate[] = []
    for (const id of ids) {
      const p = layout.positions.get(id)
      const node = byId.get(id)
      if (!p || !node) continue
      const hop = layout.hop.get(id) ?? 0
      const counted = hubText.get(id)
      // An opened hub's dozens of records are a wedge, not a list of names a
      // phone can show: they are named when selected, and in the hub's panel.
      const parent = layout.parentOf.get(id)
      if (hop >= 2 && parent !== undefined && (family.get(parent) ?? 0) > 12 && id !== selectedId)
        continue
      candidates.push({
        id,
        x: p.x,
        y: p.y,
        r: radiusOf(id),
        text: counted
          ? `${truncateLabel(node.label, 18)} · ${counted}`
          : truncateLabel(node.label, hop === 0 ? 32 : 20),
        rank:
          id === centreId
            ? 1000
            : id === selectedId
              ? 900
              : litNodes?.has(id)
                ? 500 - hop
                : counted
                  ? 300
                  : 100 - hop * 10,
        placement: outward(p, hop),
        size: hop === 0 ? 13 : 10.5,
      })
    }
    // Names keep off the marks — and off the "+N more" pills — as well as each other.
    const blocked = ids.flatMap((id) => {
      const p = layout.positions.get(id)
      if (!p) return []
      const more = layout.more.get(id)
      if (more) {
        const w = estimateWidth(moreText(more.ids.length), 10.5) + 14
        return [{ left: p.x - w / 2, right: p.x + w / 2, top: p.y - 9, bottom: p.y + 9 }]
      }
      const r = radiusOf(id) + 1
      return [{ left: p.x - r, right: p.x + r, top: p.y - r, bottom: p.y + r }]
    })
    return pickLabels(candidates, { bounds: { width, height }, blocked })
  }, [
    ids,
    layout,
    byId,
    litNodes,
    selectedId,
    centreId,
    radiusOf,
    width,
    height,
    hubText,
    outward,
    moreText,
    family,
  ])

  /** A record's spoken name; a closed hub says what it stands for. */
  const nameOf = useCallback(
    (node: ViewNode) => {
      const base = {
        label: node.label,
        type: typeLabel(node.type),
        connections: words.connections(adjacency(viewGraph).get(node.id)?.length ?? 0),
      }
      const counted = hubText.get(node.id)
      return counted
        ? t('graph.view.node.hub', { ...base, folded: counted })
        : t('graph.view.node.plain', base)
    },
    [viewGraph, hubText, words, t],
  )

  /** A "+N more" item stands for its hub: tapping it selects the hub, whose panel lists them all. */
  const resolve = useCallback(
    (id: string | null) => (id?.startsWith(MORE_PREFIX) ? (layout.more.get(id)?.hub ?? null) : id),
    [layout],
  )

  /** The links, bucketed by how they are drawn, one path per bucket. */
  const edgePaths = useMemo(() => {
    const buckets = new Map<
      string,
      { on: boolean; opacity: number; segments: { a: Point; b: Point }[] }
    >()
    for (const edge of layout.edges) {
      const a = layout.positions.get(edge.from)
      const b = layout.positions.get(edge.to)
      if (!a || !b) continue
      const on = active !== null && (edge.from === active || edge.to === active)
      const tree =
        layout.parentOf.get(edge.to) === edge.from || layout.parentOf.get(edge.from) === edge.to
      // An opened hub's dozens of spokes are context, not content.
      const crowd = (family.get(edge.from) ?? 0) > 12 || (family.get(edge.to) ?? 0) > 12
      const near = Math.max(layout.hop.get(edge.from) ?? 0, layout.hop.get(edge.to) ?? 0) <= 1
      const opacity = active ? (on ? 0.95 : 0.12) : crowd ? 0.16 : tree ? (near ? 0.7 : 0.3) : 0.15
      const key = `${on}|${opacity}`
      const bucket = buckets.get(key)
      if (bucket) bucket.segments.push({ a, b })
      else buckets.set(key, { on, opacity, segments: [{ a, b }] })
    }
    // Lit links last, so they draw over the faint ones.
    return [...buckets]
      .sort(([, x], [, y]) => Number(x.on) - Number(y.on))
      .map(([key, bucket]) => ({ key, ...bucket, d: segmentsPath(bucket.segments) }))
  }, [layout, active, family])

  /** The records, bucketed by colour and dimming. */
  const nodePaths = useMemo(() => {
    const buckets = new Map<
      string,
      { fill: string; dim: boolean; dots: { x: number; y: number; r: number }[] }
    >()
    for (const id of ids) {
      const p = layout.positions.get(id)
      const node = byId.get(id)
      if (!p || !node || layout.more.has(id)) continue
      const fill = typeColor(node.type as GraphNodeType, c)
      const dim = litNodes !== null && !litNodes.has(id)
      const key = `${fill}|${dim}`
      const dot = { x: p.x, y: p.y, r: radiusOf(id) }
      const bucket = buckets.get(key)
      if (bucket) bucket.dots.push(dot)
      else buckets.set(key, { fill, dim, dots: [dot] })
    }
    return [...buckets]
      .sort(([, x], [, y]) => Number(y.dim) - Number(x.dim))
      .map(([key, bucket]) => ({
        key,
        fill: bucket.fill,
        dim: bucket.dim,
        d: circlesPath(bucket.dots),
      }))
  }, [ids, layout, byId, litNodes, radiusOf, c])

  const tap = useMemo(
    () =>
      Gesture.Tap()
        .runOnJS(true)
        .maxDistance(10)
        .onEnd((e, success) => {
          if (!success) return
          const marks = ids.flatMap((id) => {
            const p = layout.positions.get(id)
            return p ? [{ id, x: p.x, y: p.y }] : []
          })
          const hit = nearestMark(marks, { x: e.x, y: e.y }, TAP_REACH)
          const id = resolve(hit)
          // A "+N more" item always selects its hub — its panel is the list —
          // rather than toggling the hub off when it is already selected.
          if (hit?.startsWith(MORE_PREFIX)) onSelect(id)
          else onSelect(id === null || id === selectedId ? null : id)
        }),
    [ids, layout, resolve, onSelect, selectedId],
  )

  const centre = byId.get(centreId)

  return (
    <View style={[styles.frame, { width, height, backgroundColor: c.well }]}>
      <GestureDetector gesture={tap}>
        <View style={StyleSheet.absoluteFill} collapsable={false}>
          <Svg
            width={width}
            height={height}
            accessible={false}
            importantForAccessibility="no-hide-descendants"
          >
            {layout.rings.slice(0, 1).map((ring) => (
              <Circle
                key={ring.hop}
                cx={layout.x}
                cy={layout.y}
                r={ring.r}
                fill="none"
                stroke={c.hairline}
                strokeDasharray="3 5"
              />
            ))}

            {edgePaths.map((bucket) => (
              <Path
                key={bucket.key}
                d={bucket.d}
                stroke={bucket.on ? c.text2 : c.hairlineStrong}
                strokeWidth={bucket.on ? 1.4 : 1}
                opacity={bucket.opacity}
                fill="none"
              />
            ))}
            {[...layout.more.entries()].map(([id, { hub }]) => {
              const a = layout.positions.get(hub)
              const b = layout.positions.get(id)
              return a && b ? (
                <Line
                  key={id}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={c.hairlineStrong}
                  strokeDasharray="2 3"
                  opacity={0.6}
                />
              ) : null
            })}

            {ids.map((id) => {
              const p = layout.positions.get(id)
              if (!p) return null
              const more = layout.more.get(id)
              if (more) {
                const text = moreText(more.ids.length)
                const w = estimateWidth(text, 10.5) + 14
                return (
                  <G key={id} x={p.x} y={p.y}>
                    <Rect
                      x={-w / 2}
                      y={-9}
                      width={w}
                      height={18}
                      rx={9}
                      fill={c.panel}
                      stroke={c.hairlineStrong}
                    />
                  </G>
                )
              }
              return null
            })}

            {/* The records: one path per colour, dimmed or not — see
                `circlesPath` for what an element per dot costs. */}
            {nodePaths.map((bucket) => (
              <Path
                key={bucket.key}
                d={bucket.d}
                fill={bucket.fill}
                stroke={c.panel}
                strokeWidth={1}
                opacity={bucket.dim ? 0.3 : 1}
              />
            ))}
            {ids.map((id) => {
              const p = layout.positions.get(id)
              if (!p || (!expanded.has(id) && selectedId !== id)) return null
              const r = radiusOf(id)
              return (
                <G key={`ring-${id}`} x={p.x} y={p.y}>
                  {selectedId === id ? (
                    <Circle r={r + 4.5} fill="none" stroke={c.accent} strokeWidth={2} />
                  ) : null}
                  {expanded.has(id) ? (
                    <Circle r={r + 2.5} fill="none" stroke={c.text3} strokeDasharray="2 2" />
                  ) : null}
                </G>
              )
            })}
          </Svg>

          {/* Names as native text over the picture: see `CanvasText`. */}
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {[...layout.more].map(([id, more]) => {
              const p = layout.positions.get(id)
              return p ? (
                <CanvasText
                  key={id}
                  x={p.x}
                  y={p.y + 3.8}
                  anchor="middle"
                  size={10.5}
                  color={c.text2}
                >
                  {moreText(more.ids.length)}
                </CanvasText>
              ) : null
            })}
            {labels.map((label) => (
              <CanvasText
                key={label.id}
                x={label.tx}
                y={label.ty}
                anchor={label.anchor}
                size={label.size ?? 10.5}
                weight={label.id === centreId ? 'semibold' : 'regular'}
                color={c.text1}
                halo={c.well}
              >
                {label.text}
              </CanvasText>
            ))}
          </View>

          {/* TalkBack's view of the same picture: one named element per mark,
              in ring order, over the mark itself. Touch passes through to the
              tap above; screen-reader actions arrive here. */}
          <View
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
            accessibilityLabel={t('graph.view.focusLabel', {
              label: centre?.label ?? '',
              records: t('graph.records', { count: ids.length }),
            })}
          >
            {ids.map((id) => {
              const p = layout.positions.get(id)
              if (!p) return null
              const more = layout.more.get(id)
              const node = byId.get(id)
              if (!more && !node) return null
              const label = more
                ? t('graph.view.moreLabel', {
                    count: more.ids.length,
                    formatted: more.ids.length.toLocaleString(intlLocale(language)),
                    label: byId.get(more.hub)?.label ?? '',
                  })
                : nameOf(node as ViewNode)
              const target = resolve(id) ?? id
              const actions =
                more || target === centreId
                  ? [{ name: 'activate' }]
                  : [
                      { name: 'activate' },
                      {
                        name: 'focus',
                        label: t('graph.view.focusOn', { label: node?.label ?? '' }),
                      },
                      {
                        name: 'expand',
                        label: expanded.has(id) ? t('graph.view.collapse') : t('graph.view.expand'),
                      },
                    ]
              return (
                <View
                  key={id}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  accessibilityState={{
                    selected: selectedId === target,
                    ...(more || id === centreId ? {} : { expanded: expanded.has(id) }),
                  }}
                  accessibilityActions={actions}
                  onAccessibilityAction={(event: AccessibilityActionEvent) => {
                    const name = event.nativeEvent.actionName
                    if (name === 'activate') onSelect(target === selectedId ? null : target)
                    else if (name === 'focus') onFocus(target)
                    else if (name === 'expand') onExpand(target)
                  }}
                  style={[styles.a11y, { left: p.x - 12, top: p.y - 12 }]}
                />
              )
            })}
          </View>
        </View>
      </GestureDetector>

      {layout.omitted > 0 ? (
        <View
          pointerEvents="none"
          style={[
            styles.omitted,
            rtl ? { right: space[1.5] } : { left: space[1.5] },
            { backgroundColor: c.panel, borderColor: c.hairline },
          ]}
        >
          <Txt size="xs" color={c.text2}>
            {t('graph.view.more', {
              count: layout.omitted,
              formatted: layout.omitted.toLocaleString(intlLocale(language)),
            })}
          </Txt>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', borderRadius: corner.md, direction: 'ltr' },
  a11y: { position: 'absolute', width: 24, height: 24 },
  omitted: {
    position: 'absolute',
    top: space[1.5],
    maxWidth: '80%',
    paddingHorizontal: space[2],
    paddingVertical: space[1],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: corner.sm,
  },
})
