import { describe, expect, it } from 'vitest'
import { fileLinks, filesOf, neighboursOf, strokeFor } from './code-graph-view'

const graph = {
  files: [
    { path: 'web/src/routes/A.tsx', group: 'web/routes', lines: 40, imports: [1, 2] },
    { path: 'web/src/lib/a.ts', group: 'web/lib', lines: 90, imports: [2] },
    { path: 'service/kg/core/m.ts', group: 'service/kg/core', lines: 10, imports: [] },
  ],
  edges: [
    { from: 'web/routes', to: 'web/lib', count: 1 },
    { from: 'web/routes', to: 'service/kg/core', count: 3 },
    { from: 'web/lib', to: 'service/kg/core', count: 1 },
  ],
}

describe('the code graph panel', () => {
  it('lists what a module uses and what uses it, busiest first', () => {
    expect(neighboursOf(graph, 'web/routes').uses.map((l) => l.id)).toEqual(['service/kg/core', 'web/lib'])
    expect(neighboursOf(graph, 'service/kg/core').usedBy).toEqual([
      { id: 'web/routes', count: 3 },
      { id: 'web/lib', count: 1 },
    ])
  })

  it('lists a module’s files, largest first', () => {
    expect(filesOf(graph, 'web/lib').map((f) => f.path)).toEqual(['web/src/lib/a.ts'])
  })

  it('follows one file both ways', () => {
    expect(fileLinks(graph, 'web/src/lib/a.ts')).toEqual({
      imports: ['service/kg/core/m.ts'],
      importedBy: ['web/src/routes/A.tsx'],
    })
    expect(fileLinks(graph, 'nope.ts')).toEqual({ imports: [], importedBy: [] })
  })

  it('draws a busier path thicker, within bounds', () => {
    expect(strokeFor(1)).toBe(1)
    expect(strokeFor(8)).toBe(4)
    expect(strokeFor(1000)).toBe(4)
  })
})
