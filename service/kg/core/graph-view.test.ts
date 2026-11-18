/**
 * The calm overview of a large graph: folding, grouping, and the two layouts.
 *
 * Owner request (2026-11-17): "the knowledge graph looks chaotic with a lot of
 * data". The approved redesign folds single-link records into their parent,
 * groups the rest into labelled circles, draws links only on demand, and
 * focuses one record with its neighbours in rings. Both apps draw from this
 * module, so its rules are pinned here rather than in either app.
 */

import { describe, expect, it } from 'vitest'
import {
  GROUP_ESCAPE,
  GROUP_LOOSE,
  GROUP_NONE,
  GROUP_REST,
  GROUP_SINGLES,
  GROUP_SHARED,
  GROUP_TYPE_PREFIX,
  HUB_DEGREE,
  HUB_SHOWN,
  MORE_PREFIX,
  OVERVIEW_THRESHOLD,
  adjacency,
  clusterLayout,
  countTypes,
  focusLayout,
  foldLeaves,
  foldedSummary,
  groupOf,
  groupValue,
  hostOf,
  satellites,
  wantsOverview,
} from './graph-view'
import type { ViewEdge, ViewGraph, ViewNode } from './graph-view'

const node = (id: string, type = 'thing', groupKeys?: ViewNode['groupKeys']): ViewNode => ({
  id,
  type,
  label: id,
  ...(groupKeys ? { groupKeys } : {}),
})
const edge = (from: string, to: string, rel = 'LINK'): ViewEdge => ({ from, to, rel })
const graphOf = (nodes: ViewNode[], links: [string, string][]): ViewGraph => ({
  nodes,
  edges: links.map(([a, b]) => edge(a, b)),
})

const notApplication = (n: ViewNode) => n.type !== 'application'

/**
 * A store shaped like the measured one: applications each with an employer,
 * dates and files hanging off them, a few shared role nodes, and some files
 * filed under nothing.
 */
function store(applications: number, roles = 5, loose = 0): ViewGraph {
  const nodes: ViewNode[] = []
  const edges: ViewEdge[] = []
  const stages = ['draft', 'submitted', 'screen', 'interview', 'offer', 'closed']
  for (let r = 0; r < roles; r++) nodes.push(node(`role:${r}`, 'role'))
  for (let i = 0; i < applications; i++) {
    const role = `Role ${i % roles}`
    const app = `app:${i}`
    nodes.push(
      node(app, 'application', {
        role: [role],
        stage: [stages[i % stages.length] ?? 'draft'],
        keyword: i % 3 === 0 ? ['ml', 'rust'] : i % 3 === 1 ? ['ml'] : [],
      }),
    )
    edges.push(edge(app, `role:${i % roles}`, 'IS'))
    nodes.push(node(`org:${i}`, 'organisation'))
    edges.push(edge(app, `org:${i}`, 'AT'))
    nodes.push(node(`item:${i}a`, 'item'), node(`item:${i}b`, 'item'))
    edges.push(edge(`item:${i}a`, app, 'ABOUT'), edge(`item:${i}b`, app, 'ABOUT'))
    if (i % 5 < 3) {
      nodes.push(node(`file:${i}`, 'file'))
      edges.push(edge(`file:${i}`, app, 'FILED_UNDER'))
    }
  }
  for (let f = 0; f < loose; f++) nodes.push(node(`loose:${f}`, 'file'))
  return { nodes, edges }
}

