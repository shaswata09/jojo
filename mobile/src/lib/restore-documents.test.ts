/**
 * The half of a restore that is not portable.
 *
 * A node is a node on both platforms and `repo/restore.ts` puts it back the
 * same way in both apps. A document is not: the browser keys bytes by record id
 * inside OPFS, and this app keeps an absolute `file://` path. So a backup made
 * in a browser arrives here with every file node pointing at somewhere that
 * exists on nobody's phone.
 *
 * Left unrepaired that failure is quiet and looks like something else. The Vault
 * fills with rows that all report their document missing, which reads as a
 * transfer that dropped them — when in fact the bytes came across perfectly and
 * only the address was wrong. Nothing throws, nothing logs, and the person's
 * conclusion is that jojo lost their files.
 *
 * blob-util is stubbed for the same reason it is in `documents.test.ts`: the
 * assertions are on what this file HANDS the filesystem, not on the filesystem.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { blobPath } from '@jojo/service/core/blob-path'
import type { StoredNode } from '@jojo/service/core/model'
import {
  createDocumentStore,
  plannedPath,
  plannedUris,
  withDocumentUris,
} from './restore-documents'

const DIR = '/data/user/0/dev.jojo/files'

/** Every write blob-util was asked to make, in order. */
let writes: { path: string; data: string; encoding: string }[] = []
/** Paths unlinked and created, so the replace half can be checked. */
let unlinked: string[] = []
let made: string[] = []
/** Paths that exist. Set per test. */
let present = new Set<string>()
/** Set to make the next write throw, standing in for a full disk. */
let writeFails = false
/** Set to make the folder refuse to be created. */
let mkdirFails = false

vi.mock('react-native-blob-util', () => ({
  default: {
    fs: {
      dirs: { DocumentDir: '/data/user/0/dev.jojo/files' },
      exists: (path: string) => Promise.resolve(present.has(path)),
      unlink: (path: string) => {
        unlinked.push(path)
        return Promise.resolve()
      },
      mkdir: (path: string) => {
        if (mkdirFails) return Promise.reject(new Error('read-only file system'))
        made.push(path)
        return Promise.resolve()
      },
      writeFile: (path: string, data: string, encoding: string) => {
        if (writeFails) return Promise.reject(new Error('no space left on device'))
        writes.push({ path, data, encoding })
        return Promise.resolve(1)
      },
    },
  },
}))

beforeEach(() => {
  writes = []
  unlinked = []
  made = []
  present = new Set()
  writeFails = false
  mkdirFails = false
})

const fileNode = (id: string, uri?: string): StoredNode =>
  ({
    id,
    type: 'file',
    props: {
      slug: id,
      name: 'CV.pdf',
      kind: 'pdf',
      bucket: 'Applications',
      size: '1 KB',
      savedOn: '2026-08-22',
      applicationIds: [],
      ...(uri === undefined ? {} : { uri }),
    },
    createdAt: '2026-08-22T10:00:00.000Z',
    updatedAt: '2026-08-22T10:00:00.000Z',
  }) as StoredNode

/** The uri a node ends up with, without widening the whole discriminated union. */
const uriOf = (node: StoredNode | undefined) => (node as { props: { uri?: string } }).props.uri

describe('plannedPath', () => {
  it('derives a destination from the record id, without touching the disk', () => {
    const out = plannedPath(blobPath('file_01H8XY', 'CV.pdf'))
    expect(out).not.toBeNull()
    expect(out!.id).toBe('file_01H8XY')
    expect(out!.path).toBe(`${DIR}/restored/file_01H8XY__CV.pdf`)
    // The point of it being pure: `restoreBackup` writes the records BEFORE the
    // documents, so the uri has to be known before a byte is written.
    expect(writes).toHaveLength(0)
    expect(made).toHaveLength(0)
  })

  it('refuses a path that names no record', () => {
    // Bytes belonging to no record are bytes nothing in the app can open or
    // delete, so they are skipped rather than written.
    expect(plannedPath('Documents/CV.pdf')).toBeNull()
    expect(plannedPath('elsewhere/file_x__CV.pdf')).toBeNull()
    expect(plannedPath('')).toBeNull()
  })

  it('keeps the separator unambiguous when the name contains one', () => {
    const out = plannedPath(blobPath('file_x', 'my__notes.pdf'))
    expect(out!.id).toBe('file_x')
    // Folded by `encodeName`, so reading the phone's own path back gives the
    // same id rather than splitting at the wrong underscore.
    const segment = out!.path.split('/restored/')[1]!
    expect(plannedPath(`Documents/${segment}`)!.id).toBe('file_x')
  })
})

describe('plannedUris', () => {
  it('percent-encodes, because a file:// uri is a URI', () => {
    const uris = plannedUris([{ path: blobPath('file_x', 'My CV.pdf'), data: new Uint8Array(1) }])
    // `documents.ts`'s `pathOf` decodes on the way back out. Skip the encode and
    // every document with a space in its name reports itself lost on arrival —
    // `fs.exists` simply answers false for a file that is right there.
    expect(uris.get('file_x')).toBe(`file://${DIR}/restored/file_x__My%20CV.pdf`)
  })

  it('leaves out documents belonging to no record', () => {
    const uris = plannedUris([
      { path: blobPath('file_a', 'a.pdf'), data: new Uint8Array(1) },
      { path: 'Documents/orphan.pdf', data: new Uint8Array(1) },
    ])
    expect([...uris.keys()]).toEqual(['file_a'])
  })
})

