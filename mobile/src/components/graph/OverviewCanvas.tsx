import { intlLocale } from '@jojo/service/core/intl-locale'
import { GROUP_LOOSE, clusterLayout, hostOf, satellites } from '@jojo/service/core/graph-view'
import type { ClusterGroup, Folding, Point, ViewGraph } from '@jojo/service/core/graph-view'
import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { I18nManager, StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { GestureDetector } from 'react-native-gesture-handler'
import Animated from 'react-native-reanimated'
import Svg, { Circle, G, Path, Rect } from 'react-native-svg'
import { CanvasText } from './CanvasText'
import { IconButton } from '@/components/ui/Button'
import { typeColor } from '@/lib/graph'
import type { GraphNodeType } from '@/lib/graph'
import {
  circlesPath,
  estimateWidth,
  segmentsPath,
  nearestMark,
  pickLabels,
  truncateLabel,
} from '@/lib/graph-canvas'
import type { LabelCandidate } from '@/lib/graph-canvas'
import { groupName, groupOrderOf, memberOrder } from '@/lib/graph-view'
import type { GroupDimension } from '@/lib/graph-view'
import { useColors } from '@/theme/theme-context'
import type { Palette } from '@/theme/tokens'
import { radius as corner, space } from '@/theme/tokens'
import { useCanvasZoom } from './use-canvas-zoom'
import { useGraphWords } from './use-graph-words'

/**
 * The overview: every drawn record in a labelled circle per group, and no
 * lines until a record is selected — the phone's half of the web's
 * `OverviewCanvas`, laid out by the same `clusterLayout`.
 *
 * TWO LAYERS. The marks are one SVG group built once per layout and moved by
 * the zoom's matrix on the UI thread (`use-canvas-zoom.ts`): selecting a record
 * or pinching never re-renders them. Everything else is the SCREEN layer,
 * drawn in screen pixels so text stays the size it was written at whatever the
 * zoom: group names, the selected record's lines and its linked records drawn
 * again at full strength, the records counted on it unfolded round it, names,
 * and the counts beside each mark once there is room to read them.
 *
 * Touch: a tap selects the nearest record (or clears the selection); pinch and
 * the buttons zoom; once zoomed, a drag pans. TalkBack reads the canvas as one
 * summary and reaches every record through the Groups list beneath it, which
 * names each with what is counted on it.
 */

type Props = {
  viewGraph: ViewGraph
  folding: Folding
  by: GroupDimension
  width: number
  height: number
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** Records an answer lit, mapped onto what is drawn. */
  answered?: ReadonlySet<string> | null
  /** True while a pinch or a pan has the canvas, so the page stops scrolling. */
  onGesture: (active: boolean) => void
  /** The groups as drawn, in reading order — for the list beneath the canvas. */
  onGroups?: (groups: readonly ClusterGroup[]) => void
}

const GROUP_LABEL_SIZE = 11.5
const LABEL_SIZE = 11
/** At most this many unfolded records round a host; the rest are in the detail panel. */
const MAX_SATELLITES = 36
/** Folded-count badges appear once a record has this much room on screen. */
const BADGE_MIN_CELL = 30
const BADGE_SIZE = 10
/** Records are named once each has this much room on screen. */
const NAME_MIN_CELL = 40
/** The most a record's dot grows to on screen when zoomed in. */
const MAX_DOT = 7
/** How far from a tap a mark may be and still be the one meant, in screen pixels. */
const TAP_REACH = 22
/** Height kept clear along the bottom for the zoom buttons. */
const ZOOM_BAR = 46

const AnimatedG = Animated.createAnimatedComponent(G)

export function OverviewCanvas({
  viewGraph,
  folding,
  by,
  width,
  height,
  selectedId,
  onSelect,
  answered = null,
  onGesture,
  onGroups,
}: Props) {
  const c = useColors()
  const { t, language, byId, foldedText } = useGraphWords(viewGraph, folding)
  const rtl = I18nManager.isRTL

  /**
   * "Postdoc · 100", fitted to a share of the width by shortening the NAME,
   * never the count — a long role name gives way instead of reserving room
   * that shrinks every circle to a dot.
   */
  const labelBudget = Math.min(170, Math.max(96, width * 0.42))
  const nameOf = useCallback(
    (key: string, count: number, budget = labelBudget) => {
      const tail = ` · ${count.toLocaleString(intlLocale(language))}`
      const name = groupName(key, by, t)
      const room = budget - estimateWidth(tail, GROUP_LABEL_SIZE) - 8
      let fitted = name
      while (fitted.length > 4 && estimateWidth(fitted, GROUP_LABEL_SIZE) > room) {
        fitted = fitted.slice(0, -1)
      }
      return `${fitted === name ? name : `${fitted.trimEnd()}…`}${tail}`
    },
    [by, t, language, labelBudget],
  )

  const layout = useMemo(() => {
    const placed = clusterLayout(viewGraph, {
      by,
      width,
      // The zoom buttons sit along the bottom edge: the circles stay above
      // them, beside the loose strip when there is one.
      height: height - (folding.loose.length > 0 ? 10 : ZOOM_BAR),
      folding,
      order: memberOrder,
      groupOrder: groupOrderOf(by),
      labelHeight: GROUP_LABEL_SIZE + 8,
      labelWidth: (key, count) =>
        Math.min(labelBudget, estimateWidth(nameOf(key, count), GROUP_LABEL_SIZE) + 8),
      margin: 10,
      gap: 8,
    })
    if (!rtl) return placed
    // Mirrored in Arabic and Urdu: stages then read right to left like the
    // board, and the loose strip starts at the reading edge.
    const mirror = (x: number) => width - x
    const positions = new Map<string, Point>()
    for (const [id, p] of placed.positions) positions.set(id, { x: mirror(p.x), y: p.y })
    return {
      ...placed,
      positions,
      groups: placed.groups.map((g) => ({ ...g, x: mirror(g.x), labelX: mirror(g.labelX) })),
    }
  }, [viewGraph, folding, by, width, height, nameOf, rtl, labelBudget])

  useEffect(() => {
    onGroups?.(layout.groups)
  }, [layout, onGroups])

  /** A record's drawn radius in layout units: from the spacing, hubs a little larger. */
  const radius = useMemo(() => {
    const base = Math.max(2.2, Math.min(6, layout.cell * 0.34))
    return (type: string) =>
      type === 'application' ? base : Math.min(base * 1.35, layout.cell * 0.48)
  }, [layout.cell])

  const visibleAdj = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const edge of folding.edges) {
      for (const [a, b] of [
        [edge.from, edge.to],
        [edge.to, edge.from],
      ] as const) {
        const list = map.get(a)
        if (list) {
          if (!list.includes(b)) list.push(b)
        } else map.set(a, [b])
      }
    }
    return map
  }, [folding])

  // The loose item is selected by its own key, which `hostOf` does not know.
  const host =
    selectedId === GROUP_LOOSE
      ? GROUP_LOOSE
      : selectedId
        ? (hostOf(folding, selectedId) ?? null)
        : null
  const hostAt = host ? layout.positions.get(host) : undefined

  const lit = useMemo(() => {
    if (host && host !== GROUP_LOOSE) return new Set([host, ...(visibleAdj.get(host) ?? [])])
    if (host === GROUP_LOOSE) return new Set([GROUP_LOOSE])
    if (answered && answered.size > 0) {
      const set = new Set<string>()
      for (const id of answered) {
        const at = hostOf(folding, id)
        if (at) set.add(at)
      }
      return set
    }
    return null
  }, [host, visibleAdj, answered, folding])

  /* ------------------------------- zoom, taps ------------------------------- */

  // The gesture calls a stable function, which reads the latest picture
  // through a ref, so a new selection does not rebuild the gesture.
  const tapRef = useRef<(x: number, y: number) => void>(() => {})
  const onTap = useCallback((x: number, y: number) => tapRef.current(x, y), [])
  const zoom = useCanvasZoom({ width, height, resetKey: layout, onTap, onGesture })
  const { view } = zoom
  /**
   * A record's drawn radius in screen pixels: it grows with the zoom up to
   * `MAX_DOT`, and then the space between records grows instead — which is
   * where their names and counts go.
   */
  const dotK = view.k
  const dotR = useCallback(
    (type: string) => Math.min(radius(type) * dotK, Math.max(radius(type), MAX_DOT)),
    [radius, dotK],
  )

  const toScreen = useCallback(
    (p: Point): Point => ({ x: p.x * view.k + view.x, y: p.y * view.k + view.y }),
    [view],
  )
  const onScreen = useCallback(
    (p: Point, pad = 0) => p.x >= -pad && p.x <= width + pad && p.y >= -pad && p.y <= height + pad,
    [width, height],
  )

  // A selection made elsewhere (the Groups list, the detail panel) pans the
  // record into view when zoomed, rather than leaving it off-screen.
  const { ensureVisible } = zoom
  useEffect(() => {
    if (!selectedId) return
    const at = hostOf(folding, selectedId)
    const p = at ? layout.positions.get(at) : undefined
    if (p) ensureVisible(p)
  }, [selectedId, folding, layout, ensureVisible])

  /* ------------------------------ static layer ------------------------------ */

  const staticLayer = useMemo(
    () => <StaticMarks layout={layout} byId={byId} radius={radius} scale={dotK} c={c} />,
    [layout, byId, radius, dotK, c],
  )

  /* ------------------------------ screen layer ------------------------------ */

  /** The records counted on the selected host, unfolded round it in screen pixels. */
  const unfolded = useMemo(() => {
    if (!host || host === GROUP_LOOSE || !hostAt) return null
    const centre = toScreen(hostAt)
    // Panned off-screen, the selection draws nothing here rather than a ring
    // pinned to the edge for a record that is not in view.
    if (!onScreen(centre, 4)) return null
    const children = (folding.folded.get(host) ?? []).slice(0, MAX_SATELLITES)
    const seats = new Map<string, Point>()
    if (children.length === 0) return { centre, children, seats, reach: 0 }
    const r = dotR(byId.get(host)?.type ?? '')
    const spacing = Math.max(24, r * 3)
    const points = satellites(children.length, centre, { radius: r + 4, spacing })
    children.forEach((id, i) => {
      const p = points[i]
      if (p) seats.set(id, clampTo(p, width, height, 8))
    })
    let reach = 0
    for (const p of seats.values())
      reach = Math.max(reach, Math.hypot(p.x - centre.x, p.y - centre.y))
    return { centre, children, seats, reach }
  }, [host, hostAt, folding, dotR, byId, width, height, toScreen, onScreen])

  const overlay = useMemo(() => {
    const lines: { key: string; a: Point; b: Point }[] = []
    const candidates: LabelCandidate[] = []
    const k = view.k
    const posOf = (id: string) => {
      const seat = unfolded?.seats.get(id)
      if (seat) return seat
      const p = layout.positions.get(id)
      return p ? toScreen(p) : undefined
    }
    const bounds = { width, height }

    if (host && host !== GROUP_LOOSE && unfolded) {
      const centre = unfolded.centre
      for (const other of visibleAdj.get(host) ?? []) {
        const p = posOf(other)
        if (p) lines.push({ key: `${host}>${other}`, a: centre, b: p })
      }
      for (const child of unfolded.children) {
        const seat = unfolded.seats.get(child)
        const parent = folding.parent.get(child)
        const from = (parent === undefined ? undefined : posOf(parent)) ?? centre
        if (seat) lines.push({ key: `${child}<`, a: from, b: seat })
      }
      const hostNode = byId.get(host)
      if (hostNode) {
        candidates.push({
          id: host,
          x: centre.x,
          y: centre.y,
          r: Math.max(dotR(hostNode.type) + 2, unfolded.reach + 6),
          text: truncateLabel(hostNode.label, 30),
          rank: 100,
          placement: 'below',
          size: 12.5,
        })
      }
      // A hub's hundred neighbours are a burst of lines, not a list of names
      // a phone can show: name them only when there are a few.
      const neighbours = visibleAdj.get(host) ?? []
      for (const other of neighbours.length > 16 ? [] : neighbours) {
        const p = posOf(other)
        const node = byId.get(other)
        if (p && node) {
          candidates.push({
            id: other,
            x: p.x,
            y: p.y,
            r: dotR(node.type),
            text: truncateLabel(node.label, 24),
            rank: 50,
            placement: 'below',
          })
        }
      }
      if (unfolded.children.length <= 12) {
        for (const child of unfolded.children) {
          const p = unfolded.seats.get(child)
          const node = byId.get(child)
          if (p && node) {
            candidates.push({
              id: child,
              x: p.x,
              y: p.y,
              r: 5,
              text: truncateLabel(node.label, 18),
              rank: 20,
              placement: p.x >= centre.x ? 'start' : 'end',
              size: 10.5,
            })
          }
        }
      }
    } else if (lit) {
      for (const id of lit) {
        const p = posOf(id)
        const node = byId.get(id)
        if (p && node && onScreen(p)) {
          candidates.push({
            id,
            x: p.x,
            y: p.y,
            r: dotR(node.type),
            text: truncateLabel(node.label, 24),
            rank: 10,
            placement: 'below',
          })
        }
      }
    }
    // Zoomed in far enough to read them, the records on screen are named —
    // what zooming in on a phone is for.
    const blocked: { left: number; right: number; top: number; bottom: number }[] = []
    if (!lit && layout.cell * k >= NAME_MIN_CELL) {
      for (const [id, at] of layout.positions) {
        const node = byId.get(id)
        if (!node) continue
        const p = toScreen(at)
        if (!onScreen(p)) continue
        // Names keep off the dots, so a crowded patch stays dots.
        const r = dotR(node.type) + 1
        blocked.push({ left: p.x - r, right: p.x + r, top: p.y - r, bottom: p.y + r })
        candidates.push({
          id,
          x: p.x,
          y: p.y,
          r: dotR(node.type),
          // As long as the spacing allows: a name wider than the gap to the
          // next dot would only ever be dropped.
          text: truncateLabel(node.label, Math.max(8, Math.floor((layout.cell * k * 1.7) / 5.6))),
          rank: node.type === 'application' ? 2 : 3,
          placement: 'below',
          size: 10,
        })
        if (candidates.length >= 160) break
      }
    }
    if (selectedId && selectedId !== host) {
      const p = posOf(selectedId)
      const node = byId.get(selectedId)
      if (p && node) {
        candidates.push({
          id: selectedId,
          x: p.x,
          y: p.y,
          r: (unfolded?.seats.has(selectedId) ? 4.5 : dotR(node.type)) + 2,
          text: truncateLabel(node.label, 30),
          rank: 90,
          placement: 'below',
          size: 12,
        })
      }
    }
    // A name in the middle of the picture must not cover the group names.
    const labels = pickLabels(candidates, { limit: 60, bounds, blocked })
    return { lines, labels }
  }, [
    host,
    unfolded,
    visibleAdj,
    layout,
    folding,
    byId,
    dotR,
    lit,
    selectedId,
    width,
    height,
    toScreen,
    onScreen,
    view.k,
  ])

  /** Group names, just above each disc, while the disc is on screen. */
  const groupLabels = useMemo(
    () =>
      layout.groups.flatMap((group) => {
        const loose = group.key === GROUP_LOOSE
        const count = group.anchors || group.members.length
        const anchor = loose
          ? toScreen({ x: group.labelX, y: group.labelY })
          : { x: group.x * view.k + view.x, y: (group.y - group.r) * view.k + view.y - 5 }
        if (!onScreen(anchor, 40)) return []
        // The loose label runs away from its stack: rightward, or leftward in
        // a mirrored picture (react-native-svg anchors are physical).
        const textAnchor: 'start' | 'middle' | 'end' = loose ? (rtl ? 'end' : 'start') : 'middle'
        return [
          {
            key: group.key,
            x: anchor.x,
            y: anchor.y,
            anchor: textAnchor,
            text: loose
              ? `${groupName(group.key, by, t)} · ${count.toLocaleString(intlLocale(language))}`
              : // Shown as wide as its disc allows: a big circle has room for
                // the name the layout's reservation would have shortened.
                nameOf(
                  group.key,
                  count,
                  Math.min(width - 16, Math.max(labelBudget, 2 * group.r * view.k + 24)),
                ),
          },
        ]
      }),
    [layout, view, toScreen, onScreen, by, t, language, nameOf, rtl, width, labelBudget],
  )

  /** Folded counts beside each mark, once there is room on screen to read them. */
  const badges = useMemo(() => {
    if (layout.cell * view.k < BADGE_MIN_CELL) return []
    const out: { id: string; x: number; y: number; n: number }[] = []
    for (const [id, list] of folding.folded) {
      const at = layout.positions.get(id)
      if (!at) continue
      const p = toScreen(at)
      if (!onScreen(p)) continue
      const r = dotR(byId.get(id)?.type ?? '')
      out.push({ id, x: p.x + r + 2, y: p.y - r + 2, n: list.length })
      if (out.length >= 120) break
    }
    return out
  }, [layout, folding, view.k, toScreen, onScreen, dotR, byId])

  /** The lit records (on screen) and the unfolded ring, as one path per colour. */
  const litMarks = useMemo(() => {
    const dots = new Map<string, { x: number; y: number; r: number }[]>()
    const add = (type: string, dot: { x: number; y: number; r: number }) => {
      const fill = typeColor(type as GraphNodeType, c)
      const list = dots.get(fill)
      if (list) list.push(dot)
      else dots.set(fill, [dot])
    }
    for (const id of lit ?? []) {
      const at = layout.positions.get(id)
      const node = byId.get(id)
      if (!at || !node) continue
      const p = toScreen(at)
      if (onScreen(p, 20)) add(node.type, { ...p, r: dotR(node.type) })
    }
    for (const id of unfolded?.children ?? []) {
      const p = unfolded?.seats.get(id)
      const node = byId.get(id)
      if (p && node) add(node.type, { ...p, r: 4.5 })
    }
    return [...dots].map(([fill, list]) => ({ fill, d: circlesPath(list) }))
  }, [lit, unfolded, layout, byId, toScreen, onScreen, dotR, c])

  const selectedPos = selectedId
    ? (unfolded?.seats.get(selectedId) ??
      (layout.positions.get(selectedId)
        ? toScreen(layout.positions.get(selectedId) as Point)
        : undefined))
    : undefined
  const hostFoldedText = host && host !== GROUP_LOOSE && hostAt ? foldedText(host) : ''
  const hostLabel = overlay.labels.find((label) => label.id === host)

  /* ---------------------------------- taps ---------------------------------- */

  tapRef.current = (x: number, y: number) => {
    const at = { x, y }
    // The unfolded ring first: it sits on top of everything else.
    const seats = unfolded ? [...unfolded.seats].map(([id, p]) => ({ id, ...p })) : []
    const ring = nearestMark(seats, at, 16)
    if (ring) {
      onSelect(ring === selectedId ? null : ring)
      return
    }
    const loose = layout.groups.find((g) => g.key === GROUP_LOOSE)
    if (loose) {
      const p = toScreen(loose)
      const w = estimateWidth(groupLabels.find((l) => l.key === GROUP_LOOSE)?.text ?? '', 11.5)
      const across = rtl ? x <= p.x + 14 && x >= p.x - 20 - w : x >= p.x - 14 && x <= p.x + 20 + w
      if (across && Math.abs(y - p.y) <= 16) {
        onSelect(selectedId === GROUP_LOOSE ? null : GROUP_LOOSE)
        return
      }
    }
    // Every drawn record, in screen pixels: the reach grows a little with the
    // zoom so a fingertip still finds a mark that is drawn larger.
    const marks: { id: string; x: number; y: number }[] = []
    for (const [id, p] of layout.positions) {
      if (id === GROUP_LOOSE) continue
      marks.push({ id, x: p.x * view.k + view.x, y: p.y * view.k + view.y })
    }
    const hit = nearestMark(marks, at, Math.max(TAP_REACH, layout.cell * view.k * 0.5))
    onSelect(hit === null || hit === selectedId ? null : hit)
  }

  /* --------------------------------- render --------------------------------- */

  const looseGroup = layout.groups.find((g) => g.key === GROUP_LOOSE)
  const looseAt = looseGroup ? toScreen(looseGroup) : null

  return (
    <View style={[styles.frame, { width, height, backgroundColor: c.well }]}>
      <GestureDetector gesture={zoom.gesture}>
        <View
          style={StyleSheet.absoluteFill}
          collapsable={false}
          accessible
          accessibilityRole="image"
          accessibilityLabel={t('graph.view.overviewLabel', {
            groups: t('graph.view.groups', { count: layout.groups.length }),
            records: t('graph.records', { count: viewGraph.nodes.length }),
          })}
          accessibilityHint={t('graph.view.listHint')}
        >
          <Svg width={width} height={height} style={{ opacity: lit ? 0.32 : 1 }}>
            <AnimatedG animatedProps={zoom.matrixProps}>{staticLayer}</AnimatedG>
          </Svg>

          <Animated.View style={[StyleSheet.absoluteFill, zoom.overlayStyle]} pointerEvents="none">
            <Svg width={width} height={height}>
              {/* One path for the lines and one per colour for the lit marks and
                  the unfolded ring: a role lights a hundred records. */}
              {overlay.lines.length > 0 ? (
                <Path
                  d={segmentsPath(overlay.lines)}
                  stroke={c.text3}
                  strokeWidth={1.2}
                  opacity={0.75}
                />
              ) : null}
              {litMarks.map(({ fill, d }) => (
                <Path key={fill} d={d} fill={fill} stroke={c.panel} strokeWidth={1} />
              ))}
              {lit?.has(GROUP_LOOSE) && looseAt ? (
                <StackGlyph x={looseAt.x} y={looseAt.y} r={6} c={c} />
              ) : null}

              {selectedPos ? (
                <Circle
                  cx={selectedPos.x}
                  cy={selectedPos.y}
                  r={
                    (unfolded?.seats.has(selectedId ?? '')
                      ? 4.5
                      : dotR(byId.get(selectedId ?? '')?.type ?? '')) + 4.5
                  }
                  fill="none"
                  stroke={c.accent}
                  strokeWidth={2}
                />
              ) : null}
            </Svg>

            {/* Names as native text over the picture: see \`CanvasText\`. */}
            <View style={[StyleSheet.absoluteFill, { opacity: lit ? 0.5 : 1 }]}>
              {groupLabels.map((label) => (
                <CanvasText
                  key={label.key}
                  x={label.x}
                  y={label.y}
                  anchor={label.anchor}
                  size={GROUP_LABEL_SIZE}
                  weight="medium"
                  color={c.text2}
                >
                  {label.text}
                </CanvasText>
              ))}
              {badges.map((badge) => (
                <CanvasText
                  key={badge.id}
                  x={badge.x}
                  y={badge.y}
                  anchor="start"
                  size={BADGE_SIZE}
                  color={c.text3}
                >
                  {`+${badge.n}`}
                </CanvasText>
              ))}
            </View>
            {overlay.labels.map((label) => (
              <CanvasText
                key={label.id}
                x={label.tx}
                y={label.ty}
                anchor={label.anchor}
                size={label.size ?? LABEL_SIZE}
                weight={label.rank >= 90 ? 'semibold' : 'regular'}
                color={c.text1}
                halo={c.well}
              >
                {label.text}
              </CanvasText>
            ))}
            {hostLabel && hostFoldedText ? (
              <CanvasText
                x={subLineX(hostLabel, hostFoldedText, width)}
                y={hostLabel.ty + (hostLabel.size ?? LABEL_SIZE) * 1.3}
                anchor={hostLabel.anchor}
                size={10}
                color={c.text2}
                halo={c.well}
              >
                {truncateLabel(hostFoldedText, Math.max(16, Math.floor(width / (10 * 0.56)) - 2))}
              </CanvasText>
            ) : null}
          </Animated.View>
        </View>
      </GestureDetector>

      <ZoomControls
        rtl={rtl}
        zoomed={zoom.zoomed}
        atMax={view.k >= 7.999}
        onIn={() => zoom.zoomIn(unfolded?.centre)}
        onOut={() => zoom.zoomOut(unfolded?.centre)}
        onFit={zoom.fit}
      />
    </View>
  )
}

