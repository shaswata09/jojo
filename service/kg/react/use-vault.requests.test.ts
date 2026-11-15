/**
 * Q089: a reminder, a link, a document and a snippet can each be filed under
 * several applications, the filing is stored, and each application's page
 * shows every record filed under it.
 *
 * `filedUnder` is the selector both `useVault().forApplication` and
 * `useTimeline().forApplication` read through — the Filed panel and the
 * application's timeline on web, and the application screen on the phone. The
 * records are written through the same tools both apps call, read back through
 * the same projections, and carried across a reopen of the store, which is the
 * path a reload takes on either device.
 */

import { describe, expect, it } from 'vitest'
import { createMemoryDriver } from '../storage/memory-driver'
import { boot, bootInMemory, resetBoot } from '../repo/boot'
import type { BootResult, Session } from '../repo/boot'
import { createToolRuntime } from '../tools/runtime'
import { createProjections } from './projections'
import { dayOf } from '../core/project'
import type { Instant } from '../core/model'
import { filedUnder } from '../core/filed-under'

const NOW: Instant = new Date('2026-10-12T12:00:00').toISOString()
const now = () => NOW
/** Fresh per session: projections memoise on the snapshot's version, not its identity. */
let p = createProjections(dayOf(NOW))

const sessionOf = (result: BootResult): Session => {
  if (result.outcome === 'corrupt') throw new Error(`unexpected corrupt boot: ${result.detail}`)
  return result.session
}

/** Files one of each kind under BOTH applications, the second named first. */
function fileEverything(runtime: ReturnType<typeof createToolRuntime>, a: string, b: string) {
  const both = [b, a]
  runtime.runOrThrow('vault.link.save', {
    title: 'Q089 link',
    url: 'https://example.org/q089',
    category: 'Guide',
    applicationIds: both,
  })
  runtime.runOrThrow('vault.file.add', {
    files: [{ name: 'Q089-CV.pdf', kind: 'pdf', bucket: 'Applications', size: '1 KB', applicationIds: both }],
  })
  runtime.runOrThrow('vault.snippet.create', {
    title: 'Q089 snippet',
    tag: 'Cover letter',
    body: 'x',
    applicationIds: both,
  })
  runtime.runOrThrow('timeline.item.create', {
    title: 'Q089 reminder',
    date: '2026-10-20',
    kind: 'follow-up',
    remind: true,
    applicationIds: both,
  })
}

type Snapshot = ReturnType<Session['repo']['getSnapshot']>

/** What the application page lists for one job: the four kinds, by title. */
const pageFor = (graph: Snapshot, appId: string) => ({
  links: filedUnder(p.links(graph), appId).map((l) => l.title),
  files: filedUnder(p.files(graph), appId).map((f) => f.name),
  snippets: filedUnder(p.snippets(graph), appId).map((s) => s.title),
  reminders: filedUnder(p.timeline(graph), appId).map((i) => i.title),
})

const expectBoth = (graph: Snapshot, a: string, b: string) => {
  for (const appId of [a, b]) {
    const page = pageFor(graph, appId)
    expect(page.links).toContain('Q089 link')
    expect(page.files).toContain('Q089-CV.pdf')
    expect(page.snippets).toContain('Q089 snippet')
    expect(page.reminders).toContain('Q089 reminder')
  }
}

describe('one record, several applications (Q089)', () => {
  it('shows a reminder, a link, a document and a snippet on every application they are filed under', () => {
    p = createProjections(dayOf(NOW))
    const { repo } = bootInMemory({ now })
    const runtime = createToolRuntime({ repo, now })
    const [first, second] = p.applications(repo.getSnapshot())
    if (!first || !second) throw new Error('the seed has fewer than two applications')

    fileEverything(runtime, first.id, second.id)
    expectBoth(repo.getSnapshot(), first.id, second.id)

    // And every tag is kept on the record itself, in both directions.
    const graph = repo.getSnapshot()
    for (const ids of [
      p.links(graph).find((l) => l.title === 'Q089 link')?.applicationIds,
      p.files(graph).find((f) => f.name === 'Q089-CV.pdf')?.applicationIds,
      p.snippets(graph).find((s) => s.title === 'Q089 snippet')?.applicationIds,
      p.timeline(graph).find((i) => i.title === 'Q089 reminder')?.applicationIds,
    ]) {
      expect([...(ids ?? [])].sort()).toEqual([first.id, second.id].sort())
    }
  })

  it('keeps every tag across a reopen of the store', async () => {
    p = createProjections(dayOf(NOW))
    const driver = createMemoryDriver()
    resetBoot()
    const one = sessionOf(await boot({ now, driver }))
    const runtime = createToolRuntime({ repo: one.repo, now })
    const [first, second] = p.applications(one.repo.getSnapshot())
    if (!first || !second) throw new Error('the seed has fewer than two applications')
    fileEverything(runtime, first.id, second.id)
    await one.repo.flush()
    const read = await driver.readAll()
    if (!read.ok) throw new Error('the memory driver failed to read')
    one.dispose()

    p = createProjections(dayOf(NOW))
    resetBoot()
    const two = sessionOf(await boot({ now, driver: createMemoryDriver({ rows: read.value }) }))
    expectBoth(two.repo.getSnapshot(), first.id, second.id)
    two.dispose()
  })
})

