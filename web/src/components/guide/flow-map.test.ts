/**
 * The Control flow graph page's map names over a hundred files. A map whose names have rotted
 * sends a reader to put code somewhere that no longer exists, so every path it
 * names must still be in the repo.
 *
 * Listed with FILE-relative globs, as `code-structure.test.ts` does, so the
 * test walks out of the app without `node:fs`. Lazy rather than eager: only the
 * keys are wanted, and `?raw` keeps `check-no-copies` from reading these as
 * imports of the service.
 */

import { describe, expect, it } from 'vitest'
import { CHANNELS, CONTROL_FLOWS, FLOW_LAYERS, flowMapPaths } from './flow-map'
import { hasForwardCycle } from './flow-layout'

const listed = import.meta.glob(
  [
    '../../../../service/{kg,data,scripts,test}/**/*.{ts,tsx,mjs}',
    '../../../../web/{src,scripts}/**/*.{ts,tsx,mjs}',
    '../../../../web/extension/*.{js,json}',
    '../../../../web/extension/worker/*.js',
    '../../../../mobile/{src,scripts}/**/*.{ts,tsx,mjs}',
    '../../../../mobile/App.tsx',
    '../../../../jojo-bridge.mjs',
    '../../../../gate.sh',
    '../../../../.github/workflows/ci.yml',
  ],
  { query: '?raw', import: 'default' },
)

/**
 * Repo-relative, the way the map spells them.
 *
 * Vite rewrites each key relative to THIS file, however the pattern was
 * written — a web file comes back as `../../../extension/bridge.js`, a service
 * file as `../../../../service/…` — so a key is resolved against this file's
 * folder rather than stripped of its leading `../`.
 */
const HERE = ['web', 'src', 'components', 'guide']
const repoPath = (key: string) => {
  const parts = key.startsWith('/') ? ['web', ...key.slice(1).split('/')] : [...HERE, ...key.split('/')]
  const out: string[] = []
  for (const part of parts) {
    if (part === '..') out.pop()
    else if (part !== '.') out.push(part)
  }
  return out.join('/')
}
const files = new Set(Object.keys(listed).map(repoPath))
// Vite leaves the calling module out of its own glob.
files.add('web/src/components/guide/flow-map.test.ts')

const exists = (path: string) =>
  files.has(path) || [...files].some((file) => file.startsWith(`${path}/`))

describe('the control flow map', () => {
  it('globbed the repo at all, so the check below is not vacuous', () => {
    expect(files.has('service/kg/core/model.ts')).toBe(true)
    expect(files.has('web/src/App.tsx')).toBe(true)
    expect(files.has('mobile/App.tsx')).toBe(true)
    expect(files.has('.github/workflows/ci.yml')).toBe(true)
  })

  it('names only paths that exist', () => {
    expect(flowMapPaths().filter((path) => !exists(path))).toEqual([])
  })

  it('draws every node in a layer the map defines', () => {
    const layers = new Set(FLOW_LAYERS.map((layer) => layer.id))
    for (const flow of CONTROL_FLOWS) {
      for (const node of flow.nodes) expect(layers.has(node.layer), `${flow.id}/${node.id}`).toBe(true)
    }
  })
})

describe('each control flow graph', () => {
  for (const flow of CONTROL_FLOWS) {
    describe(flow.name, () => {
      const ids = new Set(flow.nodes.map((n) => n.id))
      const out = (id: string) => flow.edges.filter((e) => e.from === id)

      it('has unique node ids and exactly one start', () => {
        expect(ids.size).toBe(flow.nodes.length)
        expect(flow.nodes.filter((n) => n.kind === 'start')).toHaveLength(1)
      })

      it('only joins nodes it has', () => {
        for (const e of flow.edges) {
          expect(ids.has(e.from), `${e.from} → ${e.to}`).toBe(true)
          expect(ids.has(e.to), `${e.from} → ${e.to}`).toBe(true)
        }
      })

      it('gives every decision at least two ways out, each labelled', () => {
        for (const n of flow.nodes.filter((n) => n.kind === 'decision')) {
          expect(out(n.id).length, n.id).toBeGreaterThanOrEqual(2)
          for (const e of out(n.id)) expect(e.label, `${n.id} → ${e.to}`).toBeTruthy()
        }
      })

      it('ends only at an end or a stop, and nothing goes on from one', () => {
        for (const n of flow.nodes) {
          const terminal = n.kind === 'end' || n.kind === 'stop'
          expect(out(n.id).length === 0, n.id).toBe(terminal)
        }
      })

      it('reaches every node from the start', () => {
        const start = flow.nodes.find((n) => n.kind === 'start')?.id ?? ''
        const seen = new Set([start])
        const queue = [start]
        while (queue.length > 0) {
          for (const e of out(queue.shift() ?? '')) {
            if (!seen.has(e.to)) {
              seen.add(e.to)
              queue.push(e.to)
            }
          }
        }
        expect([...ids].filter((id) => !seen.has(id))).toEqual([])
      })

      it('marks every loop as one, so it can be laid out top to bottom', () => {
        expect(hasForwardCycle(flow)).toBe(false)
      })
    })
  }

  it('connects channels between parts that exist on the code graph', () => {
    const groups = new Set(['web/lib', 'web/extension', 'jojo-bridge', 'mobile/lib'])
    for (const c of CHANNELS) {
      expect(groups.has(c.from), c.from).toBe(true)
      expect(groups.has(c.to), c.to).toBe(true)
    }
  })
})
