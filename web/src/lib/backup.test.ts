/**
 * The backup that said it held every document and held none.
 *
 * Measured before the fix, with an index listing two documents and every `get`
 * answering null — an IndexedDB that opened and would not read, which is what an
 * evicted store looks like: `useBackup().download()` wrote `"documents":[]`,
 * returned true, and stamped `jojo.lastBackupAt`. The panel then said "it holds
 * your records and every document you have attached" and the app counted the
 * user as backed up. Every layer was individually reasonable — the loop skipped
 * a file it could not read, the writer wrote what it was given, `download`
 * recorded a click that really did happen — and the join lost the documents in
 * silence. Somebody told their backup exists stops looking for one.
 *
 * D20 rules out mounting the hook, so this tests the two things the defect was
 * actually made of: that `collectDocuments` refuses rather than answering with
 * an empty list, and — the half that would otherwise pass while the hook ignored
 * it — that `build` is WIRED to it and `download` still stamps only afterwards.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DOCUMENTS_NOT_READY,
  DOCUMENTS_UNREADABLE,
  collectDocuments,
  streamDocuments,
  type BackupBlobs,
} from '@/lib/backup'
import { readBackup } from '@jojo/service/core/backup'
import { BACKUP_TAIL, backupHead } from '@jojo/service/core/backup-stream'
// `?raw`, the same way `handoff-send.test.ts` reads its own source: the wiring
// is the claim, and the wiring is only visible in the source.
import backupSource from './backup.ts?raw'

// Hoisted, because `vi.mock` is lifted above the imports.
const { reported } = vi.hoisted(() => ({ reported: vi.fn() }))
vi.mock('@/lib/report-error', () => ({ reportError: reported }))

afterEach(() => {
  reported.mockReset()
})

const file = (name: string) => new File([new Uint8Array([1, 2, 3, 4])], name)

/** The listed documents, and which of them will actually read back. */
const blobs = (
  listed: readonly { id: string; name: string }[],
  readable: Record<string, string>,
  ready = true,
): BackupBlobs => ({
  ready,
  all: async () => [...listed],
  get: async (id: string) => (id in readable ? file(readable[id]!) : null),
})

describe('gathering the documents a backup is supposed to contain', () => {
  it('refuses while the index is still loading, rather than reporting none', async () => {
    /*
     * The ordinary case, and the one with nothing wrong with it. The index loads
     * asynchronously on mount — the store is opened and the trash swept before
     * the first `list` — so for a moment after the page appears `all()` answers
     * `[]` for a store that is full. Both entry points are reachable in that
     * window: Export is on the panel that mounts the hook, and Transfer mounts
     * its own. "Not known yet" and "none" must not write the same file.
     */
    await expect(collectDocuments(blobs([], {}, false))).rejects.toThrow(DOCUMENTS_NOT_READY)
  })

  it('refuses when everything listed will not read', async () => {
    const two = [
      { id: 'a', name: 'CV.pdf' },
      { id: 'b', name: 'Letter.pdf' },
    ]
    await expect(collectDocuments(blobs(two, {}))).rejects.toThrow(DOCUMENTS_UNREADABLE)
  })

  it('backs up an empty vault without complaint', async () => {
    // The companion assertion. A guard that refused here would leave anybody
    // who has attached no documents unable to back up their records at all —
    // which would be the fix costing more than the defect.
    await expect(collectDocuments(blobs([], {}))).resolves.toEqual([])
    expect(reported).not.toHaveBeenCalled()
  })

  it('carries the bytes under the path a restore parses', async () => {
    const documents = await collectDocuments(
      blobs([{ id: 'file:01a0', name: 'My CV.pdf' }], { 'file:01a0': 'My CV.pdf' }),
    )

    // `blobPath`'s spelling, not a second one written out here: the phone
    // restoring this file splits the id back off the front of it.
    expect(documents).toEqual([
      { path: 'Documents/file:01a0__My CV.pdf', data: new Uint8Array([1, 2, 3, 4]) },
    ])
    expect(reported).not.toHaveBeenCalled()
  })

  it('keeps a partial backup, and says how much of it is missing', async () => {
    /*
     * The trade the loop already made and this does not undo: a backup missing
     * one file is worth far more than no backup. What changes is that the
     * shortfall is reported — the count is the only evidence anything was lost,
     * and until now it existed nowhere at all.
     */
    const documents = await collectDocuments(
      blobs(
        [
          { id: 'a', name: 'CV.pdf' },
          { id: 'b', name: 'Letter.pdf' },
        ],
        { a: 'CV.pdf' },
      ),
    )

    expect(documents).toHaveLength(1)
    expect(reported).toHaveBeenCalledTimes(1)
    const [site, error] = reported.mock.calls[0] as [string, Error]
    expect(site).toBe('backup')
    expect(error.message).toContain('1 of 2')
  })
})

