/**
 * Q291 — "When I approve an application found in job scout it's not coming up
 * in my applications table." Approval runs the suggestion's own save and then
 * promotes what it saved (`useProposalActions` on the web side, pinned there by
 * a source guard). This holds the tool half: a saved posting, promoted, is a
 * draft application in the very list the Applications table reads
 * (`projections.applications`), not only a node somewhere in the graph.
 *
 * Q292 — the posting's kept page is stored with that draft. Covered by
 * `scout.test.ts` ("files the page under the new application"); the read that
 * fills the draft is `fill-from-posting.test.ts`. Kept beside the projection
 * because that is the list being asserted on, and a tools test may not import it.
 */

import { describe, expect, it } from 'vitest'
import { MutableSnapshot } from '../core/snapshot'
import { createRepository } from '../repo/repository'
import { createProjections } from './projections'
import { createToolRuntime } from '../tools/runtime'
import type { NodeId } from '../core/model'

const NOW = '2026-10-16T09:00:00.000Z'

const nullDriver = () => ({
  open: async () => ({ ok: true as const, value: { version: 1, from: 0, migrated: [], crossTab: false } }),
  readAll: async () => ({ ok: true as const, value: { nodes: [], edges: [], meta: [], ops: [] } }),
  commit: async () => ({ ok: true as const, value: undefined }),
  replace: async () => ({ ok: true as const, value: undefined }),
  seedIfPristine: async () => ({ ok: true as const, value: true }),
  destroy: async () => ({ ok: true as const, value: undefined }),
  onRemoteCommit: () => () => {},
  onBlocking: () => () => {},
  close: () => {},
})

function world() {
  let tick = 0
  const now = () => new Date(Date.parse(NOW) + tick++ * 1000).toISOString()
  const repo = createRepository({
    driver: nullDriver() as Parameters<typeof createRepository>[0]['driver'],
    snapshot: new MutableSnapshot(),
    meta: { schemaVersion: 1, createdAt: NOW, lastOpenedAt: NOW, dataSet: 'user', seededAt: null, handoverAt: null },
    now,
  })
  const runtime = createToolRuntime({ repo, now })
  const okOr = <T>(out: { ok: true; output: T } | { ok: false; errors: readonly { message: string }[] }): T => {
    if (!out.ok) throw new Error(out.errors.map((e) => e.message).join('; '))
    return out.output
  }
  return { runtime, repo, okOr }
}

describe('Q291 an approved scout posting reaches the applications table', () => {
  it('is listed by the projection the table reads, as a draft', () => {
    const { runtime, repo, okOr } = world()
    const projections = createProjections('2026-10-16')
    const before = projections.applications(repo.getSnapshot()).length

    // What approving a scout card runs: the suggestion's save, then the promote.
    const posting = okOr(
      runtime.run('scout.posting.save', {
        url: 'https://www.higheredjobs.com/faculty/details.cfm?JobCode=178912345',
        title: 'Assistant Professor of Computer Science',
        org: 'Kansas State University',
        location: 'Manhattan, KS',
      }),
    ) as NodeId
    const application = okOr(runtime.run('scout.posting.promote', { id: posting })) as NodeId

    const rows = projections.applications(repo.getSnapshot())
    expect(rows).toHaveLength(before + 1)
    const row = rows.find((a) => a.id === application)
    expect(row).toBeDefined()
    expect(row?.stage).toBe('draft')
    expect(row?.org).toBe('Kansas State University')
  })
})
