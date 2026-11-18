import { intlLocale } from '@jojo/service/core/intl-locale'
import {
  GROUP_LOOSE,
  adjacency,
  clusterLayout,
  foldedSummary,
  hostOf,
  satellites,
} from '@jojo/service/core/graph-view'
import type { Folding, Point, ViewGraph, ViewNode } from '@jojo/service/core/graph-view'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GraphNodeType } from '@/lib/graph/model'
import { NODE_TYPE_LABEL } from '@/lib/graph/model'
import type { QueryResult } from '@/lib/graph/query'
import {
  TYPE_ORDER,
  foldedPhrase,
  groupName,
  groupOrderOf,
  listJoiner,
  memberOrder,
} from '@/lib/graph/view'
import type { GroupDimension } from '@/lib/graph/view'
import { useReducedMotion } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'
import { NodeGlyph } from './NodeGlyph'
import { LooseMark, Mark, StackGlyph, ZoomControls } from './canvas/overview-marks'
import { estimateWidth, pickLabels, truncateLabel } from './canvas/pick-labels'
import type { LabelCandidate } from './canvas/pick-labels'
import { useBoxSize } from './canvas/use-box-size'
import { MAX_ZOOM, useZoom } from './canvas/use-zoom'

/**
 * The overview: every drawn record in a labelled circle per group, and no lines
 * until you ask for them.
 *
 * What this replaces, above `OVERVIEW_THRESHOLD` records, is the free force
 * layout, whose picture of a large store was five hubs under ~2,500 permanent
 * lines. Here the layout is `clusterLayout` from `kg/core/graph-view.ts` —
 * deterministic, no simulation — and the only lines on screen are the hovered,
 * focused or selected record's own, across clusters if that is where they go.
 *
 * TWO LAYERS, for the reason `GraphCanvas`'s header gives about re-rendering.
 * The STATIC layer (group discs, one mark per record) is a memoised element
 * built once per layout: thousands of `<g>`s that never re-render on hover or
 * zoom — zoom is one `transform` on the layer. Everything else is the SCREEN
 * layer, re-rendered freely and placed in screen pixels so text stays the size
 * it was written at whatever the zoom: group names, the lines, the redrawn lit
 * marks, the unfolded ring, the names, the folded-count badges.
 *
 * Still SVG, still one focusable, named element per record. Keyboard: Tab moves
 * between groups (one stop each, in reading order), arrows move within a group
 * (centre outward), Enter selects, F focuses, + − 0 zoom. Selecting a record
 * unfolds what is counted on it as satellites you can Tab to.
 */

type Props = {
  viewGraph: ViewGraph
  folding: Folding
  by: GroupDimension
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** Open the focus view on a record (double click, or F). */
  onFocus: (id: string) => void
  /** Highlights the answer to a query, mapped onto the records that are drawn. */
  result?: QueryResult | null
  showAllLabels?: boolean
  className?: string
}

const GROUP_LABEL_SIZE = 11.5
const LABEL_SIZE = 11
const MAX_GROUP_LABEL = 190
/** At most this many unfolded records round a host; the rest are in the detail panel. */
const MAX_SATELLITES = 48
/**
 * Folded-count badges appear once a record has this much room on screen —
 * spacing times zoom. Below it a 10px number beside a 5px dot is a speck,
 * which is what the demo store's overview showed; the count is in every
 * record's name either way.
 */
const BADGE_MIN_CELL = 30
const BADGE_SIZE = 10
/** Labelling every record considers at most this many on screen at once. */
const EVERY_LABEL_CAP = 600

