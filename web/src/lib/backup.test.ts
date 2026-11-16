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
  BACKUP_NUDGE_AT,
  DOCUMENTS_NOT_READY,
  DOCUMENTS_UNREADABLE,
  backupNudge,
  backupPromptText,
  backupToast,
  collectDocuments,
  dismissBackupNudge,
  markRestoredFromBackup,
  streamDocuments,
  type BackupBlobs,
} from '@/lib/backup'
import { readBackup } from '@jojo/service/core/backup'
import { BACKUP_TAIL, backupHead } from '@jojo/service/core/backup-stream'
// `?raw`, the same way `handoff-send.test.ts` reads its own source: the wiring
// is the claim, and the wiring is only visible in the source.
import backupSource from './backup.ts?raw'
import dataPanelSource from '@/components/settings/DataPanel.tsx?raw'

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
  const parts: string[] = [
    backupHead({ exportedAt: '2026-10-22T10:00:00.000Z', nodes: [], edges: [] }),
  ]
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
    await expect(streamDocuments(blobs(two, {}), async () => undefined)).rejects.toThrow(
      DOCUMENTS_UNREADABLE,
    )
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
    expect(readBackup(text)).toMatchObject({
      ok: true,
      value: { documents: [{ path: 'Documents/b__Letter.pdf' }] },
    })
    expect(reported).toHaveBeenCalledTimes(1)
    expect((reported.mock.calls[0] as [string, Error])[1].message).toContain('1 of 2')
  })

  it('reads a large document in slices rather than whole', async () => {
    // 7 MiB: three slices. Each is read with `slice`, never `arrayBuffer` on the whole file.
    const big = new File([new Uint8Array(7 * 1024 * 1024).fill(9)], 'big.bin')
    const whole = vi.spyOn(big, 'arrayBuffer')
    const { text } = await streamed({
      ready: true,
      all: async () => [{ id: 'x', name: 'big.bin' }],
      get: async () => big,
    })
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
/** Comments stripped, so an assertion cannot pass on prose describing the fix. */
const code = backupSource.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')

describe('the hook is wired to it', () => {
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

    const assembled = download.indexOf('await assemble({}, onProgress)')
    const clicked = download.indexOf('anchor.click()')
    const lastStamp = download.lastIndexOf('writeLastBackup(')
    expect(assembled).toBeGreaterThan(-1)
    expect(lastStamp).toBeGreaterThan(clicked)
    // Inside a try, so a refusal becomes `failed` rather than an unhandled
    // rejection out of `void download(...)`.
    expect(download.lastIndexOf('try {', assembled)).toBeGreaterThan(-1)
  })
})

/**
 * Q097: a substantial change asks for a backup, a backup resets the count, and
 * "Not now" holds until the NEXT substantial change rather than the next load.
 *
 * Before this, `changed` and `shouldNudge` were computed and read by nothing.
 * The counting is a pure function and is exercised here; that the banner reads
 * it is pinned as source in `StorageBanner.requests.test.ts`.
 */
