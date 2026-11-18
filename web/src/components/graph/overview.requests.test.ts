/**
 * Owner request (2026-11-17): "/graph looks chaotic with a lot of data". The
 * approved redesign: fold single-link records into their parent, draw a large
 * store as labelled groups with no permanent edge mesh, open one record in a
 * focus view, and keep today's free layout for small stores.
 *
 * The rules themselves (folding, grouping, both layouts, the speed) are pinned
 * in `service/kg/core/graph-view.test.ts`. What is pinned here is this app's
 * use of them — the mode switch and its threshold, what may fold, the absence
 * of an edge mesh in the overview, and that every drawn record is named with
 * what is counted on it. Read off source where it is wiring (D20: no mounting).
 */

import { describe, expect, it } from 'vitest'
import { OVERVIEW_THRESHOLD, foldedSummary, wantsOverview } from '@jojo/service/core/graph-view'
import graphSource from '@/routes/Graph.tsx?raw'
import overviewSource from './OverviewCanvas.tsx?raw'
import focusSource from './FocusCanvas.tsx?raw'
import barSource from './GraphViewBar.tsx?raw'
import graphCanvasSource from './GraphCanvas.tsx?raw'
import nodeMarkSource from './canvas/NodeMark.tsx?raw'
import labelsSource from './canvas/labels.ts?raw'
import marksSource from './canvas/overview-marks.tsx?raw'
import zoomSource from './canvas/use-zoom.ts?raw'
import { MAX_ZOOM, clampView, zoomAbout } from './canvas/use-zoom'
import en from '@/i18n/locales/en/graph.json'
import { i18next } from '@/i18n/i18n'
import type { Graph, GraphEdge, GraphNode, GraphRel } from '@/lib/graph/model'
import {
  TYPE_ORDER,
  basePicture,
  foldGraph,
  foldedPhrase,
  groupName,
  groupOrderOf,
  listJoiner,
  toViewGraph,
} from '@/lib/graph/view'
import { GROUP_REST, GROUP_SINGLES } from '@jojo/service/core/graph-view'
import { STAGE_VALUES } from '@jojo/service/core/model'

/** A store of `n` applications, each with an employer, two dates and a file, under five roles. */
function store(n: number): Graph {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const add = (id: string, type: GraphNode['type'], label = id) =>
    nodes.push({ id, type, label, recordId: id, degree: 0 })
  const link = (from: string, to: string, rel: GraphRel) =>
    edges.push({ id: `${from}|${rel}|${to}`, from, to, rel })
  for (let r = 0; r < 5; r++) add(`role:${r}`, 'role', `Role ${r}`)
  for (let i = 0; i < n; i++) {
    add(`app:${i}`, 'application', `Employer ${i}`)
    link(`app:${i}`, `role:${i % 5}`, 'IS')
    add(`org:${i}`, 'organisation', `Employer ${i}`)
    link(`app:${i}`, `org:${i}`, 'AT')
    add(`item:${i}a`, 'item')
    add(`item:${i}b`, 'item')
    link(`item:${i}a`, `app:${i}`, 'ABOUT')
    link(`item:${i}b`, `app:${i}`, 'ABOUT')
    add(`file:${i}`, 'file')
    link(`file:${i}`, `app:${i}`, 'FILED_UNDER')
  }
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const incident = new Map<string, string[]>()
  for (const edge of edges) {
    for (const end of [edge.from, edge.to]) {
      incident.set(end, [...(incident.get(end) ?? []), edge.id])
      const node = byId.get(end)
      if (node) node.degree += 1
    }
  }
  return { nodes, edges, byId, edgeById: new Map(edges.map((e) => [e.id, e])), incident }
}