describe('folding single-link records into their parent', () => {
  it('folds a leaf into the one record it links to', () => {
    const g = graphOf(
      [node('a', 'application'), node('b', 'application'), node('leaf'), node('org')],
      [
        ['a', 'b'],
        ['leaf', 'a'],
        ['org', 'a'],
        ['org', 'b'],
      ],
    )
    const f = foldLeaves(g, { canFold: notApplication })
    expect(f.visible).toEqual(['a', 'b', 'org'])
    expect(f.parent.get('leaf')).toBe('a')
    expect(f.host.get('leaf')).toBe('a')
    expect(f.folded.get('a')).toEqual(['leaf'])
    expect(f.edges).toHaveLength(3)
  })

  it('pools records with no links at all into one loose group instead of dots', () => {
    const g = graphOf([node('a', 'application'), node('x'), node('y')], [])
    const f = foldLeaves(g, { canFold: notApplication })
    expect(f.loose).toEqual(['x', 'y'])
    // The application has no links either, but it may not fold, so it stays drawn.
    expect(f.visible).toEqual(['a'])
    expect(hostOf(f, 'x')).toBe(GROUP_LOOSE)
  })

  it('peels a chain from both ends down to one record that carries the rest', () => {
    const g = graphOf(
      [node('a'), node('b'), node('c'), node('d')],
      [
        ['a', 'b'],
        ['b', 'c'],
        ['c', 'd'],
      ],
    )
    const f = foldLeaves(g)
    expect(f.visible).toEqual(['b'])
    expect(f.folded.get('b')).toEqual(['a', 'c', 'd'])
    expect(f.parent.get('d')).toBe('c')
    expect(f.host.get('d')).toBe('b')
  })

  it('counts a file under a date under an application on the application', () => {
    const g = graphOf(
      [node('app', 'application'), node('role', 'role'), node('date', 'item'), node('file', 'file')],
      [
        ['app', 'role'],
        ['date', 'app'],
        ['file', 'date'],
      ],
    )
    const f = foldLeaves(g, { canFold: (n) => n.type !== 'application' && n.type !== 'role' })
    expect(f.visible).toEqual(['app', 'role'])
    expect(f.folded.get('app')).toEqual(['date', 'file'])
    expect(f.parent.get('file')).toBe('date')
  })

  it('does not fold a record with two parents', () => {
    const g = graphOf(
      [node('a', 'application'), node('b', 'application'), node('shared')],
      [
        ['shared', 'a'],
        ['shared', 'b'],
      ],
    )
    const f = foldLeaves(g, { canFold: notApplication })
    expect(f.visible).toEqual(['a', 'b', 'shared'])
    expect(f.parent.size).toBe(0)
  })

  it('never folds a record the caller protects, even with one link', () => {
    const g = graphOf(
      [node('me', 'background'), node('app', 'application')],
      [['me', 'app']],
    )
    const f = foldLeaves(g, { canFold: (n) => n.type !== 'background' && n.type !== 'application' })
    expect(f.visible).toEqual(['me', 'app'])
  })

  it('keeps the earlier of two leaves linked only to each other', () => {
    const f = foldLeaves(graphOf([node('p'), node('q')], [['q', 'p']]))
    expect(f.visible).toEqual(['p'])
    expect(f.parent.get('q')).toBe('p')
  })

  it('counts what is folded by type, largest first, ties in the given order', () => {
    const g = store(1)
    const f = foldLeaves(g, { canFold: (n) => n.type !== 'application' && n.type !== 'role' })
    const typeOf = (id: string) => g.nodes.find((n) => n.id === id)?.type
    expect(foldedSummary(f, typeOf, 'app:0', ['organisation', 'file', 'item'])).toEqual([
      { type: 'item', count: 2 },
      { type: 'organisation', count: 1 },
      { type: 'file', count: 1 },
    ])
    expect(countTypes([], typeOf)).toEqual([])
  })

  it('ignores self loops and duplicate links when counting neighbours', () => {
    const g: ViewGraph = {
      nodes: [node('a', 'application'), node('b')],
      edges: [edge('a', 'a'), edge('a', 'b'), edge('b', 'a', 'OTHER')],
    }
    expect(adjacency(g).get('a')).toEqual(['b'])
    expect(foldLeaves(g, { canFold: notApplication }).folded.get('a')).toEqual(['b'])
  })

  it('switches to the overview above the threshold, counting the loose node once', () => {
    const at = (visible: number, loose: number) =>
      wantsOverview({
        visible: Array.from({ length: visible }, (_, i) => `${i}`),
        loose: Array.from({ length: loose }, (_, i) => `l${i}`),
        parent: new Map(),
        host: new Map(),
        folded: new Map(),
        edges: [],
      })
    expect(at(OVERVIEW_THRESHOLD, 0)).toBe(false)
    expect(at(OVERVIEW_THRESHOLD, 200)).toBe(true)
    expect(at(OVERVIEW_THRESHOLD + 1, 0)).toBe(true)
  })

  it('folds the measured store shape down to its applications and roles', () => {
    const g = store(500, 5, 200)
    const f = foldLeaves(g, { canFold: (n) => n.type !== 'application' && n.type !== 'role' })
    expect(f.visible).toHaveLength(505)
    expect(f.loose).toHaveLength(200)
    expect(f.edges).toHaveLength(500)
  })
})

