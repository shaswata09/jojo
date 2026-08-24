/**
 * `restoreBackup`, against stubs.
 *
 * D20 rules out mounting the panel, and driving a real restore in a browser
 * proved worse than useless: deleting a live IndexedDB database blocks on the
 * app's own open connection, so the test hung rather than failed. What is worth
 * pinning is the decision-making — what gets validated, what gets salvaged, what
 * order the two stores are written in, and what happens when the first fails —
 * and none of that needs a database.
 */

import { describe, expect, it, vi } from 'vitest'
import type { RestorePlan } from '../core/backup'
import type { Repository } from './repository'
import type { StoreMeta } from './meta'
import type { DocumentStore } from './restore'
import { metaForRestore, restoreBackup } from './restore'

const META: StoreMeta = {
  schemaVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastOpenedAt: '2026-01-01T00:00:00.000Z',
  dataSet: 'demo',
  seededAt: '2026-01-01T00:00:00.000Z',
  handoverAt: null,
}

/**
 * A node that really passes `validateRows`.
 *
 * The first version of this fixture invented plausible props and every case
 * failed identically — salvage dropped all of them and the restore refused, so
 * three tests were asserting the same thing by accident. Asking the validator
 * rather than guessing again gave the real reason: "Its id is not a jojo id."
 * Ids are type-prefixed UUIDv7 — and the prefix for `application` is `app`, not
 * `application`; `TYPE_PREFIX` in `core/ref.ts` is the only place that says so.
 * The props are `ApplicationProps` as `core/model.ts` declares them, and both
 * enums are real values — `roleTag` is one of five job titles and `stage` is
 * lowercase. Every wrong guess here produced the same "no records could be read"
 * refusal, which is why the validator was asked instead of guessed at a fourth
 * time.
 */
const node = (id: string) => ({
  id: `app:${id}`,
  type: 'application' as const,
  props: {
    slug: id,
    role: 'Research Engineer',
    note: '',
    roleTag: 'Researcher',
    stage: 'submitted',
    lastAction: 'Submitted',
    lastActionAt: '2026-01-01T00:00:00.000Z',
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

function stubRepo(result: { ok: boolean; message?: string } = { ok: true }) {
  const replaceAll = vi.fn(async () =>
    result.ok ? { ok: true as const, value: undefined } : { ok: false as const, error: { message: result.message ?? 'boom' } },
  )
  return { meta: META, replaceAll } as unknown as Repository & { replaceAll: typeof replaceAll }
}

function stubBlobs() {
  const replaceAll = vi.fn(async (docs: readonly { path: string; data: Uint8Array }[]) => docs.length)
  // No cast: `DocumentStore` is one method, and the stub has it. This used to
  // widen a stub into the whole browser `VaultBlobs` surface, which is exactly
  // the coupling the structural port removed.
  return { replaceAll } satisfies DocumentStore & { replaceAll: typeof replaceAll }
}

const plan = (over: Partial<RestorePlan> = {}): RestorePlan => ({
  exportedAt: '2026-08-22T10:00:00.000Z',
  nodes: [node('01a02b14-31db-7278-a6d7-c03d325832ba'), node('01a02b14-4e77-7c01-9f3a-118d4c9a77e1')] as never,
  edges: [],
  documents: [{ path: 'Documents/app:01a02b14-31db-7278-a6d7-c03d325832ba__CV.pdf', data: new Uint8Array([1, 2, 3]) }],
  ...over,
})

describe('restoreBackup', () => {
  it('writes the graph and then the documents, and reports both', async () => {
    const repo = stubRepo()
    const blobs = stubBlobs()
    const out = await restoreBackup(repo, blobs, plan(), '2026-08-22T12:00:00.000Z')

    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.nodes).toBe(2)
    expect(out.documents).toBe(1)
    expect(out.skipped).toBe(0)
    expect(repo.replaceAll).toHaveBeenCalledOnce()
    expect(blobs.replaceAll).toHaveBeenCalledOnce()
  })

  it('does not touch the documents when the graph swap fails', async () => {
    // The ordering that makes a partial restore survivable. If documents went
    // first, a failed graph swap would leave files belonging to records that do
    // not exist — invisible in the app and impossible to clean up.
    const repo = stubRepo({ ok: false, message: 'quota' })
    const blobs = stubBlobs()
    const out = await restoreBackup(repo, blobs, plan(), '2026-08-22T12:00:00.000Z')

    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.message).toContain('quota')
    expect(out.message).toContain('Nothing has been changed')
    expect(blobs.replaceAll).not.toHaveBeenCalled()
  })

  it('salvages a damaged row rather than refusing the whole backup', async () => {
    const repo = stubRepo()
    const out = await restoreBackup(
      repo,
      stubBlobs(),
      plan({ nodes: [node('01a02b14-31db-7278-a6d7-c03d325832ba'), { id: 'broken' }] as never }),
      '2026-08-22T12:00:00.000Z',
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    // One good record in, one unreadable one reported rather than silently lost.
    expect(out.nodes).toBe(1)
    expect(out.skipped).toBeGreaterThan(0)
  })

  it('refuses when NOTHING in the file could be read', async () => {
    // Salvage has a floor. A file where every row is unreadable is not a backup
    // with a bad record in it — it is not a backup, and replacing a working
    // store with nothing is the worst outcome available.
    const repo = stubRepo()
    const blobs = stubBlobs()
    const out = await restoreBackup(
      repo,
      blobs,
      plan({ nodes: [{ id: 'broken' }, { nope: true }] as never }),
      '2026-08-22T12:00:00.000Z',
    )
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.message).toContain('Not one record')
    expect(repo.replaceAll).not.toHaveBeenCalled()
    expect(blobs.replaceAll).not.toHaveBeenCalled()
  })

  it('reports the documents a record can actually reach, not the ones written', async () => {
    // A backup can carry a path this build cannot parse — hand-edited, or from a
    // future scheme. Counting it as restored tells the user their documents are
    // back when some are stored where nothing will ever look for them.
    const repo = stubRepo()
    const blobs = {
      replaceAll: vi.fn(async (docs: readonly { path: string; data: Uint8Array }[]) =>
        docs.filter((d) => d.path.startsWith('Documents/')).length,
      ),
    } satisfies DocumentStore

    const out = await restoreBackup(
      repo,
      blobs,
      plan({
        documents: [
          { path: 'Documents/app:01a02b14-31db-7278-a6d7-c03d325832ba__CV.pdf', data: new Uint8Array([1]) },
          { path: 'somewhere/else.pdf', data: new Uint8Array([2]) },
        ],
      }),
      '2026-08-22T12:00:00.000Z',
    )
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.documents).toBe(1)
  })

  it('marks restored data as the user’s, keeping the store’s own identity', async () => {
    const meta = metaForRestore(META, '2026-08-22T12:00:00.000Z')
    // Restored records are the user's, whatever they were in the store that
    // produced the file — otherwise jojo offers to replace them as demo data.
    expect(meta.dataSet).toBe('user')
    expect(meta.seededAt).toBeNull()
    // This database was created when it was created; the backup does not get to
    // rewrite that, and the schema is this build's.
    expect(meta.createdAt).toBe(META.createdAt)
    expect(meta.schemaVersion).toBe(META.schemaVersion)
  })
})
