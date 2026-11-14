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
import { CHANNELS, CONTROL_FLOWS, FLOW_LAYERS, flowMapPaths, flowSteps, tabForKey } from './flow-map'
import type { ControlFlow } from './flow-map'
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

/*
 * Two charts that once told a maintainer something the code does not do. Each
 * check is the shape of the code path, so redrawing the chart back into the
 * old shape fails here.
 */
describe('the charts say what the code does', () => {
  const flow = (id: string) => CONTROL_FLOWS.find((f) => f.id === id) as ControlFlow
  const kindOf = (f: ControlFlow, id: string) => f.nodes.find((n) => n.id === id)?.kind
  const exits = (f: ControlFlow, id: string) => f.edges.filter((e) => e.from === id)

  it('From link: the extension and the leak check can each stop the read with a reason', () => {
    // `capturePage` returns {ok:false} for a stale extension, a worker refusal,
    // a timeout, and a page `readCapture` rejects; `openPage` stops on any of them.
    const f = flow('from-link')
    for (const id of ['capture', 'gate']) {
      expect(kindOf(f, id), id).toBe('decision')
      expect(exits(f, id).some((e) => kindOf(f, e.to) === 'stop'), id).toBe(true)
    }
    // And the reader's fetch, which `convertUrl` can fail the same way.
    expect(exits(f, 'fetch').some((e) => kindOf(f, e.to) === 'stop')).toBe(true)
  })

  it('Creating: the card and its Undo come straight from the commit, before the disk', () => {
    // `repository.commit` is synchronous and only queues the disk write;
    // `create()` toasts at once, and `queue.ts` never rolls a failed write back.
    const f = flow('create-web')
    const fromCommit = exits(f, 'commit').map((e) => e.to)
    expect(fromCommit).toContain('shown')
    expect(kindOf(f, 'shown')).toBe('end')
    expect(f.edges.some((e) => e.to === 'shown' && e.from === 'disk')).toBe(false)
    expect(exits(f, 'disk').map((e) => e.to)).toContain('banner')
  })

  it('Assistant turn: the approval gate shows the floor no mode lifts', () => {
    // `isGated` returns true for `alwaysAsks` (memory.reset, memory.clear)
    // before it reads the mode, so even "act without asking" asks for these.
    const gate = flow('chat-turn').nodes.find((n) => n.id === 'gate')
    expect(gate?.path).toBe('service/kg/agent/perform-call.ts')
    expect(gate?.label).toMatch(/always/i)
  })

  it('Creating: the duplicate prompt offers all four of its buttons', () => {
    const labels = exits(flow('create-web'), 'confirm').map((e) => e.label ?? '')
    for (const word of ['open', 'discard', 'edit instead', 'add anyway']) {
      expect(labels.some((l) => l.toLowerCase().includes(word)), word).toBe(true)
    }
  })
})

describe('a chart as text', () => {
  const tiny: Pick<ControlFlow, 'nodes' | 'edges'> = {
    nodes: [
      { id: 'a', kind: 'start', label: 'Begin', layer: 'web', path: 'web/a.ts' },
      { id: 'b', kind: 'decision', label: 'Good?', layer: 'web', path: 'web/b.ts' },
      { id: 'c', kind: 'stop', label: 'Refused', layer: 'web', path: 'web/c.ts' },
      { id: 'd', kind: 'end', label: 'Done', layer: 'web', path: 'web/d.ts' },
    ],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c', label: 'no' },
      { from: 'b', to: 'd', label: 'yes' },
      { from: 'b', to: 'a', label: 'retry', back: true },
    ],
  }

  it('numbers the boxes and names each branch and where it leads', () => {
    expect(flowSteps(tiny)).toEqual([
      { id: 'a', text: 'Start: Begin. In web/a.ts', exits: ['Next: step 2, Good?'] },
      {
        id: 'b',
        text: 'Decision: Good? In web/b.ts',
        exits: ['no: step 3, Refused', 'yes: step 4, Done', 'retry: step 1, Begin (back to an earlier step)'],
      },
      { id: 'c', text: 'Stops here: Refused. In web/c.ts', exits: ['The journey stops here.'] },
      { id: 'd', text: 'End: Done. In web/d.ts', exits: ['The journey ends here.'] },
    ])
  })

  it('gives every node of every real chart a line, and every decision a labelled exit per branch', () => {
    for (const f of CONTROL_FLOWS) {
      const steps = flowSteps(f)
      expect(steps.map((s) => s.id)).toEqual(f.nodes.map((n) => n.id))
      for (const s of steps) {
        expect(s.exits.length, `${f.id}/${s.id}`).toBeGreaterThan(0)
        expect(s.exits.join(' '), `${f.id}/${s.id}`).not.toContain('step ?')
      }
    }
  })
})

describe('the journey tabs', () => {
  it('step with the arrows, wrapping at both ends, and jump with Home and End', () => {
    expect(tabForKey('ArrowRight', 0, 6)).toBe(1)
    expect(tabForKey('ArrowRight', 5, 6)).toBe(0)
    expect(tabForKey('ArrowLeft', 0, 6)).toBe(5)
    expect(tabForKey('ArrowLeft', 3, 6)).toBe(2)
    expect(tabForKey('Home', 4, 6)).toBe(0)
    expect(tabForKey('End', 1, 6)).toBe(5)
  })

  it('leave every other key alone, so Tab still leaves the list', () => {
    for (const key of ['Tab', 'Enter', ' ', 'ArrowUp', 'ArrowDown', 'a']) expect(tabForKey(key, 2, 6)).toBeNull()
    expect(tabForKey('ArrowRight', 0, 0)).toBeNull()
  })
})