describe('grouping the drawn records by a dimension', () => {
  const canFold = (n: ViewNode) => n.type !== 'application' && n.type !== 'role'

  it('puts applications in their own value and a role node with the applications it links', () => {
    const g = store(60)
    const groups = groupOf(g, { by: 'role', folding: foldLeaves(g, { canFold }) })
    expect(groups.get('app:0')).toBe('Role 0')
    expect(groups.get('app:7')).toBe('Role 2')
    expect(groups.get('role:3')).toBe('Role 3')
  })

  it('sends a record linked across several groups to Shared', () => {
    const g = store(60)
    const groups = groupOf(g, { by: 'stage', folding: foldLeaves(g, { canFold }) })
    expect(groups.get('app:1')).toBe('submitted')
    expect(groups.get('role:0')).toBe(GROUP_SHARED)
  })

  it('groups a several-valued record by its most common value, and none by None', () => {
    const g = store(30)
    const groups = groupOf(g, { by: 'keyword', folding: foldLeaves(g, { canFold }) })
    // app:0 carries ml and rust; ml is held by twenty, rust by ten.
    expect(groups.get('app:0')).toBe('ml')
    expect(groups.get('app:2')).toBe(GROUP_NONE)
  })

  it('pools values held once into One-each, and values beyond the cap into Others', () => {
    const nodes = [
      ...['a', 'b', 'c'].map((id) => node(id, 'application', { org: ['Big'] })),
      node('d', 'application', { org: ['Alone'] }),
      ...['e', 'f'].map((id) => node(id, 'application', { org: ['Mid'] })),
    ]
    const g = graphOf(nodes, [])
    expect(groupOf(g, { by: 'org' }).get('d')).toBe(GROUP_SINGLES)
    const capped = groupOf(g, { by: 'org', maxGroups: 1 })
    expect(capped.get('a')).toBe('Big')
    expect(capped.get('e')).toBe(GROUP_REST)
  })

  it('keeps a caller’s own @ group however small, outside the group cap', () => {
    const g = graphOf(
      [
        ...['a', 'b', 'c'].map((id) => node(id, 'application', { role: ['R'] })),
        node('me', 'background', { role: ['@you'] }),
      ],
      [],
    )
    const groups = groupOf(g, { by: 'role', maxGroups: 1 })
    expect(groups.get('me')).toBe('@you')
    expect(groups.get('a')).toBe('R')
  })

  it('places a record that reaches no application by its own type', () => {
    const g = graphOf(
      [node('app', 'application', { role: ['R'] }), node('k1', 'keyword'), node('p1', 'posting')],
      [['k1', 'p1']],
    )
    const groups = groupOf(g, { by: 'role' })
    expect(groups.get('k1')).toBe(`${GROUP_TYPE_PREFIX}keyword`)
    expect(groups.get('p1')).toBe(`${GROUP_TYPE_PREFIX}posting`)
  })

  it('places a record two steps out by the records one step out', () => {
    const g = graphOf(
      [
        node('a1', 'application', { role: ['R'] }),
        node('a2', 'application', { role: ['R'] }),
        node('kw', 'keyword'),
        node('posting', 'posting'),
        node('posting2', 'posting'),
      ],
      [
        ['kw', 'a1'],
        ['kw', 'a2'],
        ['posting', 'kw'],
        ['posting2', 'kw'],
      ],
    )
    const groups = groupOf(g, { by: 'role' })
    expect(groups.get('kw')).toBe('R')
    expect(groups.get('posting')).toBe('R')
  })
})

