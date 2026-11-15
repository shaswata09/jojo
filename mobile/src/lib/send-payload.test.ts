/**
 * Q129: what the phone hands a computer is a backup the computer can restore —
 * documents and all, as ASCII the phone can write without a TextEncoder.
 */

import { describe, expect, it } from 'vitest'
import { readBackup } from '@jojo/service/core/backup'
import { blobPath } from '@jojo/service/core/blob-path'
import { decodeUtf8 } from '@jojo/service/core/utf8'
import { buildSendPayload } from '@/lib/send-payload'

const app = {
  id: 'app:01a02b14-31db-7278-a6d7-c03d325832ba',
  type: 'application',
  props: {
    slug: '01a02b14-31db-7278-a6d7-c03d325832ba',
    role: 'Ingénieure de recherche',
    note: '東京 😀',
    roleTag: 'Researcher',
    stage: 'submitted',
    lastAction: 'Submitted',
    lastActionAt: '2026-01-01T00:00:00.000Z',
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const file = (id: string, uri?: string) => ({
  id,
  type: 'file',
  props: {
    slug: id,
    name: 'My CV.pdf',
    kind: 'pdf',
    bucket: 'cv',
    size: '3 B',
    savedOn: '2026-01-01',
    ...(uri === undefined ? {} : { uri }),
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

describe('the backup a phone sends (Q129)', () => {
  it('is ASCII bytes that read back as the same records', async () => {
    const out = await buildSendPayload({
      exportedAt: '2026-11-15T10:00:00.000Z',
      nodes: [app] as never,
      edges: [],
      readDocument: async () => null,
    })
    expect(out.bytes.every((b) => b < 0x80)).toBe(true)
    const read = readBackup(decodeUtf8(out.bytes))
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.value.nodes[0]!.props).toEqual(app.props)
  })

  it('carries each document under the path the computer files it by', async () => {
    const id = 'file:01a02b14-4e77-7c01-9f3a-118d4c9a77e1'
    const out = await buildSendPayload({
      exportedAt: '2026-11-15T10:00:00.000Z',
      nodes: [app, file(id, 'file:///data/My%20CV.pdf')] as never,
      edges: [],
      readDocument: async (uri) =>
        uri === 'file:///data/My%20CV.pdf' ? new Uint8Array([1, 2, 3]) : null,
    })
    expect(out.documents).toBe(1)
    const read = readBackup(decodeUtf8(out.bytes))
    if (!read.ok) throw new Error(read.error.message)
    expect(read.value.documents).toEqual([
      { path: blobPath(id, 'My CV.pdf'), data: new Uint8Array([1, 2, 3]) },
    ])
  })

  it('counts a document that would not read, rather than failing or hiding it', async () => {
    const out = await buildSendPayload({
      exportedAt: '2026-11-15T10:00:00.000Z',
      nodes: [
        app,
        file('file:01a02b14-0000-7000-8000-000000000001', 'file:///gone.pdf'),
        file('file:01a02b14-0000-7000-8000-000000000002', 'file:///throws.pdf'),
        // A record with no copy on this phone is not a failure.
        file('file:01a02b14-0000-7000-8000-000000000003'),
      ] as never,
      edges: [],
      readDocument: async (uri) => {
        if (uri === 'file:///throws.pdf') throw new Error('EACCES')
        return null
      },
    })
    expect(out).toMatchObject({ documents: 0, unreadable: 2 })
  })
})
