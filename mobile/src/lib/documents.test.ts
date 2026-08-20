/**
 * The file the ejection rewrote wholesale, and the only one in `src/lib` that
 * three semantics changed underneath.
 *
 * `expo-document-picker` + `expo-file-system` + `expo-sharing` became
 * `@react-native-documents/picker` + `react-native-blob-util`, and three things
 * did NOT translate: a record holds a URI while the new filesystem takes a
 * PATH, the MIME type became ours to supply, and cancelling became a throw
 * rather than a flag. Each of those fails silently — a document that reports
 * itself missing, an intent nothing offers to handle, an error message shown to
 * somebody who simply changed their mind — and each is reachable only from a
 * phone, which is the one place a green gate proves nothing.
 *
 * So the native modules are stubbed and the assertions are on what this file
 * HANDS them: the path it decoded, the MIME it derived, the outcome it returned.
 * Nothing here re-tests blob-util or the picker.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  documentExists,
  forgetDocument,
  forgetDocuments,
  openDocument,
  pickDocuments,
  type PickOutcome,
} from './documents'

/**
 * The cancel code, spelled out because the picker cannot be imported here (its
 * entry point pulls in React Native's flow-typed internals, which `vitest`'s
 * node environment cannot parse).
 *
 * The annotation is the guard: it is the package's own literal type, so a
 * release that renames the code fails `tsc` here rather than leaving this file
 * asserting a string nothing produces any more.
 */
const CANCELED: (typeof import('@react-native-documents/picker'))['errorCodes']['OPERATION_CANCELED'] =
  'OPERATION_CANCELED'

/** What the picker does on the next call. Set per test. */
let pickResult: { assets?: unknown[]; throws?: unknown } = {}
/** What `keepLocalCopy` reports back, one entry per file it was handed. */
let copyResults: unknown[] = []
/** The `FileToCopy[]` the last `keepLocalCopy` call was handed. */
let copyRequest: { fileName: string; uri: string }[] = []

vi.mock('@react-native-documents/picker', () => ({
  pick: () => {
    if ('throws' in pickResult) return Promise.reject(pickResult.throws)
    return Promise.resolve(pickResult.assets ?? [])
  },
  keepLocalCopy: ({ files }: { files: { fileName: string; uri: string }[] }) => {
    copyRequest = files
    return Promise.resolve(copyResults)
  },
  errorCodes: { OPERATION_CANCELED: 'OPERATION_CANCELED' },
  isErrorWithCode: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}))

/** Every path blob-util's fs was asked about, in order. */
const fsCalls: { call: string; path: string }[] = []
/** Paths that exist, and the size `stat` reports for each. */
const onDisk = new Map<string, number>()
/** The `(path, mime)` pair the last ACTION_VIEW intent was built from. */
let intent: { path: string; mime: string } | null = null

vi.mock('react-native-blob-util', () => ({
  default: {
    fs: {
      exists: (path: string) => {
        fsCalls.push({ call: 'exists', path })
        return Promise.resolve(onDisk.has(path))
      },
      stat: (path: string) => {
        fsCalls.push({ call: 'stat', path })
        const size = onDisk.get(path)
        return size === undefined ? Promise.reject(new Error('ENOENT')) : Promise.resolve({ size })
      },
      unlink: (path: string) => {
        fsCalls.push({ call: 'unlink', path })
        if (!onDisk.delete(path)) return Promise.reject(new Error('ENOENT'))
        return Promise.resolve()
      },
    },
    android: {
      actionViewIntent: (path: string, mime: string) => {
        intent = { path, mime }
        return Promise.resolve()
      },
    },
  },
}))

/**
 * Mutated in place by the iOS cases — `Platform.OS` is read at call time.
 *
 * `vi.hoisted` because the factory below is hoisted above this file's own
 * declarations and reads the object eagerly, unlike every other stub here.
 */
const platform = vi.hoisted(() => ({ OS: 'android' }))
let shared: { url: string } | null = null

vi.mock('react-native', () => ({
  Platform: platform,
  Share: {
    share: (content: { url: string }) => {
      shared = content
      return Promise.resolve({ action: 'sharedAction' })
    },
  },
}))

beforeEach(() => {
  pickResult = {}
  copyResults = []
  copyRequest = []
  fsCalls.length = 0
  onDisk.clear()
  intent = null
  shared = null
  platform.OS = 'android'
})

const asset = (over: Record<string, unknown> = {}) => ({
  uri: 'content://com.android.providers.downloads/document/42',
  name: 'CV 2026.pdf',
  size: 188416,
  type: 'application/pdf',
  ...over,
})

