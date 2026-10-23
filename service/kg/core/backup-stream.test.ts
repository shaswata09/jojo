/**
 * The backup written and read in pieces must be the backup `backup.ts` reads
 * and writes whole — the same file, the same verdicts, byte for byte.
 *
 * The streaming reader is a JSON parser of its own, and a second parser is a
 * second chance to read a file differently. So every case here is checked
 * against `readBackup` on the same text, split at many chunk sizes — including
 * one character at a time, which puts a chunk boundary inside every token,
 * every escape and every base64 quad the file has.
 */
import { describe, expect, it } from 'vitest'
import { BACKUP_FORMAT, buildBackup, readBackup, toBase64 } from './backup'
import type { BackupRead } from './backup'
import { BACKUP_TAIL, backupHead, base64Bytes, createBackupReader, documentParts } from './backup-stream'
import type { StoredNode } from './model'

// By hand, as `backup.test.ts` does: `core` is typed without the DOM, so
// TextEncoder and TextDecoder are not names here. Both are ASCII-only uses.
const enc = (text: string): Uint8Array => Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff)
const ascii = (bytes: Uint8Array): string => {
  let out = ''
  for (let at = 0; at < bytes.length; at += 8192) out += String.fromCharCode(...bytes.subarray(at, at + 8192))
  return out
}

const node = (id: string) =>
  ({
    id,
    type: 'application',
    props: { slug: id, role: 'Lecturer — “quoted”, \\ slashed, ✓', stage: 'draft' },
    createdAt: '2026-08-22T09:00:00.000Z',
    updatedAt: '2026-08-22T09:00:00.000Z',
  }) as unknown as StoredNode

/** Bytes that are not text, so a codec that only works on ASCII is caught. */
const noise = (n: number, seed = 7) => {
  const out = new Uint8Array(n)
  let x = seed
  for (let i = 0; i < n; i += 1) {
    // `Math.imul`: a plain multiply overflows a double's precision and the
    // bytes come out nearly all zero — base64 with no `/` in it at all.
    x = (Math.imul(x, 1664525) + 1013904223) | 0
    out[i] = x >>> 24
  }
  return out
}

const DOCS = [
  { path: 'Documents/file:a__CV.pdf', data: noise(10_000) },
  { path: 'Documents/file:b__Résumé — final.pdf', data: noise(1, 3) },
  { path: 'Documents/file:c__empty.txt', data: new Uint8Array(0) },
  { path: 'Documents/file:d__two.bin', data: noise(2, 5) },
]

const INPUT = {
  exportedAt: '2026-10-22T10:00:00.000Z',
  nodes: [node('app_1'), node('app_2')],
  edges: [],
  readable: { applications: [{ role: 'x' }], note: 'line\nbreak\t"q"' },
}

/** The streaming writer's file, joined — small enough here to be one string. */
function streamed(slice?: number): string {
  const parts: string[] = [backupHead(INPUT)]
  DOCS.forEach((d, i) => {
    for (const p of documentParts(d, i === 0, slice)) parts.push(typeof p === 'string' ? p : ascii(p))
  })
  parts.push(BACKUP_TAIL)
  return parts.join('')
}

const whole = () => JSON.stringify(buildBackup({ ...INPUT, documents: DOCS }))

function readInChunks(text: string, size: number): BackupRead {
  const reader = createBackupReader()
  for (let at = 0; at < text.length; at += size) reader.push(text.slice(at, at + size))
  return reader.end()
}

const SIZES = [1, 3, 7, 1000, Number.MAX_SAFE_INTEGER]

describe('base64 as bytes', () => {
  it('is exactly toBase64, for every tail length', () => {
    for (let n = 0; n <= 12; n += 1) {
      const b = noise(n, n + 1)
      expect(ascii(base64Bytes(b)), String(n)).toBe(toBase64(b))
    }
    expect(ascii(base64Bytes(noise(99_999)))).toBe(toBase64(noise(99_999)))
  })
})

describe('the streamed file', () => {
  it('is a backup the whole-file reader accepts, holding the same records and bytes', () => {
    for (const slice of [3, 30, 3001, undefined]) {
      const read = readBackup(streamed(slice))
      expect(read.ok, String(slice)).toBe(true)
      if (!read.ok) continue
      expect(read.value.nodes).toEqual(INPUT.nodes)
      expect(read.value.documents).toEqual(DOCS)
    }
  })

  it('keeps the readable half and the format marker', () => {
    const file = JSON.parse(streamed()) as Record<string, unknown>
    expect(file['format']).toBe(BACKUP_FORMAT)
    expect(file['readable']).toEqual(INPUT.readable)
  })

  it('opens with no documents at all', () => {
    const text = backupHead(INPUT) + BACKUP_TAIL
    expect(readBackup(text)).toMatchObject({ ok: true, value: { documents: [] } })
  })
})

