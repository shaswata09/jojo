import { intlLocale } from '@jojo/service/core/intl-locale'
import { MORE_PREFIX, adjacency, countTypes, focusLayout } from '@jojo/service/core/graph-view'
import type { ViewGraph, ViewNode } from '@jojo/service/core/graph-view'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GraphNodeType } from '@/lib/graph/model'
import { NODE_TYPE_LABEL } from '@/lib/graph/model'
import type { QueryResult } from '@/lib/graph/query'
import { TYPE_ORDER, foldedPhrase, listJoiner, memberOrder } from '@/lib/graph/view'
import { cn } from '@/lib/utils'
import { NodeGlyph } from './NodeGlyph'
import { estimateWidth, pickLabels, truncateLabel } from './canvas/pick-labels'
import type { LabelCandidate } from './canvas/pick-labels'
import { useBoxSize } from './canvas/use-box-size'

/**
 * One record at the centre, what it links to on the first ring, what those
 * link to on the second — `focusLayout` from `kg/core/graph-view.ts`.
 *
 * Folded records are unfolded here: this view is drawn from the whole (legend-
 * filtered) graph, not the folded one, because "what is this connected to" is
 * the question folding hid the answer to. At most a few hundred records, so it
 * renders plainly through React; nothing moves on its own, so there is nothing
 * for reduced motion to stop.
 *
 * Every record is a focusable, named button, in ring order. Enter selects it,
 * F re-centres on it, E expands it (its own links one ring further out).
 */

type Props = {
  viewGraph: ViewGraph
  centreId: string
  expanded: ReadonlySet<string>
  selectedId: string | null
  onSelect: (id: string | null) => void
  onFocus: (id: string) => void
  onExpand: (id: string) => void
  result?: QueryResult | null
  showAllLabels?: boolean
  className?: string
}