describe('the graph page picks its picture by size', () => {
  it('opens a large store on the overview and a small one on the free layout', () => {
    expect(OVERVIEW_THRESHOLD).toBe(150)
    // 140 applications + 5 roles = 145 drawn after folding: under the threshold.
    expect(wantsOverview(foldGraph(toViewGraph(store(140))))).toBe(false)
    expect(wantsOverview(foldGraph(toViewGraph(store(500))))).toBe(true)
  })

  it('chooses the mode from the folded size, and draws each mode with its own canvas', () => {
    expect(graphSource).toMatch(/const large = wantsOverview\(folding\)/)
    expect(graphSource).toMatch(/const base = basePicture\(layout, \{ large, freeAllowed \}\)/)
    expect(basePicture('auto', { large: true, freeAllowed: true })).toBe('overview')
    expect(basePicture('auto', { large: false, freeAllowed: true })).toBe('free')
    expect(graphSource).toMatch(/mode === 'free' \? \(\s*<GraphCanvas/)
    expect(graphSource).toContain('<FocusCanvas')
    expect(graphSource).toContain('<OverviewCanvas')
  })

  it('offers the free layout only while it can draw the whole graph', () => {
    expect(graphSource).toMatch(/const freeAllowed = view\.nodes\.length <= MAX_DRAWN/)
    expect(barSource).toMatch(/\.\.\.\(freeAllowed \? \[\{ value: 'free'/)
  })

  it('opens a query answer in focus outside the free layout', () => {
    expect(graphSource).toMatch(/onSelectNode=\{selectFromAnswer\}/)
    expect(graphSource).toMatch(/if \(mode !== 'free'\) focusOn\(id\)/)
  })
})

describe('folding on the graph page', () => {
  it('folds dates, files and employers into their application, never an application or a role', () => {
    const folding = foldGraph(toViewGraph(store(3)))
    expect(folding.visible.filter((id) => id.startsWith('app:'))).toEqual([
      'app:0',
      'app:1',
      'app:2',
    ])
    expect(folding.visible.filter((id) => id.startsWith('role:'))).toHaveLength(5)
    expect(folding.folded.get('app:0')).toEqual(['org:0', 'item:0a', 'item:0b', 'file:0'])
  })

  it('never folds the person’s own records into a count', () => {
    const graph = store(1)
    const me: GraphNode = {
      id: 'bg:1',
      type: 'background',
      label: 'PhD',
      recordId: 'bg:1',
      degree: 0,
    }
    const view = toViewGraph({ ...graph, nodes: [...graph.nodes, me] })
    const folding = foldGraph(view)
    expect(folding.visible).toContain('bg:1')
    expect(folding.loose).not.toContain('bg:1')
  })
})

describe('the overview draws no edge mesh', () => {
  it('draws lines only for the record pointed at or selected', () => {
    // The only <line> in the overview is the overlay's, built from the active
    // record's own links; no edge list of the graph is ever mapped to lines.
    expect(overviewSource.match(/<line\b/g)).toHaveLength(1)
    expect(overviewSource).toMatch(/\{overlay\.lines\.map\(\(line\) => \(\s*<line/)
    expect(overviewSource).not.toMatch(/(folding|viewGraph|graph)\.edges\.map\(/)
    expect(overviewSource).toMatch(/for \(const other of visibleAdj\.get\(host\) \?\? \[\]\)/)
  })

  it('dims with one attribute and redraws only what is lit, not every mark', () => {
    expect(overviewSource).toMatch(/if \(lit\) svg\.setAttribute\('data-dim', ''\)/)
    expect(overviewSource).toMatch(/\{\[\.\.\.lit\]\.map\(\(id\) => \{/)
    // The static layer is one memoised element: hover state is not among its inputs.
    const deps = /const staticLayer = useMemo\([\s\S]*?\n  \)\n/.exec(overviewSource)?.[0] ?? ''
    expect(deps).not.toBe('')
    expect(deps).not.toMatch(/hoverId|keyId|selectedId|\blit\b/)
  })
})

describe('every drawn record is named with what is counted on it', () => {
  it('names a host with its folded counts, in counted phrases joined as a list', async () => {
    await i18next.changeLanguage('en')
    const t = i18next.getFixedT('en', 'graph')
    const graph = store(1)
    const folding = foldGraph(toViewGraph(graph))
    const typeOf = (id: string) => graph.byId.get(id)?.type
    const phrase = foldedPhrase(
      foldedSummary(folding, typeOf, 'app:0', TYPE_ORDER),
      (type, count) => t(`view.folded.${type}`, { count }),
      listJoiner('en'),
    )
    expect(phrase).toBe('2 timeline items, 1 organisation and 1 file')
    expect(
      t('view.node.folded', {
        label: 'Employer 0',
        type: 'Application',
        connections: t('common.connections', { count: 5 }),
        folded: phrase,
      }),
    ).toBe(
      'Employer 0. Application, 5 connections, with 2 timeline items, 1 organisation and 1 file counted on it',
    )
  })

  it('has a counted phrase for every kind of record', () => {
    for (const type of TYPE_ORDER) {
      expect(en.view.folded[`${type}_one` as keyof typeof en.view.folded], type).toContain(
        '{{count}}',
      )
      expect(en.view.folded[`${type}_other` as keyof typeof en.view.folded], type).toContain(
        '{{count}}',
      )
    }
  })

  it('wires the folded name onto every overview mark and the loose node', () => {
    expect(overviewSource).toMatch(
      /t\('view\.node\.folded', \{ \.\.\.base, folded: foldedText\(node\.id\) \}\)/,
    )
    expect(overviewSource).toMatch(/label=\{ariaOf\(node\)\}/)
    expect(marksSource).toMatch(/data-id=\{GROUP_LOOSE\}[\s\S]{0,120}aria-label=\{label\}/)
    // Every mark in both views is a focusable, named button.
    for (const source of [overviewSource, focusSource]) {
      expect(source).toMatch(/role="button"/)
      expect(source).toMatch(/aria-label=\{/)
    }
  })
})

describe('the second pass on the overview (owner review, 2026-11-17)', () => {
  it('names the one-each group plainly, apart from the pooled Others', async () => {
    await i18next.changeLanguage('en')
    const t = i18next.getFixedT('en', 'graph')
    expect(groupName(GROUP_SINGLES, 'organisation', t)).toBe('One application each')
    expect(groupName(GROUP_REST, 'organisation', t)).toBe('Others')
  })

  it('lays stages out in pipeline order and nothing else in a fixed order', () => {
    expect(groupOrderOf('stage')).toEqual(STAGE_VALUES)
    expect(groupOrderOf('role')).toBeUndefined()
    expect(overviewSource).toMatch(/groupOrder: groupOrderOf\(by\)/)
  })

  it('zooms from fit to eight times, never out past fit, about the point under the hand', () => {
    const box = { width: 800, height: 600 }
    expect(clampView({ k: 0.5, x: 10, y: 10 }, box)).toEqual({ k: 1, x: 0, y: 0 })
    expect(clampView({ k: 20, x: 0, y: 0 }, box).k).toBe(MAX_ZOOM)
    const zoomed = zoomAbout({ k: 1, x: 0, y: 0 }, 2, 400, 300, box)
    // The point under the hand stays put: (400, 300) maps to itself.
    expect(400 * zoomed.k + zoomed.x).toBe(400)
    expect(300 * zoomed.k + zoomed.y).toBe(300)
    // Panned as far as it goes, the picture's edge stays on the box's edge.
    expect(clampView({ k: 2, x: -5000, y: 50 }, box)).toEqual({ k: 2, x: -800, y: 0 })
  })

  it('zooms by the + − 0 keys and named buttons, gliding only without reduced motion', () => {
    expect(overviewSource).toMatch(/event\.key === '\+' \|\| event\.key === '='/)
    expect(overviewSource).toMatch(/event\.key === '-' \|\| event\.key === '_'/)
    expect(overviewSource).toMatch(/event\.key === '0'/)
    expect(marksSource).toMatch(/aria-label=\{t\('view\.zoom\.in'\)\}/)
    expect(marksSource).toMatch(/aria-label=\{t\('view\.zoom\.fit'\)\}/)
    expect(zoomSource).toMatch(/if \(reduced\) \{\s*setView\(to\)/)
    // A plain wheel is the page's; only ctrl/⌘ + wheel or a pinch zooms.
    expect(zoomSource).toMatch(/if \(!event\.ctrlKey && !event\.metaKey\) return/)
  })

  it('pans a focused or selected record into view when zoomed', () => {
    expect(overviewSource).toMatch(/const follow = keyId \?\? selectedId/)
    expect(overviewSource).toMatch(/if \(p\) ensureVisible\(p\)/)
    // Zoom is one transform on the static layer; the marks never re-render for it.
    expect(overviewSource).toMatch(/data-layer="static"\s*transform=\{`translate\(/)
  })

  it('shows folded-count badges only where they are legible', () => {
    expect(overviewSource).toMatch(/const BADGE_MIN_CELL = 30/)
    expect(overviewSource).toMatch(/if \(layout\.cell \* view\.k < BADGE_MIN_CELL\) return \[\]/)
    expect(marksSource).not.toMatch(/badge/)
  })

  it('draws a hub in focus closed, with its count, and a more item that selects the hub', () => {
    expect(focusSource).toMatch(/t\('view\.node\.hub', \{ \.\.\.base, folded: counted \}\)/)
    expect(focusSource).toMatch(/`\$\{truncateLabel\(node\.label, 24\)\} · \$\{counted\}`/)
    expect(focusSource).toMatch(
      /id\?\.startsWith\(MORE_PREFIX\) \? \(layout\.more\.get\(id\)\?\.hub \?\? null\) : id/,
    )
    expect(focusSource).toMatch(/t\('view\.moreLabel', \{/)
  })
})

describe('the graph canvases after the third review (2026-11-18)', () => {
  it('lets a swipe on the canvas scroll the page unless zoomed in, and claims a pinch itself', () => {
    expect(overviewSource).toMatch(/view\.k > 1 \? 'touch-none' : 'touch-pan-y'/)
    expect(overviewSource).not.toMatch(/'graph-overview[^']*touch-none/)
    expect(focusSource).not.toMatch(/touch-none/)
    expect(focusSource).toMatch(/touch-manipulation/)
    expect(zoomSource).toMatch(/event\.touches\.length > 1 \|\| viewRef\.current\.k > 1\.001/)
    expect(zoomSource).toMatch(/addEventListener\('touchmove', onTouchMove, \{ passive: false \}\)/)
  })

  it('takes Tab into a host’s unfolded records and back out after them', () => {
    expect(overviewSource).toMatch(/<g data-layer="satellites">/)
    expect(overviewSource).toMatch(
      /event\.key === 'Tab' && tabThroughRing\(event\.target, id, event\.shiftKey\)/,
    )
    expect(overviewSource).toMatch(/ring\[0\]\?\.focus\(\)/)
    expect(overviewSource).toMatch(/hostEl\.compareDocumentPosition\(el\)/)
  })

  it('moves focus to the new centre or the mode control when a pressed view-bar button goes away', () => {
    expect(barSource).toMatch(/onClick=\{\(\) => thenFocus\(action\.onFocus, 'centre'\)\}/)
    expect(barSource).toMatch(/onClick=\{\(\) => thenFocus\(\(\) => onCrumb\(index\), 'centre'\)\}/)
    expect(barSource).toMatch(/onClick=\{\(\) => thenFocus\(onBack, 'mode'\)\}/)
    expect(barSource).toMatch(
      /if \(active && active !== document\.body && active\.isConnected\) return/,
    )
    expect(focusSource).toMatch(/data-centre=\{id === centreId \? '' : undefined\}/)
  })

  it('keeps an idle zoom button focusable instead of disabling it under the keyboard', () => {
    expect(marksSource).not.toMatch(/(?<![-\w])disabled=\{/)
    expect(marksSource).toMatch(/onClick=\{idle\(atMax, onIn\)\}\s*aria-disabled=\{atMax\}/)
    expect(marksSource).toMatch(/onClick=\{idle\(!zoomed, onOut\)\}\s*aria-disabled=\{!zoomed\}/)
    expect(marksSource).toMatch(/onClick=\{idle\(!zoomed, onFit\)\}\s*aria-disabled=\{!zoomed\}/)
  })

  it('answers + − 0 on the canvas and its buttons, and a click on the background focuses it', () => {
    expect(overviewSource).toMatch(/tabIndex=\{-1\}\s*aria-label=\{t\('view\.overviewLabel'/)
    // The keys are on the frame round the svg and the zoom buttons.
    const frame = /<div\s+ref=\{frameRef\}[\s\S]*?<svg/.exec(overviewSource)?.[0] ?? ''
    expect(frame).toMatch(/event\.key === '\+' \|\| event\.key === '='/)
    expect(frame).toMatch(/zoom\.fit\(\)/)
  })

  it('goes to the overview from “Back to overview”, whatever the store’s size', () => {
    expect(graphSource).toMatch(/onBack=\{backFromFocus\}/)
    expect(graphSource).toMatch(
      /const backFromFocus = useCallback\(\(\) => \{\s*backToOverview\(\)\s*setLayout\('overview'\)/,
    )
  })

  it('draws free-layout labels at a legible size on a phone', () => {
    expect(graphCanvasSource).toMatch(/style=\{\{ '--label-scale': scale \} as CSSProperties\}/)
    expect(graphCanvasSource).toMatch(/scale: scaleRef\.current/)
    expect(nodeMarkSource).toMatch(/var\(--label-scale, 1\)/)
    // The record pointed at or selected keeps its name even where it crosses marks.
    expect(labelsSource).toMatch(/over: node\.id === selected \|\| node\.id === active/)
  })
})
