/**
 * Promoting twice.
 *
 * `tools.test.ts` covers the round trip every tool owes, and it promotes each of
 * a posting and a match exactly once. This file is about the SECOND press.
 *
 * `BECAME` is `fromCardinality: 'one'`, so `tx.link` drops the node's existing
 * outgoing edge in the same commit. A second `scout.posting.promote` therefore
 * minted a whole second draft and moved the provenance edge onto it, leaving the
 * first application in the board with nothing pointing at where it came from and
 * no announcement anywhere saying a duplicate had appeared. Both UIs hide the
 * button on a row that already went (`p.linked ? null : …` in PostingsPanel,
 * `application ? <Chip>added</Chip> : …` in MatchesPanel), so the only caller
 * that could reach it was an agent — which is exactly the caller with no eyes on
 * the row.
 *
 * The clock is injected and fixed (D26), and the driver remembers nothing:
 * durability is not what this file is about, but the real repository is, because
 * `available` is consulted by the runtime and a hand-written fake would be
 * testing the fake.
 */

import { describe, expect, it } from 'vitest'
import { MutableSnapshot } from '../core/snapshot'
import { createRepository } from '../repo/repository'
import { createToolRuntime } from './runtime'
import type { NodeId } from '../core/model'

const NOW = '2026-08-25T09:00:00.000Z'

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
  // A second per read, so ids stay ordered the way `ofType` assumes.
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

describe('promoting a saved posting a second time', () => {
  it('refuses instead of minting a second draft and moving the edge onto it', () => {
    const { runtime, repo, okOr } = world()
    const posting = okOr(
      runtime.run('scout.posting.save', { url: 'https://jobs.rice.edu/postings/ml-engineer' }),
    ) as NodeId
    const first = okOr(runtime.run('scout.posting.promote', { id: posting }))

    const again = runtime.run('scout.posting.promote', { id: posting })
    expect(again.ok).toBe(false)
    if (again.ok) throw new Error('the second promote was allowed')
    expect(again.errors[0]?.code).toBe('tool/refused')

    const m = repo.getSnapshot()
    // The refusal is what keeps these two true: one application, and the
    // provenance edge still on the one the user actually pressed for.
    expect(m.ofType('application')).toHaveLength(1)
    expect(m.one(posting, 'BECAME', 'application')?.id).toBe(first)
  })

  /*
   * The guard reads the EDGE, not a flag — which is the whole reason `linked`
   * stopped being stored. Unlinking through `scout.posting.update` offers the
   * promotion back, so a posting linked to the wrong application is recoverable
   * without deleting and re-saving it.
   */
  it('offers the promotion again once the posting is unlinked', () => {
    const { runtime, repo, okOr } = world()
    const posting = okOr(
      runtime.run('scout.posting.save', { url: 'https://jobs.rice.edu/postings/ml-engineer' }),
    ) as NodeId
    okOr(runtime.run('scout.posting.promote', { id: posting }))

    expect(runtime.can('scout.posting.promote', { id: posting }).ok).toBe(false)
    okOr(runtime.run('scout.posting.update', { id: posting, applicationId: null }))
    expect(runtime.can('scout.posting.promote', { id: posting }).ok).toBe(true)

    const second = okOr(runtime.run('scout.posting.promote', { id: posting }))
    expect(repo.getSnapshot().one(posting, 'BECAME', 'application')?.id).toBe(second)
  })

  // `available` is asked with no input at all by the palette and by `forNode`.
  // A guard that read `input.id` unconditionally would take the tool out of both.
  it('stays listed when nothing has been filled in yet', () => {
    const { runtime } = world()
    expect(runtime.can('scout.posting.promote').ok).toBe(true)
  })
})

describe('promoting a match a second time', () => {
  it('refuses instead of minting a second draft and moving the edge onto it', () => {
    const { runtime, repo, okOr } = world()
    const match = okOr(
      runtime.run('scout.match.save', {
        role: 'UNT — Assistant professor, machine learning',
        detail: 'Denton, TX',
        fit: 82,
      }),
    ) as NodeId
    const first = okOr(runtime.run('scout.match.promote', { id: match }))

    const again = runtime.run('scout.match.promote', { id: match })
    expect(again.ok).toBe(false)
    if (again.ok) throw new Error('the second promote was allowed')
    expect(again.errors[0]?.code).toBe('tool/refused')

    const m = repo.getSnapshot()
    expect(m.ofType('application')).toHaveLength(1)
    expect(m.one(match, 'BECAME', 'application')?.id).toBe(first)
  })

  it('offers the promotion again once the match is unlinked', () => {
    const { runtime, okOr } = world()
    const match = okOr(
      runtime.run('scout.match.save', {
        role: 'UNT — Assistant professor, machine learning',
        detail: 'Denton, TX',
        fit: 82,
      }),
    ) as NodeId
    okOr(runtime.run('scout.match.promote', { id: match }))

    expect(runtime.can('scout.match.promote', { id: match }).ok).toBe(false)
    okOr(runtime.run('scout.match.update', { id: match, applicationId: null }))
    expect(runtime.can('scout.match.promote', { id: match }).ok).toBe(true)
  })
})