describe('the clustered overview layout', () => {
  const canFold = (n: ViewNode) => n.type !== 'application' && n.type !== 'role'
  const layoutOf = (g: ViewGraph, by = 'role', width = 960, height = 620) =>
    clusterLayout(g, {
      by,
      width,
      height,
      folding: foldLeaves(g, { canFold }),
      labelWidth: (key) => key.length * 7 + 40,
    })

  it('is the same picture every time', () => {
    const g = store(300, 5, 40)
    const a = layoutOf(g)
    const b = layoutOf({ nodes: [...g.nodes], edges: [...g.edges] })
    expect([...b.positions]).toEqual([...a.positions])
    expect(b.groups).toEqual(a.groups)
  })

  it('never lets two group circles, or a circle and a label, overlap', () => {
    for (const by of ['role', 'stage', 'keyword']) {
      const L = layoutOf(store(400, 7, 30), by)
      for (const [i, a] of L.groups.entries()) {
        for (const b of L.groups.slice(i + 1)) {
          expect(Math.hypot(a.x - b.x, a.y - b.y), `${a.key}/${b.key}`).toBeGreaterThan(a.r + b.r)
          // The label sits on top of its own circle and clear of the other one.
          expect(Math.hypot(a.labelX - b.x, a.labelY - b.y)).toBeGreaterThan(b.r)
        }
      }
    }
  })

  it('keeps every member inside its group, a cell apart, and in the box', () => {
    const L = layoutOf(store(500, 5, 200))
    for (const group of L.groups) {
      for (const id of group.members) {
        const p = L.positions.get(id)
        expect(p).toBeDefined()
        if (!p) continue
        expect(Math.hypot(p.x - group.x, p.y - group.y)).toBeLessThan(group.r)
        expect(p.x).toBeGreaterThan(0)
        expect(p.x).toBeLessThan(960)
        expect(p.y).toBeGreaterThan(0)
        expect(p.y).toBeLessThan(620)
      }
      const pts = group.members.map((id) => L.positions.get(id)).filter((p) => p !== undefined)
      for (let i = 0; i < Math.min(pts.length, 60); i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const a = pts[i]
          const b = pts[j]
          if (a && b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(L.cell * 0.95)
        }
      }
    }
  })

  it('labels each group with its anchor count, and draws the loose records as one node', () => {
    const L = layoutOf(store(100, 4, 12))
    const role0 = L.groups.find((g) => g.key === 'Role 0')
    expect(role0?.anchors).toBe(25)
    // The role diamond joined its applications, at the centre of their circle.
    expect(role0?.members).toContain('role:0')
    const loose = L.groups.find((g) => g.key === GROUP_LOOSE)
    expect(loose?.members).toEqual([])
    expect(loose?.anchors).toBe(12)
    expect(L.positions.get(GROUP_LOOSE)).toEqual({ x: loose?.x, y: loose?.y })
  })

  it('keeps the loose node in a strip below every group, its label running after it', () => {
    const L = layoutOf(store(300, 5, 40))
    const loose = L.groups.find((g) => g.key === GROUP_LOOSE)
    expect(loose?.labelAnchor).toBe('start')
    expect(L.groups.at(-1)?.key).toBe(GROUP_LOOSE)
    for (const g of L.groups) {
      if (g.key !== GROUP_LOOSE && loose) expect(g.y + g.r).toBeLessThan(loose.y - loose.r)
    }
  })

  it('orders members by the given order, the first at the centre', () => {
    const g = store(20, 1)
    const L = clusterLayout(g, {
      by: 'role',
      width: 960,
      height: 620,
      folding: foldLeaves(g, { canFold }),
      order: (a, b) => (a.type === 'role' ? -1 : b.type === 'role' ? 1 : a.id < b.id ? -1 : 1),
    })
    const group = L.groups[0]
    expect(group?.members[0]).toBe('role:0')
    expect(L.positions.get('role:0')).toEqual({ x: group?.x, y: group?.y })
  })

  it('lays groups out in a meaningful order, in rows, in reading order', () => {
    const stages = ['draft', 'submitted', 'screen', 'interview', 'offer', 'closed']
    const g = store(300)
    const L = clusterLayout(g, {
      by: 'stage',
      width: 960,
      height: 620,
      folding: foldLeaves(g, { canFold }),
      groupOrder: stages,
    })
    const named = L.groups.filter((group) => stages.includes(group.key))
    expect(named.map((group) => group.key)).toEqual(stages)
    // Reading order: each next group is to the right in its row, or a row down.
    for (let i = 1; i < named.length; i++) {
      const a = named[i - 1]
      const b = named[i]
      if (a && b) expect(b.x > a.x || b.y - b.r > a.y).toBe(true)
    }
    for (const [i, a] of L.groups.entries()) {
      for (const b of L.groups.slice(i + 1)) {
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.r + b.r)
      }
    }
  })

  it('lists the one-each group alphabetically', () => {
    const nodes = ['Zeta', 'Alpha', 'Mu', 'Beta'].map((org) =>
      node(`app:${org}`, 'application', { organisation: [org] }),
    )
    const L = clusterLayout(graphOf(nodes, []), { by: 'organisation', width: 960, height: 620 })
    expect(L.groups.map((group) => group.key)).toEqual([GROUP_SINGLES])
    expect(L.groups[0]?.members).toEqual(['app:Alpha', 'app:Beta', 'app:Mu', 'app:Zeta'])
  })

  it('lists groups in reading order, top to bottom', () => {
    const L = layoutOf(store(400, 9))
    const tops = L.groups.map((g) => g.y - g.r)
    const band = Math.max(...L.groups.map((g) => g.r))
    for (let i = 1; i < tops.length; i++) {
      expect(Math.floor((tops[i] ?? 0) / band)).toBeGreaterThanOrEqual(Math.floor((tops[i - 1] ?? 0) / band))
    }
  })
})

