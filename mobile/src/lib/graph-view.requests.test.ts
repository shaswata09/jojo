/**
 * Owner request (2026-11-17): the knowledge graph "looks chaotic with a lot of
 * data". The approved redesign — fold single-link records into their parent,
 * draw a large store as labelled groups with no permanent edge mesh, open one
 * record in a focus view, keep today's picture for small stores — landed on the
 * web first (`web/src/components/graph/overview.requests.test.ts`). This is the
 * phone's half: the same shared rules (`service/kg/core/graph-view.ts`, pinned
 * in its own test), and this app's use of them.
 *
 * The screens import React Native, which this runner does not load, so wiring
 * is read off source with comments removed (D20: no mounting).
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  GROUP_REST,
  GROUP_SINGLES,
  OVERVIEW_THRESHOLD,
  clusterLayout,
  focusLayout,
  foldedSummary,
  wantsOverview,
} from '@jojo/service/core/graph-view'
import { STAGE_VALUES } from '@jojo/service/core/model'
import { LOCALES } from '@jojo/service/core/locale'
import { i18next } from '@/i18n/i18n'
import { GRAPH_NODE_TYPES } from './graph'
import type { Graph, GraphEdge, GraphNode, GraphRel } from './graph'
import {
  FIT,
  MAX_ZOOM,
  circlesPath,
  clampView,
  nearestMark,
  pickLabels,
  zoomAbout,
} from './graph-canvas'
import {
  TYPE_ORDER,
  foldGraph,
  foldedPhrase,
  groupName,
  groupOrderOf,
  listJoiner,
  toViewGraph,
} from './graph-view'
import type { Say } from './graph-view'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) =>
  readFileSync(path.join(SRC, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const screen = read('screens/GraphScreen.tsx')
const overview = read('components/graph/OverviewCanvas.tsx')
const focus = read('components/graph/FocusCanvas.tsx')
const bar = read('components/graph/GraphViewBar.tsx')
const list = read('components/graph/GraphGroupList.tsx')
const zoom = read('components/graph/use-canvas-zoom.ts')
const words = read('components/graph/use-graph-words.ts')

/** A store of `n` applications, each with an employer, two dates and a file, under five roles. */
function store(n: number): Graph {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const add = (id: string, type: GraphNode['type'], label = id, stage?: GraphNode['stage']) =>
    nodes.push({ id, type, label, recordId: id, degree: 0, ...(stage ? { stage } : {}) })
  const link = (from: string, to: string, rel: GraphRel) =>
    edges.push({ id: `${from}|${rel}|${to}`, from, to, rel })
  for (let r = 0; r < 5; r++) add(`role:${r}`, 'role', `Role ${r}`)
  for (let i = 0; i < n; i++) {
    add(`application:${i}`, 'application', `Employer ${i}`, STAGE_VALUES[i % STAGE_VALUES.length])
    link(`application:${i}`, `role:${i % 5}`, 'IS')
    add(`org:${i}`, 'org', `Employer ${i}`)
    link(`application:${i}`, `org:${i}`, 'AT')
    add(`item:${i}a`, 'item')
    add(`item:${i}b`, 'item')
    link(`item:${i}a`, `application:${i}`, 'ABOUT')
    link(`item:${i}b`, `application:${i}`, 'ABOUT')
    add(`file:${i}`, 'file')
    link(`file:${i}`, `application:${i}`, 'FILED_UNDER')
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

const say = (language: string): Say => {
  const t = i18next.getFixedT(language, 'screens')
  return (key, options) => t(key, options) as string
}

describe('the phone graph picks its picture by size', () => {
  it('opens a large store on the overview and a small one on the radial layout', () => {
    expect(OVERVIEW_THRESHOLD).toBe(150)
    // 140 applications + 5 roles = 145 drawn after folding: under the threshold.
    expect(wantsOverview(foldGraph(toViewGraph(store(140))))).toBe(false)
    expect(wantsOverview(foldGraph(toViewGraph(store(500))))).toBe(true)
  })

  it('chooses the mode from the folded size, and draws each mode with its own canvas', () => {
    expect(screen).toMatch(/const viewGraph = useMemo\(\(\) => toViewGraph\(graph, hidden\)/)
    expect(screen).toMatch(/const folding = useMemo\(\(\) => foldGraph\(viewGraph\)/)
    expect(screen).toMatch(/const large = wantsOverview\(folding\)/)
    expect(screen).toMatch(/if \(large\) \{\s*return \(/)
    expect(screen).toContain('<OverviewCanvas')
    expect(screen).toContain('<FocusCanvas')
    // The radial picture is not computed for a store the overview draws.
    expect(screen).toMatch(/if \(large\) return positions/)
  })

  it('opens focus on the selected record, else the most connected, and goes back along the trail', () => {
    expect(screen).toMatch(
      /mode: GraphMode = centre !== undefined && inView\.has\(centre\) \? 'focus' : 'overview'/,
    )
    expect(screen).toMatch(/\.sort\(\(a, b\) => b\.degree - a\.degree\)\[0\]\?\.id/)
    expect(screen).toMatch(/at === -1 \? \[\.\.\.current, id\] : current\.slice\(0, at \+ 1\)/)
    expect(bar).toMatch(/label=\{t\('graph\.view\.back'\)\}/)
    expect(bar).toMatch(/onPress=\{\(\) => onCrumb\(index\)\}/)
  })
})

describe('folding on the phone graph', () => {
  it('folds dates, files and employers into their application, never an application or a role', () => {
    const folding = foldGraph(toViewGraph(store(3)))
    expect(folding.visible.filter((id) => id.startsWith('application:'))).toEqual([
      'application:0',
      'application:1',
      'application:2',
    ])
    expect(folding.visible.filter((id) => id.startsWith('role:'))).toHaveLength(5)
    expect(folding.folded.get('application:0')).toEqual(['org:0', 'item:0a', 'item:0b', 'file:0'])
  })

  it('groups each application by role, stage, employer and keyword, read off its own links', () => {
    const view = toViewGraph(store(6))
    const app = view.nodes.find((n) => n.id === 'application:1')
    expect(app?.groupKeys).toEqual({
      role: ['Role 1'],
      stage: [STAGE_VALUES[1]],
      organisation: ['Employer 1'],
      keyword: [],
    })
    // A type hidden in the legend is hidden from the grouping too.
    const hidden = toViewGraph(store(6), new Set(['role']))
    expect(hidden.nodes.find((n) => n.id === 'application:1')?.groupKeys?.role).toEqual([])
    expect(hidden.edges.some((e) => e.to.startsWith('role:'))).toBe(false)
  })

  it('puts employers with one application each in one group, and stages in pipeline order', async () => {
    await i18next.changeLanguage('en')
    const view = toViewGraph(store(200))
    const layout = clusterLayout(view, {
      by: 'organisation',
      width: 360,
      height: 460,
      folding: foldGraph(view),
    })
    expect(layout.groups.find((g) => g.key === GROUP_SINGLES)?.anchors).toBe(200)
    expect(groupName(GROUP_SINGLES, 'organisation', say('en'))).toBe('One application each')
    expect(groupName(GROUP_REST, 'organisation', say('en'))).toBe('Others')
    expect(groupOrderOf('stage')).toEqual(STAGE_VALUES)
    expect(groupOrderOf('role')).toBeUndefined()
    expect(overview).toMatch(/groupOrder: groupOrderOf\(by\)/)
  })
})

describe('the phone overview draws no edge mesh', () => {
  it('draws lines only for the selected record', () => {
    // The one line-drawing element is the overlay's, built from the selected
    // record's own links; no edge list of the graph is ever turned into lines.
    expect(overview.match(/segmentsPath\(/g)).toHaveLength(1)
    expect(overview).toMatch(/d=\{segmentsPath\(overlay\.lines\)\}/)
    expect(overview).not.toMatch(/<Line\b/)
    expect(overview).not.toMatch(/(folding|viewGraph|graph|layout)\.edges\.map\(/)
    expect(overview).toMatch(/for \(const other of visibleAdj\.get\(host\) \?\? \[\]\)/)
  })

  it('dims with one opacity and redraws only what is lit, never re-rendering the marks', () => {
    expect(overview).toMatch(/style=\{\{ opacity: lit \? 0\.32 : 1 \}\}/)
    expect(overview).toMatch(/for \(const id of lit \?\? \[\]\)/)
    const deps = /const staticLayer = useMemo\([\s\S]*?\n  \)\n/.exec(overview)?.[0] ?? ''
    expect(deps).not.toBe('')
    expect(deps).not.toMatch(/selectedId|\blit\b|view\b|answered/)
  })

  it('draws a dot per record without an element per record', () => {
    // Measured on the emulator: an SVG element per mark cost seconds of first paint.
    expect(overview).toMatch(
      /byColour: \[\.\.\.dots\]\.map\(\(\[fill, list\]\) => \(\{ fill, d: circlesPath\(list\) \}\)\)/,
    )
    expect(overview).not.toMatch(/group\.members\.map\(\(id\) => \{[\s\S]{0,200}<Circle/)
    expect(focus).toMatch(/d: circlesPath\(bucket\.dots\)/)
    expect(focus).toMatch(/d: segmentsPath\(bucket\.segments\)/)
    expect(circlesPath([{ x: 10, y: 20, r: 3 }])).toBe(
      'M7.00 20.00a3.00 3.00 0 1 0 6.00 0a3.00 3.00 0 1 0 -6.00 0Z',
    )
  })

  it('unfolds what is counted on the selected record round it', () => {
    expect(overview).toMatch(/const points = satellites\(children\.length, centre,/)
    expect(overview).toMatch(/folding\.folded\.get\(host\)/)
  })
})

describe('every phone record is named with what is counted on it', () => {
  it('names a host with its folded counts, in counted phrases joined as a list', async () => {
    await i18next.changeLanguage('en')
    const t = say('en')
    const graph = store(1)
    const folding = foldGraph(toViewGraph(graph))
    const typeOf = (id: string) => graph.byId.get(id)?.type
    const phrase = foldedPhrase(
      foldedSummary(folding, typeOf, 'application:0', TYPE_ORDER),
      (type, count) => t(`graph.view.folded.${type}`, { count }),
      listJoiner(t),
    )
    expect(phrase).toBe('2 timeline items, 1 employer and 1 file')
    expect(
      t('graph.view.node.folded', {
        label: 'Employer 0',
        type: 'Application',
        connections: t('graph.view.connections', { count: 5 }),
        folded: phrase,
      }),
    ).toBe(
      'Employer 0. Application, 5 connections, with 2 timeline items, 1 employer and 1 file counted on it',
    )
  })

  it('has a counted phrase for every kind of record, in every language', () => {
    for (const { code } of LOCALES) {
      const t = say(code)
      for (const type of GRAPH_NODE_TYPES) {
        const text = t(`graph.view.folded.${type}`, { count: 3 })
        expect(text, `${code} ${type}`).toContain('3')
        expect(text, `${code} ${type}`).not.toContain('graph.view')
      }
    }
  })

  it('joins phrases the way each language lists things, without Intl.ListFormat', () => {
    expect(listJoiner(say('en'))(['a', 'b', 'c'])).toBe('a, b and c')
    expect(listJoiner(say('ja'))(['a', 'b', 'c'])).toBe('a、b、c')
    expect(listJoiner(say('de'))(['a', 'b'])).toBe('a und b')
    expect(read('lib/graph-view.ts')).not.toMatch(/Intl\.ListFormat\(/)
  })

  it('wires the folded name onto every record TalkBack can reach', () => {
    expect(words).toMatch(
      /t\('graph\.view\.node\.folded', \{ \.\.\.base, folded: foldedText\(node\.id\) \}\)/,
    )
    // The overview's records, through the Groups list beneath it.
    expect(list).toMatch(/name=\{nameOf\(node\)\}/)
    expect(list).toMatch(/accessibilityLabel=\{name\}/)
    // The canvas is one summary that points at that list.
    expect(overview).toMatch(/accessibilityHint=\{t\('graph\.view\.listHint'\)\}/)
    // Every focus mark is a named element whose actions select, focus and expand.
    expect(focus).toMatch(/accessibilityLabel=\{label\}/)
    expect(focus).toMatch(/name: 'focus'/)
    expect(focus).toMatch(/name: 'expand'/)
    expect(focus).toMatch(/if \(name === 'activate'\) onSelect/)
  })
})

describe('the phone focus view', () => {
  it('draws a hub closed, with its count, and a more item that selects the hub', () => {
    const view = toViewGraph(store(250))
    // An application's role is a hub of 50: one ring out it is drawn, closed.
    const layout = focusLayout(view, 'application:0', { width: 360, height: 460 })
    expect(layout.collapsed.get('role:0')).toHaveLength(49)
    // Focused on the role itself, its fifty applications are capped with a "+N more" item.
    const hub = focusLayout(view, 'role:0', { width: 360, height: 460 })
    expect([...hub.more.values()][0]?.ids.length).toBe(50 - 36)
    expect(focus).toMatch(/t\('graph\.view\.node\.hub', \{ \.\.\.base, folded: counted \}\)/)
    expect(focus).toMatch(/`\$\{truncateLabel\(node\.label, 18\)\} · \$\{counted\}`/)
    expect(focus).toMatch(
      /id\?\.startsWith\(MORE_PREFIX\) \? \(layout\.more\.get\(id\)\?\.hub \?\? null\) : id/,
    )
    expect(focus).toMatch(/t\('graph\.view\.moreLabel', \{/)
  })

  it('offers Expand only in focus, for a record that is not the centre', () => {
    expect(screen).toMatch(/mode === 'focus' && selected\.id !== centre/)
    expect(bar).toMatch(
      /action\.expand\.expanded \? t\('graph\.view\.collapse'\) : t\('graph\.view\.expand'\)/,
    )
  })
})

describe('zoom on the phone overview', () => {
  it('zooms from fit to eight times, never out past fit, about the point under the fingers', () => {
    expect(clampView({ k: 0.5, x: 10, y: 10 }, 360, 460)).toEqual(FIT)
    expect(clampView({ k: 20, x: 0, y: 0 }, 360, 460).k).toBe(MAX_ZOOM)
    const zoomed = zoomAbout(FIT, 2, 180, 230, 360, 460)
    expect(180 * zoomed.k + zoomed.x).toBe(180)
    expect(230 * zoomed.k + zoomed.y).toBe(230)
    expect(clampView({ k: 2, x: -5000, y: 50 }, 360, 460)).toEqual({ k: 2, x: -360, y: 0 })
  })

  it('pinches always, pans only once zoomed, and stops the page scrolling meanwhile', () => {
    expect(zoom).toMatch(/Gesture\.Pan\(\)\s*\.enabled\(zoomed\)/)
    expect(zoom).toMatch(/Gesture\.Race\(Gesture\.Simultaneous\(pinch, pan\), tap\)/)
    expect(screen).toMatch(/scrollEnabled=\{!gesturing\}/)
    expect(overview).toMatch(/onGesture=\{setGesturing\}|onGesture,/)
  })

  it('moves the marks on the UI thread and writes text in screen pixels', () => {
    expect(zoom).toMatch(/matrix: \[k\.value, 0, 0, k\.value, x\.value, y\.value\]/)
    expect(overview).toMatch(
      /<AnimatedG animatedProps=\{zoom\.matrixProps\}>\{staticLayer\}<\/AnimatedG>/,
    )
    expect(overview).toMatch(/if \(layout\.cell \* view\.k < BADGE_MIN_CELL\) return \[\]/)
    expect(overview).toMatch(/label=\{t\('graph\.view\.zoom\.in'\)\}/)
    expect(overview).toMatch(/label=\{t\('graph\.view\.zoom\.fit'\)\}/)
  })
})

describe('right to left on the phone graph', () => {
  it('mirrors the overview, so stages and the loose strip start at the reading edge', () => {
    expect(overview).toMatch(/const rtl = I18nManager\.isRTL/)
    expect(overview).toMatch(/const mirror = \(x: number\) => width - x/)
    expect(overview).toMatch(/loose \? \(rtl \? 'end' : 'start'\) : 'middle'/)
  })

  it('places names by physical side, since react-native-svg lays text left to right', () => {
    const [right, left] = pickLabels(
      [
        { id: 'a', x: 50, y: 50, r: 4, text: 'east', rank: 2, placement: 'start' },
        { id: 'b', x: 50, y: 50, r: 4, text: 'west', rank: 1, placement: 'end' },
      ],
      { bounds: { width: 200, height: 100 } },
    )
    expect(right?.anchor).toBe('start')
    expect(right?.tx).toBeGreaterThan(50)
    expect(left?.anchor).toBe('end')
    expect(left?.tx).toBeLessThan(50)
  })
})

describe('a tap on the phone canvas', () => {
  it('finds the nearest mark within reach, and nothing beyond it', () => {
    const marks = [
      { id: 'a', x: 10, y: 10 },
      { id: 'b', x: 30, y: 10 },
    ]
    expect(nearestMark(marks, { x: 24, y: 12 }, 20)).toBe('b')
    expect(nearestMark(marks, { x: 100, y: 100 }, 20)).toBeNull()
  })
})