export function FocusCanvas({
  viewGraph,
  centreId,
  expanded,
  selectedId,
  onSelect,
  onFocus,
  onExpand,
  result = null,
  showAllLabels = false,
  className,
}: Props) {
  const { t, i18n } = useTranslation('graph')
  const frameRef = useRef<HTMLDivElement>(null)
  const size = useBoxSize(frameRef, { width: 960, height: 560 })
  const rtl = i18n.dir() === 'rtl'
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [keyId, setKeyId] = useState<string | null>(null)

  const byId = useMemo(() => new Map(viewGraph.nodes.map((n) => [n.id, n])), [viewGraph])

  const layout = useMemo(
    () =>
      focusLayout(viewGraph, centreId, {
        width: size.width,
        height: size.height,
        expanded,
        order: memberOrder,
        maxNodes: size.width < 600 ? 160 : 300,
        // On a phone the labels room would take most of the width.
        margin: size.width < 600 ? 24 : 56,
      }),
    [viewGraph, centreId, expanded, size],
  )

  const active = hoverId ?? keyId

  /** How many drawn records hang off each record, for thinning a hub's spokes. */
  const family = useMemo(() => {
    const map = new Map<string, number>()
    for (const parent of layout.parentOf.values()) map.set(parent, (map.get(parent) ?? 0) + 1)
    return map
  }, [layout])
  const ids = useMemo(() => [...layout.positions.keys()], [layout])

  const radiusOf = useCallback(
    (id: string) => {
      const hop = layout.hop.get(id) ?? 2
      const scale = Math.max(0.6, Math.min(1, layout.cell / 24))
      return (hop === 0 ? 12 : hop === 1 ? 7 : 5) * scale
    },
    [layout],
  )

  const litEdges = useMemo(() => {
    if (!active) return null
    return new Set(
      layout.edges
        .filter((e) => e.from === active || e.to === active)
        .map((e) => `${e.from}|${e.to}|${e.rel}`),
    )
  }, [active, layout])
  const litNodes = useMemo(() => {
    if (active) {
      const set = new Set([active])
      for (const e of layout.edges) {
        if (e.from === active) set.add(e.to)
        if (e.to === active) set.add(e.from)
      }
      return set
    }
    if (result && result.nodes.size > 0)
      return new Set([...result.nodes].filter((id) => layout.positions.has(id)))
    return null
  }, [active, layout, result])

  /** "99 applications", for a hub drawn without its neighbours. Worded once per hub. */
  const join = useMemo(() => listJoiner(i18n.language), [i18n.language])
  const hubText = useMemo(() => {
    const typeOf = (id: string) => byId.get(id)?.type
    const map = new Map<string, string>()
    for (const [hub, hidden] of layout.collapsed) {
      map.set(
        hub,
        foldedPhrase(
          countTypes(hidden, typeOf, TYPE_ORDER),
          (type, count) => t(`view.folded.${type}`, { count }),
          join,
        ),
      )
    }
    return map
  }, [layout, byId, t, join])

  /**
   * Which way a name runs: away from the centre. Sideways where the record
   * sits to the side of it, above or below where it sits above or below — so
   * the names in a fan's lower half hang under their marks instead of being
   * written back across the lines.
   */
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

  /*
   * Every record offers its name and the label picker decides which fit; the
   * rest appear on hover or focus, because a lit record outranks the others.
   * A hub drawn closed carries its count in its name — "Researcher · 99
   * applications" — since that is the one thing on the picture saying what
   * it stands for.
   */
  const labels = useMemo(() => {
    const candidates: LabelCandidate[] = []
    for (const id of ids) {
      const p = layout.positions.get(id)
      const node = byId.get(id)
      if (!p || !node) continue
      const hop = layout.hop.get(id) ?? 0
      const counted = hubText.get(id)
      candidates.push({
        id,
        x: p.x,
        y: p.y,
        r: radiusOf(id),
        text: counted
          ? `${truncateLabel(node.label, 24)} · ${counted}`
          : truncateLabel(node.label, hop === 0 ? 40 : 26),
        rank:
          id === centreId
            ? 1000
            : id === selectedId
              ? 900
              : litNodes?.has(id)
                ? 500 - hop
                : counted
                  ? 300
                  : (showAllLabels ? 200 : 100) - hop * 10,
        placement: outward(p, hop),
        size: hop === 0 ? 13 : 11,
      })
    }
    // Names keep off the marks as well as off each other.
    const blocked = ids.flatMap((id) => {
      const p = layout.positions.get(id)
      if (!p) return []
      const r = id.startsWith(MORE_PREFIX) ? 10 : radiusOf(id) + 1
      return [{ left: p.x - r, right: p.x + r, top: p.y - r, bottom: p.y + r }]
    })
    return pickLabels(candidates, { rtl, bounds: size, blocked })
  }, [
    ids,
    layout,
    byId,
    showAllLabels,
    litNodes,
    selectedId,
    centreId,
    rtl,
    radiusOf,
    size,
    hubText,
    outward,
  ])

  useEffect(() => {
    setHoverId((id) => (id && layout.positions.has(id) ? id : null))
    setKeyId((id) => (id && layout.positions.has(id) ? id : null))
  }, [layout])

  const nameOf = (node: ViewNode) => {
    const connections = t('common.connections', {
      count: adjacency(viewGraph).get(node.id)?.length ?? 0,
    })
    const base = {
      label: node.label,
      type: NODE_TYPE_LABEL[node.type as GraphNodeType] ?? node.type,
      connections,
    }
    const counted = hubText.get(node.id)
    return counted ? t('view.node.hub', { ...base, folded: counted }) : t('node.label', base)
  }

  /** A "+N more" item stands for its hub: selecting it selects the hub, whose panel lists them all. */
  const idAt = (target: EventTarget | null) => {
    const id =
      target instanceof Element
        ? (target.closest('[data-id]')?.getAttribute('data-id') ?? null)
        : null
    return id?.startsWith(MORE_PREFIX) ? (layout.more.get(id)?.hub ?? null) : id
  }

  const centre = byId.get(centreId)

  return (
    <div ref={frameRef} className={cn('relative h-full w-full', className)}>
      {layout.omitted > 0 ? (
        <p
          role="status"
          className="pointer-events-none absolute start-2 top-2 z-10 rounded-md border border-hairline bg-panel px-2 py-1 text-xs text-text-2"
        >
          {t('view.more', {
            count: layout.omitted,
            formatted: layout.omitted.toLocaleString(intlLocale(i18n.language)),
          })}
        </p>
      ) : null}
      <svg
        viewBox={`0 0 ${size.width} ${size.height}`}
        role="group"
        aria-label={t('view.focusLabel', {
          label: centre?.label ?? '',
          records: t('common.records', { count: ids.length }),
        })}
        className="h-full w-full touch-none select-none"
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
          const id = idAt(event.target)
          if (id) onSelect(id === selectedId ? null : id)
          else onSelect(null)
        }}
        onDoubleClick={(event) => {
          const id = idAt(event.target)
          if (id && id !== centreId) onFocus(id)
        }}
        onKeyDown={(event) => {
          const id = idAt(event.target)
          if (!id) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onSelect(id === selectedId ? null : id)
          } else if ((event.key === 'f' || event.key === 'F') && id !== centreId) {
            event.preventDefault()
            onFocus(id)
          } else if ((event.key === 'e' || event.key === 'E') && id !== centreId) {
            event.preventDefault()
            onExpand(id)
          }
        }}
      >
        <desc>{t('view.focusDescription')}</desc>

        <g aria-hidden style={{ pointerEvents: 'none' }}>
          {layout.rings.slice(0, 1).map((ring) => (
            <circle
              key={ring.hop}
              cx={layout.x}
              cy={layout.y}
              r={ring.r}
              fill="none"
              stroke="var(--hairline)"
              strokeDasharray="3 5"
            />
          ))}
        </g>

        <g aria-hidden style={{ pointerEvents: 'none' }}>
          {layout.edges.map((edge) => {
            const a = layout.positions.get(edge.from)
            const b = layout.positions.get(edge.to)
            if (!a || !b) return null
            const key = `${edge.from}|${edge.to}|${edge.rel}`
            const on = litEdges?.has(key) ?? false
            const tree =
              layout.parentOf.get(edge.to) === edge.from ||
              layout.parentOf.get(edge.from) === edge.to
            // An opened hub's dozens of spokes are context, not content: the
            // fan's shape already says what hangs off it.
            const crowd = (family.get(edge.from) ?? 0) > 12 || (family.get(edge.to) ?? 0) > 12
            return (
              <line
                key={key}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={on ? 'var(--text-2)' : 'var(--hairline-strong)'}
                strokeWidth={on ? 1.4 : 1}
                opacity={
                  litEdges
                    ? on
                      ? 0.95
                      : 0.12
                    : crowd
                      ? 0.16
                      : tree
                        ? Math.max(layout.hop.get(edge.from) ?? 0, layout.hop.get(edge.to) ?? 0) <=
                          1
                          ? 0.7
                          : 0.3
                        : 0.15
                }
              />
            )
          })}
          {[...layout.more.entries()].map(([id, { hub }]) => {
            const a = layout.positions.get(hub)
            const b = layout.positions.get(id)
            return a && b ? (
              <line
                key={id}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="var(--hairline-strong)"
                strokeDasharray="2 3"
                opacity={0.6}
              />
            ) : null
          })}
        </g>

        <g>
          {ids.map((id) => {
            const p = layout.positions.get(id)
            const more = layout.more.get(id)
            if (p && more) {
              const count = more.ids.length
              const formatted = count.toLocaleString(intlLocale(i18n.language))
              const text = t('view.moreItem', { count, formatted })
              const w = estimateWidth(text, 10.5) + 14
              return (
                <g
                  key={id}
                  data-id={id}
                  role="button"
                  tabIndex={0}
                  aria-label={t('view.moreLabel', {
                    count,
                    formatted,
                    label: byId.get(more.hub)?.label ?? '',
                  })}
                  transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}
                  className="cursor-pointer"
                >
                  <rect
                    x={-w / 2}
                    y={-9}
                    width={w}
                    height={18}
                    rx={9}
                    fill="var(--panel)"
                    stroke="var(--hairline-strong)"
                  />
                  <text
                    y={3.5}
                    textAnchor="middle"
                    fill="var(--text-2)"
                    style={{ fontSize: 10.5, pointerEvents: 'none' }}
                  >
                    {text}
                  </text>
                </g>
              )
            }
            const node = byId.get(id)
            if (!p || !node) return null
            const r = radiusOf(id)
            const dim = litNodes !== null && !litNodes.has(id)
            return (
              <g
                key={id}
                data-id={id}
                role="button"
                tabIndex={0}
                aria-pressed={selectedId === id}
                aria-label={nameOf(node)}
                aria-expanded={id === centreId ? undefined : expanded.has(id)}
                transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}
                opacity={dim ? 0.3 : 1}
                className="cursor-pointer"
              >
                <title>{node.label}</title>
                {selectedId === id ? (
                  <circle r={r + 4.5} fill="none" stroke="var(--accent)" strokeWidth={2} />
                ) : null}
                <NodeGlyph type={node.type as GraphNodeType} r={r} stroke="var(--panel)" />
                {expanded.has(id) ? (
                  <circle r={r + 2.5} fill="none" stroke="var(--text-3)" strokeDasharray="2 2" />
                ) : null}
              </g>
            )
          })}
        </g>

        <g aria-hidden style={{ pointerEvents: 'none' }}>
          {labels.map((label) => (
            <text
              key={label.id}
              x={label.tx}
              y={label.ty}
              textAnchor={label.anchor}
              className="ov-label"
              style={{ fontSize: label.size, fontWeight: label.id === centreId ? 600 : 400 }}
            >
              {label.text}
            </text>
          ))}
        </g>
      </svg>
    </div>
  )
}