describe('the focus layout', () => {
  const g = graphOf(
    [
      node('centre', 'application'),
      node('org', 'organisation'),
      node('date', 'item'),
      node('role', 'role'),
      node('other', 'application'),
      node('far', 'file'),
    ],
    [
      ['centre', 'org'],
      ['date', 'centre'],
      ['centre', 'role'],
      ['other', 'role'],
      ['far', 'other'],
    ],
  )

  it('puts the record at the centre and its neighbours on rings by hop', () => {
    const F = focusLayout(g, 'centre', { width: 960, height: 620 })
    expect(F.positions.get('centre')).toEqual({ x: 480, y: 310 })
    expect(F.hop.get('org')).toBe(1)
    expect(F.hop.get('other')).toBe(2)
    expect(F.parentOf.get('other')).toBe('role')
    expect(F.positions.has('far')).toBe(false)
    expect(F.omitted).toBe(0)
    const d = (id: string) => {
      const p = F.positions.get(id)
      return p ? Math.hypot(p.x - 480, p.y - 310) : 0
    }
    expect(d('other')).toBeGreaterThan(d('org'))
    expect(F.rings.map((r) => r.hop)).toEqual([1, 2])
  })

  it('draws an expanded record’s neighbours one ring further out', () => {
    const F = focusLayout(g, 'centre', { width: 960, height: 620, expanded: ['other'] })
    expect(F.hop.get('far')).toBe(3)
    expect(F.edges.some((e) => e.from === 'far')).toBe(true)
  })

  it('caps the records drawn and says how many it left out', () => {
    const hub = graphOf(
      [node('hub'), ...Array.from({ length: 50 }, (_, i) => node(`n${i}`))],
      Array.from({ length: 50 }, (_, i): [string, string] => ['hub', `n${i}`]),
    )
    const F = focusLayout(hub, 'hub', { width: 960, height: 620, maxNodes: 21, hubDegree: 100 })
    expect(F.positions.size).toBe(21)
    expect(F.omitted).toBe(30)
  })

  it('keeps a crowded ring spaced by splitting it into tracks, inside the box', () => {
    const many = graphOf(
      [node('hub'), ...Array.from({ length: 200 }, (_, i) => node(`n${i}`))],
      Array.from({ length: 200 }, (_, i): [string, string] => ['hub', `n${i}`]),
    )
    const F = focusLayout(many, 'hub', { width: 960, height: 620, hubDegree: 1000 })
    const pts = [...F.positions.values()]
    let min = Infinity
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i]
        const b = pts[j]
        if (a && b) min = Math.min(min, Math.hypot(a.x - b.x, a.y - b.y))
      }
    }
    expect(min).toBeGreaterThan(F.cell * 0.9)
    for (const p of pts) {
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(620)
    }
  })

  /** An application linked to a role every one of `n` applications is, each with a date. */
  const roleStore = (n: number) => {
    const nodes = [node('role', 'role')]
    const links: [string, string][] = []
    for (let i = 0; i < n; i++) {
      nodes.push(node(`a${String(i).padStart(3, '0')}`, 'application'), node(`d${i}`, 'item'))
      links.push([`a${String(i).padStart(3, '0')}`, 'role'], [`d${i}`, `a${String(i).padStart(3, '0')}`])
    }
    return graphOf(nodes, links)
  }

  it('does not walk through a hub two steps out, and says what it stands for', () => {
    const F = focusLayout(roleStore(100), 'a000', { width: 960, height: 620 })
    expect(F.hop.get('role')).toBe(1)
    expect(F.hop.has('a001')).toBe(false)
    expect(F.collapsed.get('role')).toHaveLength(99)
    expect(F.omitted).toBe(0)
    expect(F.positions.size).toBe(3)
  })

  it('opens an expanded hub in a sector behind it: the first 36, then one more item', () => {
    const F = focusLayout(roleStore(100), 'a000', {
      width: 960,
      height: 620,
      expanded: ['role'],
    })
    expect(F.collapsed.has('role')).toBe(false)
    const more = F.more.get(`${MORE_PREFIX}role`)
    expect(more?.hub).toBe('role')
    expect(more?.ids).toHaveLength(99 - HUB_SHOWN)
    const children = [...F.parentOf].filter(([, p]) => p === 'role').map(([id]) => id)
    expect(children).toHaveLength(HUB_SHOWN + 1)
    // Sorted, and fanned out behind the hub rather than round the circle.
    expect(children.slice(0, 3)).toEqual(['a001', 'a002', 'a003'])
    const angle = (id: string) => {
      const p = F.positions.get(id)
      return p ? Math.atan2(p.y - F.y, p.x - F.x) : 0
    }
    const off = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))
    for (const id of children) expect(off(angle(id), angle('role'))).toBeLessThan(Math.PI / 2)
  })

  it('focuses a hub on its neighbours alone, capped with a more item', () => {
    const F = focusLayout(roleStore(100), 'role', { width: 960, height: 620 })
    expect(Math.max(...F.hop.values())).toBe(1)
    expect(F.positions.has(`${MORE_PREFIX}role`)).toBe(true)
    expect(F.positions.size).toBe(1 + HUB_SHOWN + 1)
    expect(HUB_DEGREE).toBe(12)
  })

  it('fans a hub’s neighbours out in a half circle below it when it is the centre', () => {
    const F = focusLayout(roleStore(30), 'role', { width: 960, height: 620 })
    const centre = F.positions.get('role')
    expect(centre).toEqual({ x: F.x, y: F.y })
    for (const [id, p] of F.positions) {
      if (id !== 'role' && centre) expect(p.y).toBeGreaterThan(centre.y)
    }
    expect(F.rings).toEqual([])
  })

  it('keeps every two records on an outer ring apart when sectors meet', () => {
    const nodes = [node('c')]
    const links: [string, string][] = []
    for (let i = 0; i < 8; i++) {
      nodes.push(node(`p${i}`))
      links.push(['c', `p${i}`])
      for (let j = 0; j < 9; j++) {
        nodes.push(node(`p${i}k${j}`))
        links.push([`p${i}`, `p${i}k${j}`])
      }
    }
    const F = focusLayout(graphOf(nodes, links), 'c', { width: 960, height: 620 })
    const pts = [...F.positions.values()]
    let min = Infinity
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i]
        const b = pts[j]
        if (a && b) min = Math.min(min, Math.hypot(a.x - b.x, a.y - b.y))
      }
    }
    expect(min).toBeGreaterThan(F.cell * 0.9)
  })

  it('returns nothing for a record the graph does not hold', () => {
    expect(focusLayout(g, 'missing', { width: 960, height: 620 }).positions.size).toBe(0)
  })
})