const copied = (localUri: string) => ({ status: 'success', localUri })

/** The shape `pickDocuments` returns on success, narrowed for the assertions. */
const documentsOf = (outcome: PickOutcome) => (outcome.ok ? outcome.documents : [])

/* ------------------------------ URI vs path ------------------------------- */

describe('the URI a record holds, and the path the filesystem wants', () => {
  const uri = 'file:///data/user/0/dev.jojo/files/9f2/1764000000000-CV%202026.pdf'
  const path = '/data/user/0/dev.jojo/files/9f2/1764000000000-CV 2026.pdf'

  it('strips the scheme and decodes the escape before asking whether the bytes are there', async () => {
    onDisk.set(path, 188416)
    // The failure this catches is silent: skip the decode and `exists` answers
    // false for a file that is right there, so every document whose name has a
    // space in it reports itself lost the moment it is filed.
    expect(await documentExists(uri)).toBe(true)
    expect(fsCalls).toEqual([{ call: 'exists', path }])
  })

  it('answers false for a record that never had bytes, without touching the disk', async () => {
    expect(await documentExists(undefined)).toBe(false)
    expect(fsCalls).toEqual([])
  })

  it('answers false rather than rejecting when the filesystem itself fails', async () => {
    expect(await documentExists('file:///gone/CV.pdf')).toBe(false)
  })

  it('deletes through the same decode, and survives a copy that is already gone', async () => {
    onDisk.set(path, 188416)
    await forgetDocument(uri)
    expect(fsCalls).toEqual([{ call: 'unlink', path }])
    expect(onDisk.has(path)).toBe(false)
    // Best effort: the record is the truth, and a failed unlink must not fail
    // the delete the user asked for.
    await expect(forgetDocument(uri)).resolves.toBeUndefined()
  })

  it('does not unlink when there is no uri to unlink', async () => {
    await forgetDocument(undefined)
    expect(fsCalls).toEqual([])
  })
})

/* ------------------------- clearing every record -------------------------- */

/**
 * The set form, and the bug it closes.
 *
 * Settings' "Clear every record" told the user the vault was going and took
 * only the rows: every document ever attached stayed in the app's sandbox,
 * reclaimable by uninstalling and by nothing else. `forgetDocument` had existed
 * the whole time with no caller.
 */
describe('forgetting every copy at once', () => {
  it('unlinks each one, through the same decode', async () => {
    onDisk.set('/files/a/CV 2026.pdf', 1)
    onDisk.set('/files/b/Offer.pdf', 2)

    await forgetDocuments(['file:///files/a/CV%202026.pdf', 'file:///files/b/Offer.pdf'])

    expect(fsCalls.map((c) => c.path).sort()).toEqual([
      '/files/a/CV 2026.pdf',
      '/files/b/Offer.pdf',
    ])
    expect(onDisk.size).toBe(0)
  })

  /**
   * `onDuplicate` in `FilesTool` copies `uri` verbatim, so two rows can name
   * one file. The dedupe changes no outcome — the second unlink would reject
   * with ENOENT and be swallowed — but it states the sharing, so a later caller
   * that reports failures does not report a phantom one.
   */
  it('unlinks a file two records share exactly once', async () => {
    onDisk.set('/files/a/CV.pdf', 1)

    await forgetDocuments(['file:///files/a/CV.pdf', 'file:///files/a/CV.pdf'])

    expect(fsCalls).toHaveLength(1)
  })

  it('touches nothing for a vault of hand-typed rows', async () => {
    // The common shape: most file rows describe a document on a laptop or on
    // paper and have no copy behind them. Measured rather than assumed — the
    // early return that makes this true is `forgetDocument`'s, not the filter's
    // here, which exists so the deduped set is a set of strings.
    await forgetDocuments([undefined, undefined])
    expect(fsCalls).toEqual([])
  })

  it('does not reject when a copy has already gone', async () => {
    // The caller is a press handler that has already emptied the store. There
    // is nothing left for a rejection here to mean.
    await expect(forgetDocuments(['file:///gone/CV.pdf'])).resolves.toBeUndefined()
  })
})

/* --------------------------- the MIME is ours now ------------------------- */