describe('asking for a backup after a substantial change (Q097)', () => {
  const at = (minute: number) => `2026-11-15T10:${String(minute).padStart(2, '0')}:00.000Z`
  /** `count` records, the i-th last changed at minute `from + i`. */
  const touched = (count: number, from: number) =>
    Array.from({ length: count }, (_, i) => ({ updatedAt: at(from + i) }))
  const none = { lastBackupAt: null, dismissedAt: null, seededAt: null }

  it('asks once BACKUP_NUDGE_AT records have changed since the last backup, not before', () => {
    expect(BACKUP_NUDGE_AT).toBe(15)
    const marks = { ...none, lastBackupAt: at(0) }
    expect(backupNudge(touched(14, 1), marks)).toEqual({ changed: 14, shouldNudge: false })
    expect(backupNudge(touched(15, 1), marks)).toEqual({ changed: 15, shouldNudge: true })
  })

  it('stops asking once a backup is taken after the changes', () => {
    const nodes = touched(20, 1)
    expect(backupNudge(nodes, none).shouldNudge).toBe(true)
    expect(backupNudge(nodes, { ...none, lastBackupAt: at(30) })).toEqual({
      changed: 0,
      shouldNudge: false,
    })
  })

  it('does not count demo records nobody has touched', () => {
    // Every seeded node carries the seed instant as its `updatedAt`.
    const seeded = Array.from({ length: 120 }, () => ({ updatedAt: at(0) }))
    expect(backupNudge(seeded, { ...none, seededAt: at(0) })).toEqual({
      changed: 0,
      shouldNudge: false,
    })
    const edited = [...seeded.slice(15), ...touched(15, 1)]
    expect(backupNudge(edited, { ...none, seededAt: at(0) })).toEqual({
      changed: 15,
      shouldNudge: true,
    })
  })

  it('stays away after "Not now" until another substantial change, then asks again', () => {
    const before = touched(20, 1)
    const dismissed = { ...none, dismissedAt: at(30) }
    // Put away: the same twenty changes do not bring it back on a reload.
    expect(backupNudge(before, dismissed)).toEqual({ changed: 20, shouldNudge: false })
    // Fourteen more is not yet a substantial change.
    expect(backupNudge([...before, ...touched(14, 31)], dismissed).shouldNudge).toBe(false)
    // Fifteen is, and the sentence still counts from the last backup.
    expect(backupNudge([...before, ...touched(15, 31)], dismissed)).toEqual({
      changed: 35,
      shouldNudge: true,
    })
  })

  it('does not ask for a backup of what a restore just brought back', () => {
    // Restored records keep their own (older) `updatedAt`, and a new device has
    // no last-backup stamp: unmarked, all forty read as unbacked.
    const restored = touched(40, 1)
    expect(backupNudge(restored, none).shouldNudge).toBe(true)
    const map = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
    })
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} })
    markRestoredFromBackup(at(50))
    expect(map.get('jojo.lastBackupAt')).toBe(at(50))
    expect(backupNudge(restored, { ...none, lastBackupAt: at(50) }).shouldNudge).toBe(false)
    // Settings stamps it once the restore has succeeded, before the reload.
    const onRestore =
      /const onRestore = async \(\) => \{[\s\S]*?\n {2}\}\n/.exec(dataPanelSource)?.[0] ?? ''
    expect(onRestore.indexOf('markRestoredFromBackup(')).toBeGreaterThan(
      onRestore.indexOf('if (!done.ok)'),
    )
  })

  it('ignores a "Not now" older than the last backup', () => {
    const marks = { ...none, lastBackupAt: at(30), dismissedAt: at(10) }
    expect(backupNudge(touched(15, 31), marks)).toEqual({ changed: 15, shouldNudge: true })
  })

  it('remembers "Not now" in localStorage beside the last-backup instant, not in IndexedDB', () => {
    const map = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
    })
    try {
      dismissBackupNudge(at(30))
      expect(map.get('jojo.backupNudgeDismissedAt')).toBe(at(30))
    } finally {
      vi.unstubAllGlobals()
    }
    expect(code).toContain("const LAST_BACKUP_KEY = 'jojo.lastBackupAt'")
    expect(code).toContain("const NUDGE_DISMISSED_KEY = 'jojo.backupNudgeDismissedAt'")
    expect(code).not.toMatch(/indexedDB/i)
  })

  it('says how much is unprotected, and whether there has ever been a backup', () => {
    expect(backupPromptText(15, null)).toMatch(/^15 records in jojo are not in any backup yet\./)
    expect(backupPromptText(1, null)).toMatch(/^1 record in jojo is not in any backup yet\./)
    expect(backupPromptText(22, at(0))).toMatch(
      /^22 records have changed since your last backup on /,
    )
  })

  it('tells every useBackup when a backup is taken or the prompt is put away', () => {
    // Read during render with no subscription, a backup taken from Settings left
    // the banner asking for one until some unrelated edit re-rendered it.
    expect(code).toContain('useSyncExternalStore(subscribeMarks, readLastBackup, noMark)')
    expect(code).toContain('useSyncExternalStore(subscribeMarks, readNudgeDismissed, noMark)')
    const stamp = code.slice(code.indexOf('function writeLastBackup('))
    expect(stamp.slice(0, stamp.indexOf('\n}'))).toContain('marksChanged()')
    expect(code).toMatch(
      /backupNudge\(graph\.nodes\(\), \{ lastBackupAt, dismissedAt, seededAt \}\)/,
    )
    // Never the function itself: `onClick={backup.dismiss}` would pass it the event.
    expect(code).toContain('dismiss: () => dismissBackupNudge(),')
  })

  it('words the outcome of a download once, for Settings and the prompt alike', () => {
    expect(backupToast('cancelled', 'x.json')).toBeNull()
    expect(backupToast('failed', 'x.json')?.tone).toBe('danger')
    expect(backupToast('saved', 'x.json')?.title).toBe('Backup saved')
    expect(backupToast('started', 'x.json')?.description).toContain(
      'Look for x.json in your downloads.',
    )
  })
})

describe('what the backup toast promises', () => {
  it('says how many documents are missing instead of promising every one', () => {
    const said = backupToast({ kind: 'started', documents: { written: 7, total: 10 } }, 'x.json')
    expect(said?.description).toContain(
      '7 of your 10 documents — 3 could not be read and are not in it',
    )
    expect(said?.description).not.toContain('every document')
  })

  it('gives jojo’s own refusal its own sentence, not the download advice', () => {
    const said = backupToast({ kind: 'failed', reason: DOCUMENTS_NOT_READY }, 'x.json')
    expect(said?.description).toBe(DOCUMENTS_NOT_READY)
  })

  it('still promises every document when every one went in', () => {
    const said = backupToast({ kind: 'saved', documents: { written: 2, total: 2 } }, 'x.json')
    expect(said?.description).toBe(
      'x.json holds your records and every document you have attached.',
    )
  })
})