describe('satellites round an unfolded host', () => {
  it('seats every folded record outside the host, spaced along the arc', () => {
    const seats = satellites(30, { x: 100, y: 100 }, { radius: 8, spacing: 12 })
    expect(seats).toHaveLength(30)
    for (const s of seats) expect(Math.hypot(s.x - 100, s.y - 100)).toBeGreaterThan(8 + 12)
  })
})

describe('review 3: what the focus and overview layouts promise at their edges', () => {
  /** A hub `H` with `n` neighbours `c00`…, each holding `kids` children of its own. */
  const fanStore = (n: number, kids: number) => {
    const nodes = [node('H', 'role')]
    const links: [string, string][] = []
    for (let i = 0; i < n; i++) {
      const c = `c${String(i).padStart(2, '0')}`
      nodes.push(node(c, 'application'))
      links.push(['H', c])
      for (let j = 0; j < kids; j++) {
        nodes.push(node(`${c}k${j}`, 'item'))
        links.push([c, `${c}k${j}`])
      }
    }
    return graphOf(nodes, links)
  }
  const SECTOR_ARC = (2 * Math.PI) / 3
  const off = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))

  it.each([
    [20, ['c02', 'c17']],
    [30, ['c00', 'c15', 'c29']],
  ])('keeps each expanded neighbour’s family behind it on a hub’s fan (%i neighbours)', (n, open) => {
    const F = focusLayout(fanStore(n, 5), 'H', { width: 960, height: 560, expanded: open })
    const angle = (id: string) => {
      const p = F.positions.get(id)
      return p ? Math.atan2(p.y - F.y, p.x - F.x) : NaN
    }
    for (const parent of open) {
      const kids = [...F.parentOf].filter(([, p]) => p === parent).map(([id]) => id)
      expect(kids).toHaveLength(5)
      // Mean direction of the family, measured from the centre.
      const sx = kids.reduce((sum, id) => sum + Math.cos(angle(id)), 0)
      const sy = kids.reduce((sum, id) => sum + Math.sin(angle(id)), 0)
      expect(off(Math.atan2(sy, sx), angle(parent))).toBeLessThan(SECTOR_ARC / 2)
    }
  })

  /** Every record the focus view accounts for: drawn, behind a "+N more" item, or counted as omitted. */
  const accounted = (F: ReturnType<typeof focusLayout>) => {
    const drawn = [...F.positions.keys()].filter((id) => !id.startsWith(MORE_PREFIX)).length
    const behind = [...F.more.values()].reduce((sum, m) => sum + m.ids.length, 0)
    return drawn + behind + F.omitted
  }

  it('counts the records behind a "+N more" item the budget cut as not shown', () => {
    // Ten expanded hubs of a hundred each round one record, on the phone's budget.
    const nodes = [node('C', 'application')]
    const links: [string, string][] = []
    for (let h = 0; h < 10; h++) {
      nodes.push(node(`h${h}`, 'role'))
      links.push(['C', `h${h}`])
      for (let i = 0; i < 100; i++) {
        nodes.push(node(`h${h}a${i}`, 'application'))
        links.push([`h${h}`, `h${h}a${i}`])
      }
    }
    const hubs = Array.from({ length: 10 }, (_, h) => `h${h}`)
    const F = focusLayout(graphOf(nodes, links), 'C', { width: 400, height: 700, expanded: hubs, maxNodes: 160 })
    expect(F.positions.size).toBeLessThanOrEqual(160)
    expect(accounted(F)).toBe(1 + 10 + 1000)

    // A hub at the centre whose own "+N more" item is past the budget.
    const role = graphOf(
      [node('role', 'role'), ...Array.from({ length: 99 }, (_, i) => node(`a${i}`, 'application'))],
      Array.from({ length: 99 }, (_, i): [string, string] => ['role', `a${i}`]),
    )
    const R = focusLayout(role, 'role', { width: 960, height: 620, maxNodes: 30 })
    expect(R.more.size).toBe(0)
    expect(R.omitted).toBe(99 - 29)
    expect(accounted(R)).toBe(100)
  })

  it('falls back to even slots when an outer ring cannot fit its sectors, still a cell apart', () => {
    // Many small families round the whole circle: their sectors cannot all sit
    // behind their parents, so the ring is spread evenly in the same order.
    const nodes = [node('c')]
    const links: [string, string][] = []
    for (let i = 0; i < 12; i++) {
      nodes.push(node(`p${i}`))
      links.push(['c', `p${i}`])
      for (let j = 0; j < 20; j++) {
        nodes.push(node(`p${i}k${j}`))
        links.push([`p${i}`, `p${i}k${j}`])
      }
    }
    const open = Array.from({ length: 12 }, (_, i) => `p${i}`)
    const F = focusLayout(graphOf(nodes, links), 'c', { width: 960, height: 620, expanded: open, hubDegree: 100 })
    const ring2 = [...F.hop].filter(([, k]) => k === 2).map(([id]) => id)
    expect(ring2).toHaveLength(240)
    const pts = [...F.positions.values()]
    let min = Infinity
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i]
        const b = pts[j]
        if (a && b) min = Math.min(min, Math.hypot(a.x - b.x, a.y - b.y))
      }
    }
    expect(min).toBeGreaterThan(F.cell * 0.9)
  })

  it('finds the host of a record folded two levels deep, and nothing for a record not held', () => {
    const g = graphOf(
      [node('app', 'application'), node('note', 'note'), node('item', 'item')],
      [
        ['item', 'app'],
        ['note', 'item'],
      ],
    )
    const f = foldLeaves(g, { canFold: notApplication })
    expect(f.visible).toEqual(['app'])
    expect(f.host.get('note')).toBe('app')
    expect(f.host.get('item')).toBe('app')
    expect(hostOf(f, 'note')).toBe('app')
    expect(hostOf(f, 'app')).toBe('app')
    expect(hostOf(f, 'ghost')).toBeUndefined()
  })

  it('folds a leaf into a protected record that has no other link', () => {
    const f = foldLeaves(graphOf([node('app', 'application'), node('x')], [['x', 'app']]), {
      canFold: notApplication,
    })
    expect(f.visible).toEqual(['app'])
    expect(hostOf(f, 'x')).toBe('app')
  })

  it('pools the holders a kept value is left with when most went to a commoner one', () => {
    // X is held by two (enough to keep), but `a` goes to the commoner Y,
    // leaving X with one member: that one is pooled with the one-each.
    const g = graphOf(
      [
        node('a', 'application', { kw: ['X', 'Y'] }),
        node('b', 'application', { kw: ['X'] }),
        node('c', 'application', { kw: ['Y'] }),
        node('d', 'application', { kw: ['Y'] }),
      ],
      [],
    )
    const groups = groupOf(g, { by: 'kw' })
    expect(groups.get('a')).toBe('Y')
    expect(groups.get('b')).toBe(GROUP_SINGLES)
  })

  it('treats a real value starting with @ as a value, never as a key the module minted', () => {
    const g = graphOf(
      [
        ...Array.from({ length: 10 }, (_, i) => node(`o${i}`, 'application', { org: [`@Org${i}`] })),
        ...['k1', 'k2', 'k3'].map((id) => node(id, 'application', { org: ['@shared'] })),
        node('me', 'background', { org: ['@you'] }),
      ],
      [],
    )
    const groups = groupOf(g, { by: 'org' })
    // Ten employers with one application each are pooled like any other value.
    for (let i = 0; i < 10; i++) expect(groups.get(`o${i}`)).toBe(GROUP_SINGLES)
    // A value spelled like the Shared key is its own group, not Shared.
    expect(groups.get('k1')).not.toBe(GROUP_SHARED)
    expect(groupValue(groups.get('k1') ?? '')).toBe('@shared')
    expect(groups.get('k1')?.startsWith(GROUP_ESCAPE)).toBe(true)
    // The caller's own key still stands alone, however small.
    expect(groups.get('me')).toBe('@you')
    expect(groupOf(g, { by: 'org', specialKeys: [] }).get('me')).toBe(GROUP_SINGLES)
  })
})

// The timing test is `test/graph-view.perf.test.ts`: `check-platform` keeps the
// wall clock out of kg/core, its tests included.
