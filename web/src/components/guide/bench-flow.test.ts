import { describe, expect, it } from 'vitest'

import type { Workflow } from '@jojo/service/agent/bench-conversations'
import { CONVERSATIONS } from '@jojo/service/agent/bench-conversations'

import { shapeOf } from '@jojo/service/agent/bench-workflow'

import { COLUMN_WIDTH, isRuntimeArg, layerOf, layoutOf, ROW_HEIGHT } from './bench-flow'

const flow = (nodes: [string, string][], links: [string, string][]): Workflow => ({
  nodes: nodes.map(([id, tool]) => ({ id, tool, why: `because ${tool}` })),
  links: links.map(([source, target]) => ({ source, target })),
  shape: 'dag',
})

describe('layerOf', () => {
  it('puts a chain on consecutive layers', () => {
    const layers = layerOf(flow([['a', 'memory.search'], ['b', 'application.stage.set']], [['a', 'b']]))
    expect(layers?.get('a')).toBe(0)
    expect(layers?.get('b')).toBe(1)
  })

  it('puts two independent nodes on the same layer', () => {
    const layers = layerOf(flow([['a', 'memory.search'], ['b', 'stats.stages']], []))
    expect(layers?.get('a')).toBe(0)
    expect(layers?.get('b')).toBe(0)
  })

  it('uses the LONGEST path, so a join sits after both parents', () => {
    // a -> b -> c and a -> c. c must be at 2, not at 1.
    const layers = layerOf(
      flow(
        [['a', 'memory.search'], ['b', 'graph.neighbours'], ['c', 'timeline.item.create']],
        [['a', 'b'], ['b', 'c'], ['a', 'c']],
      ),
    )
    expect(layers?.get('c')).toBe(2)
  })

  it('refuses a cycle', () => {
    expect(layerOf(flow([['a', 'x'], ['b', 'y']], [['a', 'b'], ['b', 'a']]))).toBeNull()
  })

  it('refuses a link naming a node that is not there', () => {
    expect(layerOf(flow([['a', 'x']], [['a', 'ghost']]))).toBeNull()
  })
})

describe('layoutOf', () => {
  it('is empty for a conversation with no workflow', () => {
    const layout = layoutOf(undefined)
    expect(layout.nodes).toHaveLength(0)
    expect(layout.problem).toBeNull()
  })

  it('spaces layers by COLUMN_WIDTH and rows by ROW_HEIGHT', () => {
    const layout = layoutOf(flow([['a', 'x'], ['b', 'y'], ['c', 'z']], [['a', 'c']]))
    const at = (id: string) => layout.nodes.find((n) => n.id === id)!.position
    expect(at('a')).toEqual({ x: 0, y: 0 })
    expect(at('b')).toEqual({ x: 0, y: ROW_HEIGHT })
    expect(at('c')).toEqual({ x: COLUMN_WIDTH, y: 0 })
  })

  it('reports a cycle instead of drawing half of it', () => {
    const layout = layoutOf(flow([['a', 'x'], ['b', 'y']], [['a', 'b'], ['b', 'a']]))
    expect(layout.problem).toContain('cycle')
    expect(layout.nodes).toHaveLength(0)
  })

  it('marks a node whose every argument is runtime-only', () => {
    const workflow: Workflow = {
      nodes: [
        { id: 'a', tool: 'memory.search', args: { query: 'Rice' }, why: 'find it' },
        { id: 'b', tool: 'application.stage.set', args: { id: '$a' }, why: 'move it' },
      ],
      links: [{ source: 'a', target: 'b' }],
      shape: 'chain',
    }
    const layout = layoutOf(workflow)
    expect(layout.nodes.find((n) => n.id === 'a')!.data.runtimeOnly).toBe(false)
    expect(layout.nodes.find((n) => n.id === 'b')!.data.runtimeOnly).toBe(true)
  })

  it('carries one edge per link, with a stable id', () => {
    const layout = layoutOf(flow([['a', 'x'], ['b', 'y']], [['a', 'b']]))
    expect(layout.edges).toEqual([{ id: 'a->b', source: 'a', target: 'b' }])
  })
})

describe('shapeOf', () => {
  it('names a single node, a chain and a branch', () => {
    expect(shapeOf(flow([['a', 'x']], []))).toBe('single')
    expect(shapeOf(flow([['a', 'x'], ['b', 'y']], [['a', 'b']]))).toBe('chain')
    expect(shapeOf(flow([['a', 'x'], ['b', 'y'], ['c', 'z']], [['a', 'b'], ['a', 'c']]))).toBe('dag')
  })

  it('calls a join a dag, which is the case the two copies disagreed on', () => {
    // Two independent calls feeding one write: three nodes, two links, every
    // SOURCE distinct. The definition that only checked sources read this as a
    // chain, and `tag-new-keyword` is exactly this shape.
    expect(shapeOf(flow([['a', 'x'], ['b', 'y'], ['c', 'z']], [['a', 'c'], ['b', 'c']]))).toBe('dag')
  })
})

describe('isRuntimeArg', () => {
  it('is true only for a value naming another node', () => {
    expect(isRuntimeArg('$s1')).toBe(true)
    expect(isRuntimeArg('Rice')).toBe(false)
  })
})

describe('the authored workflows', () => {
  it('every one lays out — no cycles, no dangling links', () => {
    const broken = CONVERSATIONS.filter((c) => c.workflow !== undefined).filter(
      (c) => layoutOf(c.workflow).problem !== null,
    )
    expect(broken.map((c) => c.id)).toEqual([])
  })

  it('every declared shape matches the links it was drawn from', () => {
    const wrong = CONVERSATIONS.filter((c) => c.workflow !== undefined)
      .filter((c) => c.workflow!.nodes.length > 0)
      .filter((c) => shapeOf(c.workflow!) !== c.workflow!.shape)
      .map((c) => `${c.id}: says ${c.workflow!.shape}, draws ${shapeOf(c.workflow!)}`)
    expect(wrong).toEqual([])
  })
})
