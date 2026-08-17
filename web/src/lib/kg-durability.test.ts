/**
 * The sentence this wave exists to make true: close the tab, reopen, it is there.
 *
 * Everything else about durability is tested a layer at a time —
 * `kg/storage/idb-driver.test.ts` asks whether IndexedDB keeps the rows,
 * `kg/repo/boot.test.ts` asks what boot decides about them. Neither of them can
 * ask the only question the user has, which is whether a record they typed is
 * still there tomorrow. That question needs the whole stack: a tool, the
 * repository, the write-behind queue, a real transaction, and a second boot.
 *
 * It lives in `src/lib` rather than under `service/kg` because this is where the
 * pieces are allowed to meet. `service/kg/repo` compiles with no DOM lib, so it
 * cannot name the IndexedDB driver, and `web/src/kg/storage` may not import the
 * layer above it — the composition happens in the app shell, and so does the
 * test of the composition. `src/lib/store.tsx` is the production version of the
 * first ten lines below.
 */

import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { boot, resetBoot } from '@jojo/service/repo/boot'
import type { Session } from '@jojo/service/repo/boot'
import { createIdbDriver } from '@/kg/storage/idb-driver'
import { createToolRuntime } from '@jojo/service/tools/runtime'

const NOW = '2026-10-12T12:00:00.000Z'
const LATER = '2026-10-13T09:30:00.000Z'

let sequence = 0
const nextName = () => `jojo-durability-${(sequence += 1)}`

/** One tab: its own driver, its own connection, its own boot. */
async function openTab(name: string, now: string, dataSet?: 'demo' | 'empty') {
  resetBoot()
  const result = await boot({
    now: () => now,
    // `channel: null` because Node delivers BroadcastChannel messages between
    // contexts in the same process, so two "tabs" here would talk to each other
    // AND to every other test file running in parallel.
    driver: createIdbDriver({ name, channel: null }),
    ...(dataSet === undefined ? {} : { dataSet }),
  })
  if (result.outcome === 'corrupt') throw new Error(`boot went corrupt: ${result.detail}`)
  return result
}

const graphOf = (session: Session) => {
  const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : 1)
  const m = session.repo.getSnapshot()
  return { nodes: [...m.nodes()].sort(byId), edges: [...m.edges()].sort(byId) }
}

describe('a record the user typed', () => {
  it('is still there after the tab is closed and reopened', async () => {
    const name = nextName()

    const first = await openTab(name, NOW)
    expect(first.outcome).toBe('first-run')
    expect(first.session.durable).toBe(true)

    const runtime = createToolRuntime({ repo: first.session.repo, now: () => NOW })
    const created = runtime.run('application.create', {
      org: 'Rice',
      role: 'Assistant Professor',
      roleTag: 'Assistant Professor',
      stage: 'draft',
    })
    if (!created.ok) throw new Error(created.errors.map((e) => e.message).join('; '))

    const before = graphOf(first.session)

    // What `pagehide` does. The queue drains on a microtask, so the exposure is
    // one undrained batch — but "one batch" is the batch the user just watched
    // land on screen, which is why the flush is wired and why it is awaited here.
    await first.session.repo.flush()
    first.session.dispose()

    const second = await openTab(name, LATER)
    expect(second.outcome).toBe('ready')

    // Not "there is an application called Rice" — the whole graph, node for node
    // and edge for edge, including the organisation the composite minted and the
    // `AT` edge joining them. A durability test that checks one field passes
    // while the edges are quietly gone.
    expect(graphOf(second.session)).toEqual(before)
    expect(second.session.skipped).toEqual([])
    expect(second.session.problems).toEqual([])

    // Looked up by the id the tool minted, not by slug: the demo store already
    // answers to 'rice', so the new record was minted as 'rice-2' — which is
    // itself the slug-uniqueness rule surviving a reload, and would have made a
    // by-slug assertion pass against the wrong record.
    const graph = second.session.repo.getSnapshot()
    const app = graph.node(created.output, 'application')
    expect(app?.props.role).toBe('Assistant Professor')
    expect(graph.one(created.output, 'AT', 'organisation')?.props.name).toBe('Rice')

    second.session.dispose()
  })

  it('stops the store being demo data, and the reload agrees', async () => {
    const name = nextName()

    const first = await openTab(name, NOW)
    expect(first.session.meta.dataSet).toBe('demo')

    const runtime = createToolRuntime({ repo: first.session.repo, now: () => NOW })
    const created = runtime.run('keyword.create', { name: 'Referral' })
    if (!created.ok) throw new Error('the keyword should have been created')

    // Demo data stops being demo data the moment it is edited. Left at 'demo',
    // Settings would go on offering to replace the user's records with the
    // fixtures — and after a reload the meta row is the only thing that knows.
    expect(first.session.meta.dataSet).toBe('user')
    await first.session.repo.flush()
    first.session.dispose()

    const second = await openTab(name, LATER)
    expect(second.session.meta.dataSet).toBe('user')
    second.session.dispose()
  })

  it('survives an undo, because the undo is itself a write', async () => {
    const name = nextName()

    const first = await openTab(name, NOW, 'empty')
    const runtime = createToolRuntime({ repo: first.session.repo, now: () => NOW })
    const created = runtime.run('keyword.create', { name: 'Cold outreach' })
    if (!created.ok) throw new Error('the keyword should have been created')
    expect(first.session.repo.getSnapshot().ofType('keyword')).toHaveLength(1)

    const undone = runtime.undo()
    expect(undone.ok).toBe(true)
    expect(first.session.repo.getSnapshot().ofType('keyword')).toEqual([])

    await first.session.repo.flush()
    first.session.dispose()

    // The delete has to have reached disk too. An undo that only ran in memory
    // would put the record back on the next launch — which is the failure mode
    // that makes people stop trusting undo entirely.
    const second = await openTab(name, LATER)
    expect(second.session.repo.getSnapshot().ofType('keyword')).toEqual([])
    second.session.dispose()
  })
})

describe('an empty store', () => {
  it('stays empty across a reload rather than being reseeded', async () => {
    // Settings → Records → Empty, then a reload. Before Wave 2 this was
    // impossible to use: the reload put the demo data back and took the user's
    // changes with it. That sentence is the one this project exists to delete.
    const name = nextName()

    const first = await openTab(name, NOW, 'empty')
    expect(first.session.repo.getSnapshot().nodes()).toEqual([])
    first.session.dispose()

    const second = await openTab(name, LATER)
    expect(second.outcome).toBe('ready')
    expect(second.session.repo.getSnapshot().nodes()).toEqual([])
    expect(second.session.meta.dataSet).toBe('empty')
    second.session.dispose()
  })
})