/*
 * The summary is what lets a person judge a queued posting without opening it,
 * and it outlives the queue: approving the suggestion must carry it onto the
 * saved posting, where the Postings panel shows it.
 */
describe('a posting saved with a summary', () => {
  it('keeps the summary, tidied, on the saved posting', () => {
    const { runtime, repo, okOr } = world()
    const posting = okOr(
      runtime.run('scout.posting.save', {
        url: 'https://jobs.rice.edu/postings/ml-engineer',
        summary: '  Tenure-track ML post at Rice,\n Houston. ',
      }),
    ) as NodeId
    expect(repo.getSnapshot().node(posting, 'posting')?.props.summary).toBe(
      'Tenure-track ML post at Rice, Houston.',
    )
  })

  it('stores no summary field at all when none was given or it was blank', () => {
    const { runtime, repo, okOr } = world()
    const bare = okOr(
      runtime.run('scout.posting.save', { url: 'https://jobs.rice.edu/postings/a' }),
    ) as NodeId
    const blank = okOr(
      runtime.run('scout.posting.save', { url: 'https://jobs.rice.edu/postings/b', summary: '   ' }),
    ) as NodeId
    const m = repo.getSnapshot()
    expect(m.node(bare, 'posting')?.props).not.toHaveProperty('summary')
    expect(m.node(blank, 'posting')?.props).not.toHaveProperty('summary')
  })

  it('refuses a summary that is the whole advert rather than two sentences', () => {
    const { runtime } = world()
    const out = runtime.run('scout.posting.save', {
      url: 'https://jobs.rice.edu/postings/ml-engineer',
      summary: 'x'.repeat(301),
    })
    expect(out.ok).toBe(false)
  })
})

/*
 * The page kept for a posting goes with it.
 *
 * The web app saves a scout posting's page to the Vault with the posting's URL
 * as its source, the way "From link" does. Before this, promoting left the page
 * — when there was one — unfiled, so the application had no posting under it
 * and the Vault had a page about a job nothing pointed at.
 */
describe('promoting a posting whose page was kept', () => {
  const keepPage = (
    runtime: ReturnType<typeof world>['runtime'],
    okOr: ReturnType<typeof world>['okOr'],
    sourceUrl: string,
  ) => {
    const ids = okOr(
      runtime.run('vault.file.add', {
        files: [{ name: 'Rice — ML engineer.html', kind: 'page', bucket: 'Job postings', size: '84 KB', sourceUrl }],
      }),
    )
    const id = ids[0]
    if (id === undefined) throw new Error('vault.file.add returned no id.')
    return id
  }

  it('files the page under the new application', () => {
    const { runtime, repo, okOr } = world()
    const page = keepPage(runtime, okOr, 'https://jobs.rice.edu/postings/ml-engineer')
    const posting = okOr(
      runtime.run('scout.posting.save', { url: 'https://jobs.rice.edu/postings/ml-engineer' }),
    ) as NodeId
    const application = okOr(runtime.run('scout.posting.promote', { id: posting }))

    const filed = repo.getSnapshot().many(page, 'FILED_UNDER', 'out', 'application').map((a) => a.id)
    expect(filed).toEqual([application])
  })

  it('finds it through the same address written differently', () => {
    // A trailing slash and a `www.` are the same posting — the comparison is
    // `postingIdentity`, the one the duplicate check uses.
    const { runtime, repo, okOr } = world()
    const page = keepPage(runtime, okOr, 'https://www.jobs.rice.edu/postings/ml-engineer/')
    const posting = okOr(
      runtime.run('scout.posting.save', { url: 'https://jobs.rice.edu/postings/ml-engineer' }),
    ) as NodeId
    const application = okOr(runtime.run('scout.posting.promote', { id: posting }))
    expect(repo.getSnapshot().many(page, 'FILED_UNDER', 'out', 'application').map((a) => a.id)).toEqual([application])
  })

  it('leaves another posting’s page alone, and promotes fine with no page at all', () => {
    const { runtime, repo, okOr } = world()
    const other = keepPage(runtime, okOr, 'https://jobs.rice.edu/postings/data-scientist')
    const posting = okOr(
      runtime.run('scout.posting.save', { url: 'https://jobs.rice.edu/postings/ml-engineer' }),
    ) as NodeId
    const application = okOr(runtime.run('scout.posting.promote', { id: posting }))
    const m = repo.getSnapshot()
    expect(m.node(application as NodeId, 'application')).toBeDefined()
    expect(m.many(other, 'FILED_UNDER', 'out', 'application')).toEqual([])
  })
})
