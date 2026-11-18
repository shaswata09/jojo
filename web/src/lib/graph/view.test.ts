/**
 * The /graph adapter to the shared overview rules (`kg/core/graph-view.ts`):
 * what each application is grouped by, the seat order inside a group, how a
 * group's key is put into words, and which picture the page draws. Run, not
 * read — `overview.requests.test.ts` pins the wiring round these.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { GROUP_LOOSE, GROUP_NONE, GROUP_TYPE_PREFIX } from '@jojo/service/core/graph-view'
import type { ViewNode } from '@jojo/service/core/graph-view'
import { i18next, loadLocale } from '@/i18n/i18n'
import type { Graph, GraphEdge, GraphNode, GraphRel } from '@/lib/graph/model'
import { GROUP_YOU, basePicture, groupName, listJoiner, memberOrder, toViewGraph } from './view'

function graphOf(
  nodes: { id: string; type: GraphNode['type']; label?: string; stage?: string }[],
  links: [string, string, GraphRel][],
): Graph {
  const all: GraphNode[] = nodes.map(({ id, type, label, stage }) => ({
    id,
    type,
    label: label ?? id,
    recordId: id,
    degree: 0,
    ...(stage ? { stage } : {}),
  })) as GraphNode[]
  const edges: GraphEdge[] = links.map(([from, to, rel]) => ({
    id: `${from}|${rel}|${to}`,
    from,
    to,
    rel,
  }))
  const byId = new Map(all.map((n) => [n.id, n]))
  return {
    nodes: all,
    edges,
    byId,
    edgeById: new Map(edges.map((e) => [e.id, e])),
    incident: new Map(),
  }
}

const keysOf = (graph: Graph, id: string) =>
  toViewGraph(graph).nodes.find((n) => n.id === id)?.groupKeys

afterEach(async () => {
  await i18next.changeLanguage('en')
})

describe('what an application is grouped by', () => {
  it('reads role, employer and keyword off its own edges, and its stage off the record', () => {
    const graph = graphOf(
      [
        { id: 'app', type: 'application', stage: 'interview' },
        { id: 'r', type: 'role', label: 'Postdoc' },
        { id: 'o', type: 'organisation', label: 'Rice' },
        { id: 'k', type: 'keyword', label: 'ml' },
      ],
      [
        ['app', 'r', 'IS'],
        ['app', 'o', 'AT'],
        // Either direction: a keyword pointing at the application counts too.
        ['k', 'app', 'TAGS'],
      ],
    )
    expect(keysOf(graph, 'app')).toEqual({
      role: ['Postdoc'],
      stage: ['interview'],
      organisation: ['Rice'],
      keyword: ['ml'],
    })
  })

  it('ignores an edge between two other records, and one to a record not drawn', () => {
    const graph = graphOf(
      [
        { id: 'app', type: 'application' },
        { id: 'o', type: 'organisation', label: 'Rice' },
        { id: 'k', type: 'keyword', label: 'ml' },
      ],
      [
        ['o', 'k', 'TAGS'],
        ['app', 'gone', 'TAGS'],
      ],
    )
    expect(keysOf(graph, 'app')).toEqual({ role: [], stage: [], organisation: [], keyword: [] })
    // Records that are not applications carry no group values of their own.
    expect(keysOf(graph, 'o')).toBeUndefined()
  })

  it('groups the person’s own records together on every dimension', () => {
    const graph = graphOf([{ id: 'bg', type: 'background' }], [])
    expect(keysOf(graph, 'bg')).toEqual({
      role: [GROUP_YOU],
      stage: [GROUP_YOU],
      organisation: [GROUP_YOU],
      keyword: [GROUP_YOU],
    })
  })
})

describe('the seat order inside a group', () => {
  const node = (id: string, type: string, label = id, stage?: string): ViewNode => ({
    id,
    type,
    label,
    ...(stage ? { groupKeys: { stage: [stage] } } : {}),
  })

  it('seats the hub a group is about before its applications', () => {
    const sorted = [node('a', 'application'), node('r', 'role')].sort(memberOrder)
    expect(sorted.map((n) => n.id)).toEqual(['r', 'a'])
  })

  it('seats applications in pipeline order, then by name, then by id', () => {
    const sorted = [
      node('1', 'application', 'B', 'interview'),
      node('2', 'application', 'A', 'draft'),
      node('3', 'application', 'A', 'interview'),
      node('5', 'application', 'A'),
      node('4', 'application', 'A', 'interview'),
    ].sort(memberOrder)
    // draft before interview; equal stages by label, equal labels by id; no stage last.
    expect(sorted.map((n) => n.id)).toEqual(['2', '3', '4', '1', '5'])
  })
})

describe('a group’s name', () => {
  it('words the special groups, and the person’s own as their background', async () => {
    const t = i18next.getFixedT('en', 'graph')
    expect(groupName(GROUP_LOOSE, 'role', t)).toBe(t('view.group.loose'))
    expect(groupName(GROUP_NONE, 'keyword', t)).toBe(t('view.group.none'))
    expect(groupName(GROUP_YOU, 'role', t)).toBe(i18next.t('messages:graph.nodeType.background'))
    expect(groupName(`${GROUP_TYPE_PREFIX}file`, 'role', t)).toBe(
      i18next.t('messages:graph.nodeType.file'),
    )
  })

  it('shows a stage in the language on screen, and any other value as stored', async () => {
    await loadLocale('de')
    await i18next.changeLanguage('de')
    const t = i18next.getFixedT('de', 'graph')
    expect(groupName('interview', 'stage', t)).toBe('Vorstellungsgespräch')
    // Only under Group by Stage: a role named "interview" is a role.
    expect(groupName('interview', 'role', t)).toBe('interview')
    expect(groupName('Postdoc', 'role', t)).toBe('Postdoc')
  })
})

describe('a list of counted phrases', () => {
  it('joins in English by hand and in other languages by the platform', () => {
    expect(listJoiner('en')(['a', 'b', 'c'])).toBe('a, b and c')
    expect(listJoiner('fr')(['a', 'b', 'c'])).toBe('a, b et c')
    expect(listJoiner('fr')(['a'])).toBe('a')
    expect(listJoiner('fr')([])).toBe('')
  })
})

describe('the picture the page draws outside focus', () => {
  it('follows the folded size in auto, but never asks the free layout to drop records', () => {
    expect(basePicture('auto', { large: true, freeAllowed: true })).toBe('overview')
    expect(basePicture('auto', { large: false, freeAllowed: true })).toBe('free')
    // A legend filter that leaves thousands of loose records: small when
    // folded, too many to draw freely.
    expect(basePicture('auto', { large: false, freeAllowed: false })).toBe('overview')
  })

  it('honours a picture chosen by hand, falling back from Free when it cannot draw it', () => {
    expect(basePicture('overview', { large: false, freeAllowed: true })).toBe('overview')
    expect(basePicture('free', { large: true, freeAllowed: true })).toBe('free')
    expect(basePicture('free', { large: false, freeAllowed: false })).toBe('overview')
  })
})