/**
 * The marks: group discs and one dot per record, in layout units. Memoised on
 * the layout alone — selection, zoom and answers are never its props.
 */
const StaticMarks = memo(function StaticMarks({
  layout,
  byId,
  radius,
  scale,
  c,
}: {
  layout: ReturnType<typeof clusterLayout>
  byId: ReadonlyMap<string, { type: string }>
  radius: (type: string) => number
  /** The committed zoom: dots stop growing at `MAX_DOT` screen pixels. */
  scale: number
  c: Palette
}) {
  // One path per colour for the whole picture, and one for the discs: see
  // `circlesPath` for what an element per dot cost.
  const { discs, byColour, loose } = useMemo(() => {
    const dots = new Map<string, { x: number; y: number; r: number }[]>()
    const rings: { x: number; y: number; r: number }[] = []
    let stack: { x: number; y: number } | null = null
    for (const group of layout.groups) {
      if (group.key === GROUP_LOOSE) {
        stack = { x: group.x, y: group.y }
        continue
      }
      rings.push({ x: group.x, y: group.y, r: group.r })
      for (const id of group.members) {
        const node = byId.get(id)
        const p = layout.positions.get(id)
        if (!node || !p) continue
        const fill = typeColor(node.type as GraphNodeType, c)
        const list = dots.get(fill)
        const r = radius(node.type)
        const dot = { x: p.x, y: p.y, r: Math.min(r, Math.max(r, MAX_DOT) / scale) }
        if (list) list.push(dot)
        else dots.set(fill, [dot])
      }
    }
    return {
      discs: circlesPath(rings),
      byColour: [...dots].map(([fill, list]) => ({ fill, d: circlesPath(list) })),
      loose: stack,
    }
  }, [layout, byId, radius, scale, c])

  return (
    <G>
      <Path
        d={discs}
        fill={c.panel}
        fillOpacity={0.55}
        stroke={c.hairline}
        vectorEffect="non-scaling-stroke"
      />
      {byColour.map(({ fill, d }) => (
        <Path key={fill} d={d} fill={fill} />
      ))}
      {loose ? <StackGlyph x={loose.x} y={loose.y} r={6} c={c} /> : null}
    </G>
  )
})