describe('withDocumentUris', () => {
  it('points a file node at where its document will be', () => {
    const uris = plannedUris([{ path: blobPath('file_a', 'CV.pdf'), data: new Uint8Array(1) }])
    const [node] = withDocumentUris([fileNode('file_a', 'blob:https://jojo.app/old')], uris)
    expect(node!.type).toBe('file')
    expect(uriOf(node)).toBe(uris.get('file_a'))
  })

  it('leaves a node alone when this backup carries no document for it', () => {
    // The sender offers a backup WITHOUT documents. Blanking the field would
    // turn "not in this file" into "this record never had one".
    const [node] = withDocumentUris([fileNode('file_a', 'file:///old/CV.pdf')], new Map())
    expect(uriOf(node)).toBe('file:///old/CV.pdf')
  })

  it('does not touch nodes that are not files', () => {
    const app = {
      id: 'app_1',
      type: 'application',
      props: {},
      createdAt: 'x',
      updatedAt: 'x',
    } as unknown as StoredNode
    const uris = new Map([['app_1', 'file:///wrong']])
    expect(withDocumentUris([app], uris)[0]).toBe(app)
  })

  it('does not mutate what it was given', () => {
    // `restoreBackup` is handed the result; the plan it came from is still the
    // caller's, and a restore that failed halfway must not have edited it.
    const original = fileNode('file_a', 'file:///old/CV.pdf')
    const uris = plannedUris([{ path: blobPath('file_a', 'CV.pdf'), data: new Uint8Array(1) }])
    withDocumentUris([original], uris)
    expect(uriOf(original)).toBe('file:///old/CV.pdf')
  })
})

describe('createDocumentStore', () => {
  it('clears the folder first, so a restore replaces rather than merges', async () => {
    present.add(`${DIR}/restored`)
    const store = createDocumentStore()
    await store.replaceAll([{ path: blobPath('file_a', 'a.pdf'), data: new Uint8Array([1, 2]) }])
    // Leaving the previous store's documents behind would mean a restored jojo
    // holding files belonging to records that no longer exist.
    expect(unlinked).toEqual([`${DIR}/restored`])
    expect(made).toEqual([`${DIR}/restored`])
  })

  it('writes each document where its planned uri says it will be', async () => {
    const store = createDocumentStore()
    const landed = await store.replaceAll([
      { path: blobPath('file_a', 'a.pdf'), data: new Uint8Array([1, 2, 3]) },
    ])
    expect(landed).toBe(1)
    expect(writes[0]!.path).toBe(`${DIR}/restored/file_a__a.pdf`)
    expect(writes[0]!.encoding).toBe('base64')
    // The uri written into the node and the path written on disk are the same
    // place. This is the assertion the whole repair rests on.
    const uris = plannedUris([{ path: blobPath('file_a', 'a.pdf'), data: new Uint8Array(3) }])
    expect(uris.get('file_a')).toBe(`file://${writes[0]!.path}`)
  })

  it('encodes bytes rather than characters', async () => {
    const store = createDocumentStore()
    // A document is not text: a PDF starts with a byte no text encoder would
    // pass through unchanged, and 0xFF is not valid UTF-8 at all.
    const data = new Uint8Array([0, 255, 128, 10])
    await store.replaceAll([{ path: blobPath('file_a', 'a.bin'), data }])
    const expected = globalThis.btoa(String.fromCharCode(...data))
    expect(writes[0]!.data).toBe(expected)
    // Round-trips: the bytes on the phone are the bytes that were sent.
    const back = Uint8Array.from(globalThis.atob(writes[0]!.data), (c) => c.charCodeAt(0))
    expect([...back]).toEqual([...data])
  })

  it('skips a document belonging to no record', async () => {
    const store = createDocumentStore()
    const landed = await store.replaceAll([
      { path: 'Documents/orphan.pdf', data: new Uint8Array([1]) },
      { path: blobPath('file_a', 'a.pdf'), data: new Uint8Array([1]) },
    ])
    expect(landed).toBe(1)
    expect(writes).toHaveLength(1)
  })

  it('loses one document rather than the restore, when a write fails', async () => {
    writeFails = true
    const store = createDocumentStore()
    const landed = await store.replaceAll([
      { path: blobPath('file_a', 'a.pdf'), data: new Uint8Array([1]) },
      { path: blobPath('file_b', 'b.pdf'), data: new Uint8Array([1]) },
    ])
    // A backup missing one file is worth far more than a restore that refused
    // over it, and the Vault already says out loud that a document is missing.
    expect(landed).toBe(0)
  })

  it('reports none landed when the folder cannot be made, rather than throwing', async () => {
    mkdirFails = true
    const store = createDocumentStore()
    // Nowhere to put anything. The restore still lands the records, which is the
    // part that cannot be re-fetched, and re-running the transfer fixes the rest.
    await expect(
      store.replaceAll([{ path: blobPath('file_a', 'a.pdf'), data: new Uint8Array([1]) }]),
    ).resolves.toBe(0)
    expect(writes).toHaveLength(0)
  })
})