describe('reading in chunks', () => {
  it('gives readBackup\'s answer for the streamed file, wherever the chunks fall', () => {
    const text = streamed(30)
    const expected = readBackup(text)
    for (const size of SIZES) expect(readInChunks(text, size), String(size)).toEqual(expected)
  })

  it('reads a file from the whole-file writer too, where data comes before bytes', () => {
    const text = whole()
    const expected = readBackup(text)
    expect(expected.ok).toBe(true)
    for (const size of SIZES) expect(readInChunks(text, size), String(size)).toEqual(expected)
  })

  it('reads a pretty-printed file and an escaped slash in the base64', () => {
    // Both are things another tool may do to a file a person kept: indent it,
    // or write `/` as `\/`, which JSON allows. A `/` is common in base64.
    const pretty = JSON.stringify(JSON.parse(whole()), null, 2).replace(/(?<="data": "[^"]*?)\//g, '\\/')
    expect(pretty).toContain('\\/')
    const expected = readBackup(pretty)
    expect(expected.ok).toBe(true)
    for (const size of SIZES) expect(readInChunks(pretty, size), String(size)).toEqual(expected)
  })

  it('treats a __proto__ key as data, the way JSON.parse does', () => {
    const text = whole().replace('"readable":{', '"readable":{"__proto__":{"polluted":true},')
    const read = readInChunks(text, 5)
    expect(read.ok).toBe(true)
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
  })

  it('refuses everything readBackup refuses, with the same code', () => {
    const good = JSON.parse(whole()) as { documents: { data: string; bytes: number }[] }
    const truncatedDoc = structuredClone(good)
    truncatedDoc.documents[0]!.data = toBase64(enc('%PDF'))
    const cases = [
      'not json at all',
      '{}',
      whole().slice(0, -40), // a download cut off part-way
      JSON.stringify({ format: BACKUP_FORMAT, version: 1 }),
      JSON.stringify({ format: BACKUP_FORMAT, version: 99, graph: { nodes: [], edges: [] }, documents: [] }),
      JSON.stringify({ format: BACKUP_FORMAT, version: 1, graph: { nodes: [], edges: [] } }),
      JSON.stringify({ jojo: 3, exportedAt: 'x', applications: [] }),
      JSON.stringify(truncatedDoc),
      ...['!!!!', 'A===', 'AB=C', 'ABC', 'SGVsᄒᄒᄒᄒ', 'AB==AB=='].map((data) =>
        JSON.stringify({ format: BACKUP_FORMAT, version: 1, graph: { nodes: [], edges: [] }, documents: [{ path: 'a', data }] }),
      ),
      JSON.stringify({ format: BACKUP_FORMAT, version: 1, graph: { nodes: [], edges: [] }, documents: [{ path: 'a' }] }),
      whole() + 'x',
    ]
    for (const text of cases) {
      const expected = readBackup(text)
      expect(expected.ok, text.slice(0, 50)).toBe(false)
      for (const size of [1, 4, 1000]) {
        const got = readInChunks(text, size)
        expect(got.ok, `${text.slice(0, 50)} @${String(size)}`).toBe(false)
        if (!got.ok && !expected.ok) expect(got.error.code, `${text.slice(0, 50)} @${String(size)}`).toBe(expected.error.code)
      }
    }
  })

  it('names the damaged document, as readBackup does', () => {
    const text = JSON.stringify({
      format: BACKUP_FORMAT,
      version: 1,
      graph: { nodes: [], edges: [] },
      documents: [{ path: 'Documents/x__CV.pdf', data: '!!!!' }],
    })
    expect(readInChunks(text, 3)).toEqual(readBackup(text))
  })

  it('survives a damaged byte count without reserving it', () => {
    // `bytes` sizes the buffer up front; a corrupt one must be refused, not allocated.
    const text = streamed().replace('"bytes":10000', '"bytes":999999999999')
    const read = readInChunks(text, 1000)
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.error.message).toContain('truncated')
  })
})
