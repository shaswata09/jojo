import { describe, expect, it } from 'vitest'
import { FLOW_ROW, flowBoxHeight, hasForwardCycle, layoutCodeGraph, layoutControlFlow } from './flow-layout'

const n = (id: string) => ({ id, kind: 'step' as const, label: id, layer: 'web' as const, path: 'x' })

describe('laying out a control flow', () => {
  it('ranks each node below the longest chain into it, ignoring loops', () => {
    const placed = layoutControlFlow({
      nodes: [n('a'), n('b'), n('c')],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'a', back: true },
      ],
    })
    expect(placed.map((p) => p.y)).toEqual([0, FLOW_ROW, 2 * FLOW_ROW])
  })

  it('moves a skipped box aside so the jump over it is visible', () => {
    // a → b → c, and a → c: the jump would run straight through b.
    const placed = layoutControlFlow({
      nodes: [n('a'), n('b'), n('c')],
      edges: [
        { from: 'a', to: 'b', label: 'no' },
        { from: 'a', to: 'c', label: 'yes' },
        { from: 'b', to: 'c' },
      ],
    })
    const at = Object.fromEntries(placed.map((p) => [p.id, p.x]))
    expect(at['b']).not.toBe(at['a'])
    expect(at['c']).toBe(at['a'])
  })

  it('leaves a plain chain in one column', () => {
    const placed = layoutControlFlow({ nodes: [n('a'), n('b')], edges: [{ from: 'a', to: 'b' }] })
    expect(new Set(placed.map((p) => p.x)).size).toBe(1)
  })

  it('finds a loop that was not marked as one', () => {
    expect(
      hasForwardCycle({ nodes: [n('a'), n('b')], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }] }),
    ).toBe(true)
  })

  it('draws a deep chart tall enough to read, within bounds', () => {
    expect(flowBoxHeight([{ id: 'a', x: 0, y: 0 }])).toBe(360)
    expect(flowBoxHeight([{ id: 'a', x: 0, y: 100 * FLOW_ROW }])).toBe(1500)
  })
})

describe('laying out the code graph', () => {
  it('puts the service between the two apps, and every layer below the one above', () => {
    const g = (id: string, band: 'web' | 'service' | 'mobile', tier: 'screens' | 'react' | 'core') => ({
      id,
      label: id,
      band,
      tier,
      files: 1,
      lines: 1,
    })
    const layout = layoutCodeGraph({
      groups: [g('w', 'web', 'screens'), g('m', 'mobile', 'screens'), g('r', 'service', 'react'), g('c', 'service', 'core')],
    })
    const at = Object.fromEntries(layout.nodes.map((p) => [p.id, p]))
    expect(at['w']!.x).toBeLessThan(at['r']!.x)
    expect(at['r']!.x).toBeLessThan(at['m']!.x)
    expect(at['r']!.y).toBeLessThan(at['c']!.y)
    expect(layout.lanes.map((l) => l.tier)).toEqual(['screens', 'react', 'core'])
  })
})