export function OverviewCanvas({
  viewGraph,
  folding,
  by,
  selectedId,
  onSelect,
  onFocus,
  result = null,
  showAllLabels = false,
  className,
}: Props) {
  const { t, i18n } = useTranslation('graph')
  const frameRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const size = useBoxSize(frameRef, { width: 960, height: 560 })
  const reduced = useReducedMotion()
  const rtl = i18n.dir() === 'rtl'
  const language = i18n.language
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [keyId, setKeyId] = useState<string | null>(null)

  const byId = useMemo(() => new Map(viewGraph.nodes.map((n) => [n.id, n])), [viewGraph])

  /**
   * A group's label — "Postdoc · 100" — fitted to `budget` pixels by shortening
   * the NAME, never the count. The budget is a share of the box, so on a phone
   * a long role name gives way ("Assistant Prof… · 100") instead of reserving
   * room that shrinks every circle to a dot. The whole name is in the group's
   * accessible name either way.
   */
  const labelBudget = Math.min(MAX_GROUP_LABEL, Math.max(112, size.width * 0.34))
  const nameOf = useCallback(
    (key: string, count: number) => {
      const tail = ` · ${count.toLocaleString(intlLocale(language))}`
      const name = groupName(key, by, t)
      const room = labelBudget - estimateWidth(tail, GROUP_LABEL_SIZE) - 8
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
      width: size.width,
      height: size.height,
      folding,
      order: memberOrder,
      groupOrder: groupOrderOf(by),
      labelHeight: GROUP_LABEL_SIZE + 8,
      labelWidth: (key, count) =>
        Math.min(labelBudget, estimateWidth(nameOf(key, count), GROUP_LABEL_SIZE) + 8),
      margin: 14,
    })
    if (!rtl) return placed
    // Mirrored in Arabic and Urdu: stages then read right to left like the
    // board does, and the loose strip starts at the reading edge, its label
    // (anchored at `start`) running leftward from it.
    const mirror = (x: number) => size.width - x
    const positions = new Map<string, Point>()
    for (const [id, p] of placed.positions) positions.set(id, { x: mirror(p.x), y: p.y })
    return {
      ...placed,
      positions,
      groups: placed.groups.map((g) => ({ ...g, x: mirror(g.x), labelX: mirror(g.labelX) })),
    }
  }, [viewGraph, folding, by, size, nameOf, rtl, labelBudget])

  const zoom = useZoom({ svgRef, box: size, reduced, resetKey: layout })
  const { view } = zoom
  const toScreen = useCallback(
    (p: Point): Point => ({ x: p.x * view.k + view.x, y: p.y * view.k + view.y }),
    [view],
  )
  const onScreen = useCallback(
    (p: Point, pad = 0) =>
      p.x >= -pad && p.x <= size.width + pad && p.y >= -pad && p.y <= size.height + pad,
    [size],
  )

  /** A record's drawn radius in layout units: from the spacing, hubs a little larger. */
  const radius = useMemo(() => {
    const base = Math.max(2.4, Math.min(7, layout.cell * 0.34))
    return (type: string) =>
      type === 'application' || type === 'background'
        ? base
        : Math.min(base * 1.35, layout.cell * 0.48)
  }, [layout.cell])

  const join = useMemo(() => listJoiner(language), [language])
  const typeOf = useCallback((id: string) => byId.get(id)?.type, [byId])
  /*
   * Names for thousands of marks, cached. A store's records share a handful of
   * shapes ("2 timeline items, 1 organisation and 1 file", "5 connections"),
   * so each distinct phrase is worded once: measured on 3,000 applications,
   * uncached naming was ~600ms of the page's first render, all in i18next.
   */
  const words = useMemo(() => {
    const cache = new Map<string, string>()
    const once = (key: string, make: () => string) => {
      let hit = cache.get(key)
      if (hit === undefined) {
        hit = make()
        cache.set(key, hit)
      }
      return hit
    }
    return {
      connections: (count: number) => once(`c${count}`, () => t('common.connections', { count })),
      folded: (summary: readonly { type: string; count: number }[]) =>
        once(`f${summary.map((s) => `${s.type}:${s.count}`).join('|')}`, () =>
          foldedPhrase(summary, (type, count) => t(`view.folded.${type}`, { count }), join),
        ),
    }
  }, [t, join])

  const foldedText = useCallback(
    (id: string) => words.folded(foldedSummary(folding, typeOf, id, TYPE_ORDER)),
    [folding, typeOf, words],
  )

  const ariaOf = useCallback(
    (node: ViewNode) => {
      const connections = words.connections(adjacency(viewGraph).get(node.id)?.length ?? 0)
      const base = { label: node.label, type: typeLabel(node.type), connections }
      const folded = folding.folded.get(node.id)
      return folded && folded.length > 0
        ? t('view.node.folded', { ...base, folded: foldedText(node.id) })
        : t('node.label', base)
    },
    [viewGraph, folding, foldedText, words, t],
  )

  /** Where each record sits in its group, for arrow keys. */
  const seat = useMemo(() => {
    const map = new Map<string, { group: number; at: number }>()
    layout.groups.forEach((group, g) => {
      group.members.forEach((id, at) => map.set(id, { group: g, at }))
    })
    return map
  }, [layout])

  /* ------------------------------ static layer ----------------------------- */

  const staticLayer = useMemo(
    () => (
      <g>
        {layout.groups.map((group) => {
          const loose = group.key === GROUP_LOOSE
          const count = group.anchors || group.members.length
          return (
            <g
              key={group.key}
              role="group"
              aria-label={t('view.group.label', {
                name: groupName(group.key, by, t),
                records: t('common.records', { count }),
              })}
            >
              {loose ? null : (
                <circle
                  className="ov-disc"
                  cx={group.x}
                  cy={group.y}
                  r={group.r}
                  fill="var(--panel)"
                  stroke="var(--hairline)"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {loose ? (
                <LooseMark
                  x={group.x}
                  y={group.y}
                  r={6}
                  label={t('view.group.label', {
                    name: groupName(GROUP_LOOSE, by, t),
                    records: t('common.records', { count: folding.loose.length }),
                  })}
                />
              ) : (
                group.members.map((id, at) => {
                  const node = byId.get(id)
                  const p = layout.positions.get(id)
                  if (!node || !p) return null
                  return (
                    <Mark
                      key={id}
                      node={node}
                      x={p.x}
                      y={p.y}
                      r={radius(node.type)}
                      tabbable={at === 0}
                      label={ariaOf(node)}
                    />
                  )
                })
              )}
            </g>
          )
        })}
      </g>
    ),
    [layout, byId, folding, by, t, radius, ariaOf],
  )

  /* -------------------------------- lighting -------------------------------- */

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

  const active = hoverId ?? keyId ?? selectedId
  const host = active ? (hostOf(folding, active) ?? null) : null
  const hostAt = host ? layout.positions.get(host) : undefined

  const lit = useMemo(() => {
    if (host && host !== GROUP_LOOSE) {
      return new Set([host, ...(visibleAdj.get(host) ?? [])])
    }
    if (host === GROUP_LOOSE) return new Set([GROUP_LOOSE])
    if (result && result.nodes.size > 0) {
      const set = new Set<string>()
      for (const id of result.nodes) {
        const at = hostOf(folding, id)
        if (at) set.add(at)
      }
      return set
    }
    return null
  }, [host, visibleAdj, result, folding])

  // The marks by id, for roving focus and `aria-pressed`, which are written
  // straight onto them so neither re-renders the thousands of marks.
  const markEls = useRef(new Map<string, Element>())
  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const map = new Map<string, Element>()
    for (const el of svg.querySelectorAll('[data-layer="static"] [data-id]')) {
      const id = el.getAttribute('data-id')
      if (id) map.set(id, el)
    }
    markEls.current = map
  }, [staticLayer])

  /*
   * Dimming is ONE opacity on the whole static layer, and what is lit is drawn
   * again on top of it in the screen layer. Measured on 3,000 marks, an opacity
   * per mark (the free layout's way) cost 100–200ms of paint per hover, because
   * every translucent group is composited on its own; one translucent layer is
   * composited once.
   */
  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    if (lit) svg.setAttribute('data-dim', '')
    else svg.removeAttribute('data-dim')
  }, [lit])

  useLayoutEffect(() => {
    const els = markEls.current
    for (const [id, el] of els) {
      const pressed = id === selectedId
      if ((el.getAttribute('aria-pressed') === 'true') !== pressed) {
        el.setAttribute('aria-pressed', String(pressed))
      }
    }
  }, [selectedId, staticLayer])

  // A record that left the graph cannot stay hovered or focused.
  useEffect(() => {
    setHoverId((id) => (id && (byId.has(id) || id === GROUP_LOOSE) ? id : null))
    setKeyId((id) => (id && (byId.has(id) || id === GROUP_LOOSE) ? id : null))
  }, [byId])

  // Zoomed in, keyboard focus or a selection made elsewhere (the detail panel,
  // a search arrival) pans the record into view rather than off-screen.
  const { ensureVisible } = zoom
  const follow = keyId ?? selectedId
  useEffect(() => {
    if (!follow) return
    const at = hostOf(folding, follow)
    const p = at ? layout.positions.get(at) : undefined
    if (p) ensureVisible(p)
  }, [follow, folding, layout, ensureVisible])

  /* ------------------------------ screen layer ------------------------------ */

  /** The unfolded records round the active host, seated in screen pixels. */
  const unfolded = useMemo(() => {
    if (!host || host === GROUP_LOOSE || !hostAt) return null
    const centre = toScreen(hostAt)
    const children = (folding.folded.get(host) ?? []).slice(0, MAX_SATELLITES)
    if (children.length === 0)
      return { centre, children, seats: new Map<string, Point>(), reach: 0 }
    const r = radius(byId.get(host)?.type ?? '') * view.k
    const spacing = Math.max(22, r * 3)
    const points = satellites(children.length, centre, { radius: r + 4, spacing })
    const seats = new Map<string, Point>()
    children.forEach((id, i) => {
      const p = points[i]
      if (p) seats.set(id, clampTo(p, size, 8))
    })
    // How far the unfolded ring reaches, so the host's own name goes below it.
    let reach = 0
    for (const p of seats.values())
      reach = Math.max(reach, Math.hypot(p.x - centre.x, p.y - centre.y))
    return { centre, children, seats, reach }
  }, [host, hostAt, folding, radius, byId, size, toScreen, view.k])

  const overlay = useMemo(() => {
    const lines: { key: string; a: Point; b: Point }[] = []
    const candidates: LabelCandidate[] = []
    const k = view.k
    const posOf = (id: string) => {
      const seatAt = unfolded?.seats.get(id)
      if (seatAt) return seatAt
      const p = layout.positions.get(id)
      return p ? toScreen(p) : undefined
    }

    if (host && host !== GROUP_LOOSE && unfolded) {
      const centre = unfolded.centre
      for (const other of visibleAdj.get(host) ?? []) {
        const p = posOf(other)
        if (p) lines.push({ key: `${host}>${other}`, a: centre, b: p })
      }
      for (const child of unfolded.children) {
        const seatAt = unfolded.seats.get(child)
        const parent = folding.parent.get(child)
        const from = (parent === undefined ? undefined : posOf(parent)) ?? centre
        if (seatAt) lines.push({ key: `${child}<`, a: from, b: seatAt })
      }
      const hostNode = byId.get(host)
      if (hostNode) {
        candidates.push({
          id: host,
          x: centre.x,
          y: centre.y,
          r: Math.max(radius(hostNode.type) * k + 2, unfolded.reach + 6),
          text: truncateLabel(hostNode.label, 36),
          rank: 100,
          placement: 'below',
          size: 12,
        })
      }
      for (const other of visibleAdj.get(host) ?? []) {
        const p = posOf(other)
        const node = byId.get(other)
        if (p && node) {
          candidates.push({
            id: other,
            x: p.x,
            y: p.y,
            r: radius(node.type) * k,
            text: truncateLabel(node.label),
            rank: 50,
            placement: 'below',
          })
        }
      }
      if (unfolded.children.length <= 16) {
        for (const child of unfolded.children) {
          const p = unfolded.seats.get(child)
          const node = byId.get(child)
          if (p && node) {
            candidates.push({
              id: child,
              x: p.x,
              y: p.y,
              r: 5,
              text: truncateLabel(node.label, 22),
              rank: 20,
              placement: p.x >= centre.x ? 'start' : 'end',
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
            r: radius(node.type) * k,
            text: truncateLabel(node.label),
            rank: 10,
            placement: 'below',
          })
        }
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
          r: radius(node.type) * k + 2,
          text: truncateLabel(node.label, 36),
          rank: 90,
          placement: 'below',
          size: 12,
        })
      }
    }
    const labels = pickLabels(candidates, { rtl, limit: 80, bounds: size })
    return { lines, labels }
  }, [
    host,
    unfolded,
    visibleAdj,
    layout,
    folding,
    byId,
    radius,
    lit,
    selectedId,
    rtl,
    size,
    toScreen,
    onScreen,
    view.k,
  ])

  /** Group names, in screen pixels just above each disc, while the disc is on screen. */
  const groupLabels = useMemo(
    () =>
      layout.groups.flatMap((group) => {
        const loose = group.key === GROUP_LOOSE
        const count = group.anchors || group.members.length
        const anchor = loose
          ? toScreen({ x: group.labelX, y: group.labelY })
          : { x: group.x * view.k + view.x, y: (group.y - group.r) * view.k + view.y - 5 }
        if (!onScreen(anchor, 40)) return []
        return [
          {
            key: group.key,
            x: anchor.x,
            y: anchor.y,
            anchor: group.labelAnchor,
            text: loose
              ? `${groupName(group.key, by, t)} · ${count.toLocaleString(intlLocale(language))}`
              : nameOf(group.key, count),
          },
        ]
      }),
    [layout, view, toScreen, onScreen, by, t, language, nameOf],
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
      const r = radius(byId.get(id)?.type ?? '') * view.k
      out.push({ id, x: p.x + r + 2, y: p.y - r + 2, n: list.length })
      if (out.length >= 400) break
    }
    return out
  }, [layout, folding, view.k, toScreen, onScreen, radius, byId])

  /** Every name that fits, when "Label every record" is on — of the records on screen. */
  const everyLabel = useMemo(() => {
    if (!showAllLabels) return null
    const candidates: LabelCandidate[] = []
    for (const [id, at] of layout.positions) {
      const node = byId.get(id)
      if (!node) continue
      const p = toScreen(at)
      if (!onScreen(p)) continue
      candidates.push({
        id,
        x: p.x,
        y: p.y,
        r: radius(node.type) * view.k,
        text: truncateLabel(node.label, 20),
        rank: node.type === 'application' ? 1 : 2,
        placement: 'below',
        size: 9.5,
      })
      if (candidates.length >= EVERY_LABEL_CAP) break
    }
    return pickLabels(candidates, { rtl, bounds: size })
  }, [showAllLabels, layout, byId, radius, rtl, size, toScreen, onScreen, view.k])

  const selectedPos = selectedId
    ? (unfolded?.seats.get(selectedId) ??
      (layout.positions.get(selectedId)
        ? toScreen(layout.positions.get(selectedId) as Point)
        : undefined))
    : undefined
  const hostFoldedText = host && host !== GROUP_LOOSE && hostAt ? foldedText(host) : ''

  /* --------------------------------- events --------------------------------- */

  const idAt = (target: EventTarget | null) =>
    target instanceof Element
      ? (target.closest('[data-id]')?.getAttribute('data-id') ?? null)
      : null

  const moveWithin = (from: string, delta: number | 'first' | 'last') => {
    const at = seat.get(from)
    if (!at) return
    const members = layout.groups[at.group]?.members ?? []
    const next =
      delta === 'first'
        ? 0
        : delta === 'last'
          ? members.length - 1
          : Math.max(0, Math.min(members.length - 1, at.at + delta))
    const id = members[next]
    if (!id || id === from) return
    const fromEl = markEls.current.get(from)
    const toEl = markEls.current.get(id) as SVGGElement | undefined
    fromEl?.setAttribute('tabindex', '-1')
    toEl?.setAttribute('tabindex', '0')
    toEl?.focus()
  }

  /**
   * Tab into and out of the unfolded ring. The satellites are drawn after the
   * static layer, so in DOM order Tab from their host went to the next group's
   * mark first — and focusing that moved the ring, so the satellites vanished
   * before they could be reached. Tab from a host with a ring enters it; Tab
   * from its last satellite goes on to the stop after the host; Shift+Tab from
   * the first returns to the host. True when this handled the key.
   */
  const tabThroughRing = (target: EventTarget, id: string, back: boolean) => {
    const svg = svgRef.current
    if (!svg || !host || host === GROUP_LOOSE || !(target instanceof Element)) return false
    const ring = [...svg.querySelectorAll<SVGGElement>('[data-layer="satellites"] [data-id]')]
    if (ring.length === 0) return false
    const hostEl = markEls.current.get(host) as SVGGElement | undefined
    const onRing = target.closest('[data-layer="satellites"]') !== null
    if (!onRing) {
      if (back || id !== host) return false
      ring[0]?.focus()
      return true
    }
    const at = ring.findIndex((el) => el.contains(target))
    if (back && at === 0 && hostEl) {
      hostEl.focus()
      return true
    }
    if (!back && at === ring.length - 1 && hostEl) {
      const next = [
        ...svg.querySelectorAll<SVGGElement>('[data-layer="static"] [tabindex="0"]'),
      ].find((el) => (hostEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0)
      if (!next) return false
      next.focus()
      return true
    }
    return false
  }

  return (
    <div
      ref={frameRef}
      className={cn('relative h-full w-full', className)}
      // The zoom keys, on the frame so they work wherever focus is inside it:
      // on a record, on the canvas itself, or on the zoom buttons.
      onKeyDown={(event) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return
        if (event.key === '+' || event.key === '=') {
          event.preventDefault()
          zoom.zoomIn()
        } else if (event.key === '-' || event.key === '_') {
          event.preventDefault()
          zoom.zoomOut()
        } else if (event.key === '0') {
          event.preventDefault()
          zoom.fit()
        }
      }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${size.width} ${size.height}`}
        role="group"
        // Focusable by a click, not by Tab: so + − 0 work after a click on the
        // background, not only once a record has focus.
        tabIndex={-1}
        aria-label={t('view.overviewLabel', {
          groups: t('view.groups', { count: layout.groups.length }),
          records: t('common.records', { count: viewGraph.nodes.length }),
        })}
        className={cn(
          'graph-overview h-full w-full outline-none select-none',
          // At fit there is nothing to pan, so a one-finger swipe scrolls the
          // page (on a phone the canvas is most of the screen); zoomed in, a
          // drag is a pan. A pinch at fit is claimed by use-zoom's touchmove.
          view.k > 1 ? 'touch-none' : 'touch-pan-y',
          view.k > 1 && 'cursor-grab active:cursor-grabbing',
        )}
        {...zoom.handlers}
        onPointerOver={(event) => {
          const id = idAt(event.target)
          setHoverId((current) => (current === id ? current : id))
        }}
        onPointerLeave={() => setHoverId(null)}
        onFocus={(event) => setKeyId(idAt(event.target))}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setKeyId(null)
        }}
        onClick={(event) => {
          // A press that panned or pinched is not also a click.
          if (zoom.consumeDrag()) return
          const id = idAt(event.target)
          if (id) onSelect(id === selectedId ? null : id)
          else onSelect(null)
        }}
        onDoubleClick={(event) => {
          const id = idAt(event.target)
          if (id && id !== GROUP_LOOSE) onFocus(id)
        }}
        onKeyDown={(event) => {
          const id = idAt(event.target)
          if (!id) return
          if (event.key === 'Tab' && tabThroughRing(event.target, id, event.shiftKey)) {
            event.preventDefault()
            return
          }
          const forward = rtl ? 'ArrowLeft' : 'ArrowRight'
          const back = rtl ? 'ArrowRight' : 'ArrowLeft'
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onSelect(id === selectedId ? null : id)
          } else if ((event.key === 'f' || event.key === 'F') && id !== GROUP_LOOSE) {
            event.preventDefault()
            onFocus(id)
          } else if (event.key === forward || event.key === 'ArrowDown') {
            event.preventDefault()
            moveWithin(id, 1)
          } else if (event.key === back || event.key === 'ArrowUp') {
            event.preventDefault()
            moveWithin(id, -1)
          } else if (event.key === 'Home') {
            event.preventDefault()
            moveWithin(id, 'first')
          } else if (event.key === 'End') {
            event.preventDefault()
            moveWithin(id, 'last')
          }
        }}
      >
        <desc>{t('view.overviewDescription')}</desc>

        <g
          data-layer="static"
          transform={`translate(${view.x.toFixed(2)} ${view.y.toFixed(2)}) scale(${view.k.toFixed(4)})`}
        >
          {staticLayer}
        </g>

        <g aria-hidden className="ov-group-labels" style={{ pointerEvents: 'none' }}>
          {groupLabels.map((label) => (
            <text
              key={label.key}
              x={label.x}
              y={label.y}
              textAnchor={label.anchor}
              fill="var(--text-2)"
              style={{ fontSize: GROUP_LABEL_SIZE, fontWeight: 500 }}
            >
              {label.text}
            </text>
          ))}
          {badges.map((badge) => (
            <text
              key={badge.id}
              x={badge.x}
              y={badge.y}
              fill="var(--text-3)"
              style={{ fontSize: BADGE_SIZE }}
            >
              {badge.n}
            </text>
          ))}
        </g>

        {everyLabel ? (
          <g aria-hidden style={{ pointerEvents: 'none' }}>
            {everyLabel.map((label) => (
              <text
                key={label.id}
                x={label.tx}
                y={label.ty}
                textAnchor={label.anchor}
                className="ov-label"
                style={{ fontSize: label.size }}
              >
                {label.text}
              </text>
            ))}
          </g>
        ) : null}

        {/* Lines first, so they run under the marks they join. */}
        <g aria-hidden style={{ pointerEvents: 'none' }}>
          {overlay.lines.map((line) => (
            <line
              key={line.key}
              x1={line.a.x}
              y1={line.a.y}
              x2={line.b.x}
              y2={line.b.y}
              stroke="var(--text-3)"
              strokeWidth={1.2}
              opacity={0.75}
            />
          ))}
        </g>

        {/* The lit marks, drawn again at full strength above the dimmed layer.
            Pictures only: pointer and keyboard still reach the real marks
            underneath, which keep their names and their place in Tab order. */}
        {lit ? (
          <g aria-hidden style={{ pointerEvents: 'none' }}>
            {[...lit].map((id) => {
              if (id === GROUP_LOOSE) {
                const group = layout.groups.find((g) => g.key === GROUP_LOOSE)
                if (!group) return null
                const at = toScreen(group)
                const labelAt = toScreen({ x: group.labelX, y: group.labelY })
                return (
                  <g key={id}>
                    <StackGlyph x={at.x} y={at.y} r={6 * view.k} />
                    <text
                      x={labelAt.x}
                      y={labelAt.y}
                      textAnchor={group.labelAnchor}
                      fill="var(--text-1)"
                      style={{ fontSize: GROUP_LABEL_SIZE, fontWeight: 500 }}
                    >
                      {`${groupName(GROUP_LOOSE, by, t)} · ${group.anchors.toLocaleString(intlLocale(language))}`}
                    </text>
                  </g>
                )
              }
              const at = layout.positions.get(id)
              const node = byId.get(id)
              if (!at || !node) return null
              const p = toScreen(at)
              if (!onScreen(p, 20)) return null
              return (
                <g key={id} transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}>
                  <NodeGlyph
                    type={node.type as GraphNodeType}
                    r={radius(node.type) * view.k}
                    stroke="var(--panel)"
                  />
                </g>
              )
            })}
          </g>
        ) : null}

        {unfolded && unfolded.children.length > 0 ? (
          <g data-layer="satellites">
            {unfolded.children.map((id) => {
              const p = unfolded.seats.get(id)
              const node = byId.get(id)
              if (!p || !node) return null
              return (
                <g
                  key={id}
                  data-id={id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selectedId === id}
                  aria-label={ariaOf(node)}
                  transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}
                  className="ov-node cursor-pointer"
                >
                  <title>{node.label}</title>
                  <NodeGlyph type={node.type as GraphNodeType} r={4.5} stroke="var(--panel)" />
                </g>
              )
            })}
          </g>
        ) : null}

        {selectedPos ? (
          <circle
            aria-hidden
            cx={selectedPos.x}
            cy={selectedPos.y}
            r={
              (unfolded?.seats.has(selectedId ?? '')
                ? 4.5
                : radius(byId.get(selectedId ?? '')?.type ?? '') * view.k) + 4.5
            }
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
            style={{ pointerEvents: 'none' }}
          />
        ) : null}

        <g aria-hidden style={{ pointerEvents: 'none' }}>
          {overlay.labels.map((label) => (
            <text
              key={label.id}
              x={label.tx}
              y={label.ty}
              textAnchor={label.anchor}
              className="ov-label"
              style={{
                fontSize: label.size ?? LABEL_SIZE,
                fontWeight: label.rank >= 90 ? 600 : 400,
              }}
            >
              {label.text}
              {label.id === host && hostFoldedText ? (
                <tspan x={label.tx} dy="1.25em" className="ov-label-sub">
                  {hostFoldedText}
                </tspan>
              ) : null}
            </text>
          ))}
        </g>
      </svg>

      <ZoomControls
        zoomed={view.k > 1.001}
        atMax={view.k >= MAX_ZOOM - 0.001}
        onIn={zoom.zoomIn}
        onOut={zoom.zoomOut}
        onFit={zoom.fit}
      />
    </div>
  )
}

const typeLabel = (type: string) => NODE_TYPE_LABEL[type as GraphNodeType] ?? type

const clampTo = (p: Point, box: { width: number; height: number }, pad: number): Point => ({
  x: Math.max(pad, Math.min(box.width - pad, p.x)),
  y: Math.max(pad, Math.min(box.height - pad, p.y)),
})