/** What a sink was handed, joined back into the file text. */
async function streamed(source: BackupBlobs): Promise<{ text: string; parts: number }> {
  const parts: string[] = [backupHead({ exportedAt: '2026-10-22T10:00:00.000Z', nodes: [], edges: [] })]
  await streamDocuments(source, async (part) => {
    parts.push(typeof part === 'string' ? part : new TextDecoder().decode(part))
  })
  parts.push(BACKUP_TAIL)
  return { text: parts.join(''), parts: parts.length }
}

describe('streaming the documents into a backup', () => {
  it('writes a file the reader restores, with every byte of every document', async () => {
    const { text } = await streamed(
      blobs(
        [
          { id: 'file:a', name: 'CV.pdf' },
          { id: 'file:b', name: 'Letter.pdf' },
        ],
        { 'file:a': 'CV.pdf', 'file:b': 'Letter.pdf' },
      ),
    )
    const read = readBackup(text)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.value.documents).toEqual([
      { path: 'Documents/file:a__CV.pdf', data: new Uint8Array([1, 2, 3, 4]) },
      { path: 'Documents/file:b__Letter.pdf', data: new Uint8Array([1, 2, 3, 4]) },
    ])
  })

  it('refuses while the index is loading BEFORE writing a single piece', async () => {
    // Refused up front, so a download never opens a file it then has to abort.
    const sink = vi.fn(async () => undefined)
    await expect(streamDocuments(blobs([], {}, false), sink)).rejects.toThrow(DOCUMENTS_NOT_READY)
    expect(sink).not.toHaveBeenCalled()
  })

  it('refuses when everything listed will not read', async () => {
    const two = [
      { id: 'a', name: 'CV.pdf' },
      { id: 'b', name: 'Letter.pdf' },
    ]
    await expect(streamDocuments(blobs(two, {}), async () => undefined)).rejects.toThrow(DOCUMENTS_UNREADABLE)
  })

  it('keeps a partial backup, and says how much of it is missing', async () => {
    const { text } = await streamed(
      blobs(
        [
          { id: 'a', name: 'CV.pdf' },
          { id: 'b', name: 'Letter.pdf' },
        ],
        { b: 'Letter.pdf' },
      ),
    )
    // The skipped first document must not leave a leading comma behind.
    expect(readBackup(text)).toMatchObject({ ok: true, value: { documents: [{ path: 'Documents/b__Letter.pdf' }] } })
    expect(reported).toHaveBeenCalledTimes(1)
    expect((reported.mock.calls[0] as [string, Error])[1].message).toContain('1 of 2')
  })

  it('reads a large document in slices rather than whole', async () => {
    // 7 MiB: three slices. Each is read with `slice`, never `arrayBuffer` on the whole file.
    const big = new File([new Uint8Array(7 * 1024 * 1024).fill(9)], 'big.bin')
    const whole = vi.spyOn(big, 'arrayBuffer')
    const { text } = await streamed({ ready: true, all: async () => [{ id: 'x', name: 'big.bin' }], get: async () => big })
    expect(whole).not.toHaveBeenCalled()
    const read = readBackup(text)
    expect(read.ok && read.value.documents[0]?.data.byteLength).toBe(7 * 1024 * 1024)
  })
})

/**
 * The wiring, which is the other half of the fix.
 *
 * `streamDocuments` holds none of the hook's logic — exercising it says
 * nothing about whether the hook calls it. The defect was the hook doing the
 * gathering itself and swallowing the result, so what is asserted here is that
 * it no longer does.
 */
describe('the hook is wired to it', () => {
  /** Comments stripped, so an assertion cannot pass on prose describing the fix. */
  const code = backupSource.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
  const write = code.slice(code.indexOf('const write = useCallback('))

  it('gathers through streamDocuments rather than in the hook', () => {
    expect(write).toContain('await streamDocuments(blobs, sink, onProgress)')
    // One spelling of the path format, in `blob-path.ts`, is what makes a
    // restore on another device parse what this wrote.
    expect(code).not.toContain('`Documents/')
    // And never the whole store as one string again.
    expect(code).not.toContain('JSON.stringify(backup')
  })

  it('records the backup only after the file exists, on both paths', () => {
    /*
     * Order, not presence. `writeLastBackup` is what tells the user they are
     * safe and what `changed` counts from, so a stamp that ran before the file
     * was complete would put the app's own reassurance in front of it.
     */
    const download = code.slice(code.indexOf('const download = useCallback('))
    const closed = download.indexOf('await file.close()')
    const firstStamp = download.indexOf('writeLastBackup(')
    expect(closed).toBeGreaterThan(-1)
    expect(firstStamp).toBeGreaterThan(closed)

    const assembled = download.indexOf('await blob({}, onProgress)')
    const clicked = download.indexOf('anchor.click()')
    const lastStamp = download.lastIndexOf('writeLastBackup(')
    expect(assembled).toBeGreaterThan(-1)
    expect(lastStamp).toBeGreaterThan(clicked)
    // Inside a try, so a refusal becomes `failed` rather than an unhandled
    // rejection out of `void download(...)`.
    expect(download.lastIndexOf('try {', assembled)).toBeGreaterThan(-1)
  })
})
