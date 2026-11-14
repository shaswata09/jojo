/**
 * The code flow graph is computed at build time from the source, so what can
 * rot is the RULES that compute it: a resolver that stops following an alias
 * draws a module with no arrows and nobody notices. The first half holds the
 * rules on small fixtures; the second builds the real graph, the same way the
 * build does, and checks what has to be true of it.
 */

import { describe, expect, it } from 'vitest'
import {
  TIERS,
  buildCodeGraph,
  collectSources,
  groupOf,
  importsOf,
  resolveImport,
} from '../../../scripts/code-graph.mjs'
import { CHANNELS } from './flow-map'
import { layoutCodeGraph } from './flow-layout'

describe('reading imports', () => {
  it('finds static, re-export, side-effect and dynamic imports', () => {
    const source = [
      "import { a } from './a'",
      "export { b } from '../b'",
      "import './side'",
      "const C = lazy(() => import('@/c'))",
    ].join('\n')
    expect(importsOf(source).sort()).toEqual(['../b', './a', './side', '@/c'])
  })

  it('leaves out type-only imports, which are not code that runs', () => {
    const source = [
      "import type { A } from './a'",
      "import { type B, type C } from './b'",
      "export type { D } from './d'",
      "import { type E, f } from './e'",
    ].join('\n')
    expect(importsOf(source)).toEqual(['./e'])
  })

  it('ignores imports inside comments and imports that load text', () => {
    const source = ["// import { x } from './x'", '/* import y from "./y" */', "import css from './z.css?raw'"].join('\n')
    expect(importsOf(source)).toEqual([])
  })

  it('finds an import that follows another statement on the same line', () => {
    expect(importsOf("const a = 1; import { b } from './b'")).toEqual(['./b'])
  })
})

describe('resolving an import', () => {
  const known = new Set([
    'service/kg/core/model.ts',
    'service/kg/react/kg.tsx',
    'service/kg/log.ts',
    'service/data/seed.ts',
    'web/src/lib/links.ts',
    'web/src/components/guide/flow-map.ts',
    'mobile/src/lib/links.ts',
    'web/extension/serialise.js',
  ])

  it('follows relative paths, with or without an extension', () => {
    expect(resolveImport('./flow-map', 'web/src/components/guide/x.ts', known)).toBe(
      'web/src/components/guide/flow-map.ts',
    )
    expect(resolveImport('./serialise.js', 'web/extension/background.js', known)).toBe(
      'web/extension/serialise.js',
    )
  })

  it("resolves each app's own @/ alias", () => {
    expect(resolveImport('@/lib/links', 'web/src/routes/A.tsx', known)).toBe('web/src/lib/links.ts')
    expect(resolveImport('@/lib/links', 'mobile/src/screens/A.tsx', known)).toBe('mobile/src/lib/links.ts')
  })

  it("follows the service's exports map", () => {
    expect(resolveImport('@jojo/service/core/model', 'web/src/x.ts', known)).toBe('service/kg/core/model.ts')
    expect(resolveImport('@jojo/service/react/kg', 'web/src/x.ts', known)).toBe('service/kg/react/kg.tsx')
    expect(resolveImport('@jojo/service/data/seed', 'web/src/x.ts', known)).toBe('service/data/seed.ts')
    expect(resolveImport('@jojo/service/log', 'web/src/x.ts', known)).toBe('service/kg/log.ts')
  })

  it('returns null for a package', () => {
    expect(resolveImport('react', 'web/src/x.ts', known)).toBeNull()
  })
})

describe('grouping files', () => {
  it('puts each file in its module and its layer', () => {
    expect(groupOf('service/kg/agent/loop.ts')).toEqual({ id: 'service/kg/agent', band: 'service', tier: 'agent' })
    expect(groupOf('web/src/components/vault/FilesTool.tsx')).toMatchObject({ id: 'web/components/vault', tier: 'components' })
    expect(groupOf('web/src/routes/Graph.tsx')).toMatchObject({ id: 'web/routes', tier: 'screens' })
    expect(groupOf('web/src/lib/pdf/document.ts')).toMatchObject({ id: 'web/lib/pdf', tier: 'app-lib' })
    expect(groupOf('web/src/kg/storage/idb-driver.ts')).toMatchObject({ id: 'web/kg/storage', tier: 'storage' })
    expect(groupOf('mobile/App.tsx')).toMatchObject({ id: 'mobile/entry', band: 'mobile' })
    expect(groupOf('web/extension/background.js')).toMatchObject({ id: 'web/extension', tier: 'entry' })
  })
})

describe('the real code flow graph', () => {
  // `collectSources` reads from disk exactly as the build's plugin does, so this
  // is the graph the page draws, not a reconstruction of it.
  const root = new URL('../../../../', import.meta.url).pathname
  const graph = buildCodeGraph(collectSources(root))
  const tierOf = new Map(graph.groups.map((g) => [g.id, TIERS.indexOf(g.tier)]))

  it('covers every part of the code, so a missing module would show', () => {
    const ids = new Set(graph.groups.map((g) => g.id))
    for (const layer of ['core', 'storage', 'repo', 'tools', 'agent', 'react']) {
      expect(ids.has(`service/kg/${layer}`), layer).toBe(true)
    }
    for (const id of ['web/routes', 'web/lib', 'web/extension', 'jojo-bridge', 'mobile/screens', 'mobile/lib']) {
      expect(ids.has(id), id).toBe(true)
    }
    expect(graph.files.length).toBeGreaterThan(500)
  })

  it('resolves most imports — a broken alias would leave modules unconnected', () => {
    const withImports = graph.files.filter((f) => f.imports.length > 0).length
    expect(withImports / graph.files.length).toBeGreaterThan(0.6)
  })

  it('never has a service layer importing from a layer above it', () => {
    const upward = graph.edges.filter(
      (e) =>
        e.from.startsWith('service/') &&
        e.to.startsWith('service/') &&
        (tierOf.get(e.to) ?? 0) < (tierOf.get(e.from) ?? 0),
    )
    expect(upward).toEqual([])
  })

  it('never has the shared service importing from an app', () => {
    expect(graph.edges.filter((e) => e.from.startsWith('service/') && !e.to.startsWith('service/'))).toEqual([])
  })

  it('joins the hand-drawn channels to groups the graph has', () => {
    const ids = new Set(graph.groups.map((g) => g.id))
    for (const c of CHANNELS) {
      expect(ids.has(c.from), c.from).toBe(true)
      expect(ids.has(c.to), c.to).toBe(true)
    }
  })

  it('lays every group out once, with no two in the same place', () => {
    const layout = layoutCodeGraph(graph)
    expect(layout.nodes).toHaveLength(graph.groups.length)
    const spots = new Set(layout.nodes.map((n) => `${n.x},${n.y}`))
    expect(spots.size).toBe(layout.nodes.length)
  })
})