/** Three stacked squares: many records, none linked. */
function StackGlyph({ x, y, r, c }: { x: number; y: number; r: number; c: Palette }) {
  const side = r * 1.5
  return (
    <G x={x} y={y}>
      {[2, 1, 0].map((step) => (
        <Rect
          key={step}
          x={-side / 2 + step * 3}
          y={-side / 2 - step * 3}
          width={side}
          height={side}
          rx={side * 0.2}
          fill={c.text2}
          stroke={c.panel}
          opacity={1 - step * 0.25}
        />
      ))}
    </G>
  )
}

/** Where the second line under the selected record's name goes: what is counted on it. */
function subLineX(label: { tx: number; anchor: string }, text: string, width: number) {
  if (label.anchor !== 'middle') return label.tx
  const w = estimateWidth(text, 10)
  return Math.max(w / 2 + 2, Math.min(width - w / 2 - 2, label.tx))
}

/** Zoom in, zoom out, fit — real, named buttons, beside the picture rather than on it. */
function ZoomControls({
  rtl,
  zoomed,
  atMax,
  onIn,
  onOut,
  onFit,
}: {
  rtl: boolean
  zoomed: boolean
  atMax: boolean
  onIn: () => void
  onOut: () => void
  onFit: () => void
}) {
  const c = useColors()
  const { t } = useTranslation('screens')
  return (
    <View
      accessibilityRole="toolbar"
      accessibilityLabel={t('graph.view.zoom.label')}
      // At the end of the reading line: bottom right, bottom left in Arabic.
      style={[
        styles.zoom,
        rtl ? { left: space[1.5] } : { right: space[1.5] },
        { backgroundColor: c.panel, borderColor: c.hairline },
      ]}
    >
      <IconButton icon="plus" label={t('graph.view.zoom.in')} onPress={onIn} disabled={atMax} />
      <IconButton
        icon="minus"
        label={t('graph.view.zoom.out')}
        onPress={onOut}
        disabled={!zoomed}
      />
      <IconButton
        icon="maximize"
        label={t('graph.view.zoom.fit')}
        onPress={onFit}
        disabled={!zoomed}
      />
    </View>
  )
}

const clampTo = (p: Point, width: number, height: number, pad: number): Point => ({
  x: Math.max(pad, Math.min(width - pad, p.x)),
  y: Math.max(pad, Math.min(height - pad, p.y)),
})

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', borderRadius: corner.md, direction: 'ltr' },
  zoom: {
    position: 'absolute',
    bottom: space[1.5],
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: corner.md,
  },
})
