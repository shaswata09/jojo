/**
 * The one question the Settings export has to answer: can this app read back
 * what it just wrote?
 *
 * For two releases it could not — the button copied `exportJSON()` and
 * `readBackup` refused it as `backup/not-a-backup`. The assertion below is the
 * whole regression: swap `buildPhoneBackup`'s body for the projections string
 * and it fails.
 */

import { describe, expect, it } from 'vitest'
import { readBackup } from '@jojo/service/core/backup'
import type { StoredEdge, StoredNode } from '@jojo/service/core/model'
import { buildPhoneBackup } from '@/lib/phone-backup'

const NODES = [
  { id: 'app:0192', type: 'application', props: { org: 'Rice' } },
  { id: 'org:0193', type: 'organisation', props: { name: 'Rice' } },
] as unknown as StoredNode[]
const EDGES = [{ id: 'e:1', from: 'app:0192', to: 'org:0193', rel: 'AT' }] as unknown as StoredEdge[]

/** What the button copied before the fix, shape and all. */
const projectionsOnly = JSON.stringify(
  { jojo: 3, exportedAt: '2026-10-12T15:00:00.000Z', applications: [{ id: 'app:0192' }] },
  null,
  2,
)

describe('what Settings puts on the clipboard', () => {
  it('is a file this app accepts, with the rows a restore needs', () => {
    const read = readBackup(
      buildPhoneBackup({
        exportedAt: '2026-10-12T15:00:00.000Z',
        nodes: NODES,
        edges: EDGES,
        readable: JSON.parse(projectionsOnly) as unknown,
      }),
    )

    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.value.nodes).toHaveLength(2)
    expect(read.value.edges).toHaveLength(1)
    expect(read.value.exportedAt).toBe('2026-10-12T15:00:00.000Z')
  })

  /**
   * The failure this test was written from, kept beside the fix so the two
   * cannot drift apart: the OLD payload is still refused, and refused with the
   * code that names it as one of jojo's own older exports rather than a foreign
   * file. If that ever starts passing, `readBackup` has been loosened and the
   * test above stopped meaning anything.
   */
  it('is not the projections-only export, which readBackup still refuses', () => {
    const refused = readBackup(projectionsOnly)
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.error.code).toBe('backup/not-a-backup')
  })

  it('carries the readable half so the file opens into something recognisable', () => {
    const parsed = JSON.parse(
      buildPhoneBackup({
        exportedAt: '2026-10-12T15:00:00.000Z',
        nodes: NODES,
        edges: EDGES,
        readable: { jojo: 3 },
      }),
    ) as { readable?: unknown; documents?: unknown }

    expect(parsed.readable).toEqual({ jojo: 3 })
    // Empty ALWAYS on this route: base64 bytes would blow the clipboard's
    // Binder ceiling on the first PDF. Transfer is what carries them.
    expect(parsed.documents).toEqual([])
  })
})