describe('handing a copy to whatever can open it', () => {
  it('builds the Android intent from the decoded path and the extension', async () => {
    await openDocument('file:///data/user/0/dev.jojo/files/9f2/1764-Offer%20letter.pdf')
    expect(intent).toEqual({
      path: '/data/user/0/dev.jojo/files/9f2/1764-Offer letter.pdf',
      mime: 'application/pdf',
    })
  })

  it('shrugs with the wildcard rather than claiming octet-stream', async () => {
    await openDocument('file:///data/files/9f2/1764-notes.unknown')
    // Octet-stream is a claim Android honours by offering nothing; the wildcard
    // lets the phone offer whatever it has.
    expect(intent?.mime).toBe('*/*')
  })

  it('hands iOS the URI, not the path — the share sheet takes the URL form', async () => {
    platform.OS = 'ios'
    const uri = 'file:///var/mobile/Containers/Data/9f2/1764-CV%202026.pdf'
    await openDocument(uri)
    expect(shared).toEqual({ url: uri })
    expect(intent).toBeNull()
  })
})

/* ------------------------- picking, and not picking ----------------------- */

describe('picking documents', () => {
  it('copies what was picked and records the name the user recognises', async () => {
    copyResults = [copied('file:///data/files/9f2/1764-CV%202026.pdf')]
    pickResult = { assets: [asset()] }

    const outcome = await pickDocuments('Applications')

    expect(outcome.ok).toBe(true)
    expect(documentsOf(outcome)).toEqual([
      {
        name: 'CV 2026.pdf',
        kind: 'pdf',
        size: '184 KB',
        uri: 'file:///data/files/9f2/1764-CV%202026.pdf',
      },
    ])
  })

  it('sanitises the stored name and leaves the record name alone', async () => {
    copyResults = [copied('file:///data/files/9f2/x.pdf')]
    pickResult = { assets: [asset({ name: 'Rice / offer: final?.pdf' })] }

    const outcome = await pickDocuments('Applications')

    // A slash in a filename is a directory that does not exist. Spaces stay —
    // `pathOf` is what makes them safe, and stripping them would change the
    // name the user reads on a row.
    expect(copyRequest[0]?.fileName).toMatch(/^\d+-Rice _ offer_ final_\.pdf$/)
    expect(documentsOf(outcome)[0]?.name).toBe('Rice / offer: final?.pdf')
  })

  it('reads the size off the disk when the picker did not report one', async () => {
    onDisk.set('/data/files/9f2/x.pdf', 1536)
    copyResults = [copied('file:///data/files/9f2/x.pdf')]
    pickResult = { assets: [asset({ size: null })] }

    expect(documentsOf(await pickDocuments('Applications'))[0]?.size).toBe('2 KB')
  })

  it('says the size is unknown rather than claiming zero bytes', async () => {
    // Nothing on disk, so `stat` rejects and the fallback is 0 — which means
    // "nobody could say", not "this file is empty".
    copyResults = [copied('file:///data/files/9f2/x.pdf')]
    pickResult = { assets: [asset({ size: null })] }

    expect(documentsOf(await pickDocuments('Applications'))[0]?.size).toBe('—')
  })

  it('keeps the files that copied when one of a batch fails', async () => {
    copyResults = [
      { status: 'error', copyError: 'permission denied' },
      copied('file:///data/files/9f2/two.pdf'),
    ]
    pickResult = { assets: [asset({ name: 'one.pdf' }), asset({ name: 'two.pdf' })] }

    const outcome = await pickDocuments('Applications')

    // The code this replaced threw on the first failure and lost the rest of
    // the batch.
    expect(documentsOf(outcome).map((d) => d.name)).toEqual(['two.pdf'])
  })

  it('reports the first failure when nothing copied at all', async () => {
    copyResults = [{ status: 'error', copyError: 'permission denied' }]
    pickResult = { assets: [asset()] }

    const outcome = await pickDocuments('Applications')

    expect(outcome).toEqual({ ok: false, cancelled: false, reason: 'permission denied' })
  })

  it('treats a dismissed picker as cancelled, not as an error', async () => {
    // Cancelling is a throw now, not a flag: `result.canceled` is gone. Without
    // the code check this falls through to the failure branch and `FileEditor`
    // prints an error at somebody who changed their mind.
    pickResult = { throws: Object.assign(new Error('User canceled'), { code: CANCELED }) }

    expect(await pickDocuments('Applications')).toEqual({ ok: false, cancelled: true })
  })

  it('reports a picker that genuinely failed', async () => {
    pickResult = { throws: new Error('no provider') }

    expect(await pickDocuments('Applications')).toEqual({
      ok: false,
      cancelled: false,
      reason: 'no provider',
    })
  })
})
