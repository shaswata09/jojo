/**
 * Runs `file-store-conformance.ts` against the File System Access adapter.
 *
 * Lives outside `src/` on purpose. It is not part of the app and must never be
 * bundled into it — Vite's build has one input, `index.html`, so nothing here
 * reaches a production chunk — but it also must not be counted as app source by
 * the guide's directory table, which globs `src/**`.
 *
 * Why it is not a Vitest file: the suite's own header explains it. Every method
 * on this adapter needs a real `FileSystemDirectoryHandle`, and jsdom has none —
 * which D20 forbids importing anyway. So the suite runs in a real browser, and
 * the browser is driven over CDP by `scripts/fs-conformance.mjs`.
 *
 * The handle comes from OPFS rather than `showDirectoryPicker`. A picker needs a
 * user gesture and opens a native dialog that CDP cannot drive, whereas
 * `navigator.storage.getDirectory()` returns the same interface with neither.
 * The adapter is written against the handle, not against the picker, precisely
 * so this substitution is possible — and every case below therefore exercises
 * the real API surface the user's documents will go through.
 */

import { CONFORMANCE_CASES, type ConformanceHooks } from '@jojo/service/storage/file-store-conformance'
import type { FileStore } from '@jojo/service/storage/file-store'
import { createFsFileStore } from '@/kg/storage/fs-file-store'
import { ensureIdentity } from '@/kg/storage/folder-connect'

const enc = new TextEncoder()

/** Which OPFS directory backs which store, so the hooks can go behind its back. */
const roots = new WeakMap<FileStore, FileSystemDirectoryHandle>()

const segmentsOf = (path: string) => path.split('/').filter((s) => s.length > 0)

/** Resolves a path directly on a handle — the "user in Finder" path, not the store's. */
async function locate(root: FileSystemDirectoryHandle, path: string, create: boolean) {
  const parts = segmentsOf(path)
  const name = parts.pop()!
  let dir = root
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create })
  return { dir, name }
}

async function placeRaw(root: FileSystemDirectoryHandle, path: string, data: Uint8Array) {
  const { dir, name } = await locate(root, path, true)
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable()
  await w.write(data)
  await w.close()
}

async function removeRaw(root: FileSystemDirectoryHandle, path: string) {
  const { dir, name } = await locate(root, path, false)
  await dir.removeEntry(name)
}

let caseNo = 0

const hooks: ConformanceHooks = {
  /**
   * A fresh directory per case, not a cleaned one.
   *
   * Cases share an origin, and `trash` deliberately leaves files behind — the
   * whole point of it. Reusing one directory would let a case that trashed
   * `Documents/CV.pdf` change what the next case sees in `jojo/Trash`, and the
   * failure would land on whichever case ran second rather than on the one that
   * caused it.
   */
  async create() {
    const opfs = await navigator.storage.getDirectory()
    const root = await opfs.getDirectoryHandle(`case-${++caseNo}`, { create: true })
    // `Documents/` is deliberately NOT created. The memory store has no
    // directories at all, so on that host "list an empty directory" and "list a
    // directory that was never created" are the same case — and the contract
    // says both answer `ok([])`. Pre-creating it here made this host test only
    // the easier half, and hid a real difference in the adapter.
    //
    // The vault marker IS written, because the suite expects a paired store.
    await placeRaw(
      root,
      'jojo/folder.json',
      enc.encode(
        JSON.stringify({
          vaultId: `vault-opfs-${caseNo}`,
          createdAt: '2026-01-01T00:00:00.000Z',
          appVersion: 'conformance',
        }),
      ),
    )
    const store = createFsFileStore({ root })
    roots.set(store, root)
    return store
  },

  place: async (store, path, data) => {
    await placeRaw(roots.get(store)!, path, data)
  },

  remove: async (store, path) => {
    await removeRaw(roots.get(store)!, path)
  },
}

/**
 * A directory handle that fails on demand.
 *
 * The shared suite cannot reach this adapter's error mapping at all: OPFS never
 * denies permission, never runs out of quota, and never unmounts, so every code
 * except `files/not-found` is unreachable from a real handle. That mapping is
 * the bulk of the adapter's own logic — the part with no counterpart in the
 * memory store — and it was entirely untested. Measured: removing the
 * `not-found` narrowing from `exists` so it swallowed EVERY error and reported
 * absence left all 23 shared cases passing.
 *
 * Faults by DOMException `name`, because that is what the adapter maps on.
 */
function faultingRoot(opts: {
  throws: DOMException
  rootDead?: boolean
  /**
   * Make the walk to a subdirectory fail too.
   *
   * Needed to reach `list`'s missing-directory narrowing at all. Without it the
   * fake resolved every `getDirectoryHandle`, the walk succeeded, and the throw
   * arrived later from `entries()` — so a mutation that deleted the liveness
   * check from that narrowing left the whole suite green.
   */
  throwsOnDir?: boolean
}): FileSystemDirectoryHandle {
  const iter = async function* () {
    if (opts.rootDead) throw new DOMException('root gone', 'NotFoundError')
    // A live but empty root: yields nothing and, crucially, does not throw.
    yield* []
  }
  const dir = {
    kind: 'directory' as const,
    name: 'fault',
    keys: iter,
    values: iter,
    entries: iter,
    [Symbol.asyncIterator]: iter,
    getDirectoryHandle: async () => {
      if (opts.throwsOnDir) throw opts.throws
      return dir
    },
    getFileHandle: async () => {
      throw opts.throws
    },
    removeEntry: async () => {
      throw opts.throws
    },
  }
  return dir as unknown as FileSystemDirectoryHandle
}

const dom = (name: string) => new DOMException(`injected ${name}`, name)

/** Cases that exist only for this adapter, because only this one can fail this way. */
const ADAPTER_CASES: readonly { name: string; run(): Promise<void> }[] = [
  {
    name: 'a lapsed permission maps to files/denied, not a throw',
    async run() {
      const store = createFsFileStore({ root: faultingRoot({ throws: dom('NotAllowedError') }) })
      const r = await store.read('Documents/a.txt')
      expectFail(r, 'files/denied', 'read under a lapsed grant')
    },
  },
  {
    name: 'exists refuses to report absence when the platform denies',
    async run() {
      // The hazard this narrowing exists for: a caller that trusts a `false`
      // here goes on to overwrite a file it was never allowed to read.
      const store = createFsFileStore({ root: faultingRoot({ throws: dom('NotAllowedError') }) })
      const r = await store.exists('Documents/a.txt')
      expectFail(r, 'files/denied', 'exists under a lapsed grant')
    },
  },
  {
    name: 'a full disk maps to files/quota',
    async run() {
      const store = createFsFileStore({ root: faultingRoot({ throws: dom('QuotaExceededError') }) })
      const r = await store.write('Documents/a.txt', enc.encode('x'))
      expectFail(r, 'files/quota', 'write to a full disk')
    },
  },
  {
    name: 'a missing file in a folder that is still there is files/not-found',
    async run() {
      const store = createFsFileStore({ root: faultingRoot({ throws: dom('NotFoundError') }) })
      const r = await store.read('Documents/a.txt')
      expectFail(r, 'files/not-found', 'read of a missing file')
    },
  },
  {
    name: 'the same error is files/gone once the folder itself stops answering',
    async run() {
      // Same DOMException, different meaning, and the difference is the whole
      // repair: not-found is one document, gone is "pick the folder again".
      const store = createFsFileStore({
        root: faultingRoot({ throws: dom('NotFoundError'), rootDead: true }),
      })
      const r = await store.read('Documents/a.txt')
      expectFail(r, 'files/gone', 'read from a folder that moved')
    },
  },
  {
    name: 'a missing directory does NOT read as empty once the folder is gone',
    async run() {
      const store = createFsFileStore({
        root: faultingRoot({ throws: dom('NotFoundError'), rootDead: true, throwsOnDir: true }),
      })
      const r = await store.list('Documents')
      // Guards the `ok([])` narrowing in `list`: a folder full of documents
      // rendering as none is worse than an error.
      expectFail(r, 'files/gone', 'list from a folder that moved')
    },
  },
  {
    name: 'pairing a folder jojo has never seen writes a marker and mints an id',
    async run() {
      const opfs = await navigator.storage.getDirectory()
      const root = await opfs.getDirectoryHandle(`pair-fresh-${++caseNo}`, { create: true })
      const store = createFsFileStore({ root })

      const r = await ensureIdentity(store, '2026-03-04T00:00:00.000Z', 'test')
      if (!r.ok) throw new Error(`pair: expected ok, got ${r.error.code}`)
      if (r.value.vaultId.length === 0) throw new Error('pair: empty vaultId')

      // Written through, not just returned — a marker that exists only in memory
      // would let the next session mint a second id for the same folder.
      const back = await store.read('jojo/folder.json')
      if (!back.ok) throw new Error('pair: marker was not written to the folder')
      const onDisk = JSON.parse(new TextDecoder().decode(back.value)) as { vaultId: string }
      if (onDisk.vaultId !== r.value.vaultId) throw new Error('pair: marker disagrees with result')
    },
  },
  {
    name: 'pairing an already-paired folder keeps its id rather than minting a new one',
    async run() {
      const opfs = await navigator.storage.getDirectory()
      const root = await opfs.getDirectoryHandle(`pair-again-${++caseNo}`, { create: true })
      const store = createFsFileStore({ root })

      const first = await ensureIdentity(store, '2026-03-04T00:00:00.000Z', 'test')
      if (!first.ok) throw new Error('pair: first pairing failed')
      const second = await ensureIdentity(store, '2026-09-09T00:00:00.000Z', 'test')
      if (!second.ok) throw new Error('pair: second pairing failed')

      // Reconnecting to your own folder must not look like adopting a new one.
      if (second.value.vaultId !== first.value.vaultId) {
        throw new Error('pair: reconnecting re-minted the vault id')
      }
    },
  },
  {
    name: 'a marker that exists but cannot be read is NOT overwritten with a new id',
    async run() {
      // The branch that would destroy a folder's identity. Absence means "new
      // folder"; anything else — a lapsed grant, a disk that gave up mid-read —
      // means the marker may well be there, and minting over it is the one
      // action that makes a real folder look brand new.
      //
      // A store whose READS fail and whose WRITES work, over a real OPFS folder.
      // A wholly-faulting handle cannot test this: the write would fail too, so
      // deleting the guard still produced `files/denied` and the case passed on
      // a mutant — measured. Only failing `identity` isolates the decision.
      const opfs = await navigator.storage.getDirectory()
      const root = await opfs.getDirectoryHandle(`pair-unreadable-${++caseNo}`, { create: true })
      const real = createFsFileStore({ root })
      const readsDenied = {
        ...real,
        identity: async () => ({
          ok: false as const,
          error: { code: 'files/denied' as const, message: 'injected' },
        }),
      }

      const r = await ensureIdentity(readsDenied, '2026-03-04T00:00:00.000Z', 'test')
      if (r.ok) throw new Error('pair: minted a new identity over an unreadable marker')
      if (r.error.code !== 'files/denied') {
        throw new Error(`pair: expected files/denied, got ${r.error.code}`)
      }
      // The assertion that actually bites: nothing was written to the folder.
      const marker = await real.exists('jojo/folder.json')
      if (!marker.ok) throw new Error('pair: could not check the folder')
      if (marker.value) throw new Error('pair: a marker was written over an unreadable one')
    },
  },
  {
    name: 'an unbound store answers files/no-folder without touching a handle',
    async run() {
      const store = createFsFileStore()
      if (store.connected()) throw new Error('expected a disconnected store')
      expectFail(await store.read('Documents/a.txt'), 'files/no-folder', 'read with no folder')
      expectFail(await store.write('Documents/a.txt', enc.encode('x')), 'files/no-folder', 'write')
      expectFail(await store.list('Documents'), 'files/no-folder', 'list')
    },
  },
]

function expectFail(r: { ok: boolean } & Record<string, unknown>, code: string, what: string) {
  if (r.ok) throw new Error(`${what}: expected ${code}, got ok`)
  const got = (r as { error: { code: string; message: string } }).error
  if (got.code !== code) throw new Error(`${what}: expected ${code}, got ${got.code} (${got.message})`)
}

export type CaseResult = { name: string; ok: boolean; error?: string }

async function runAll(): Promise<CaseResult[]> {
  const out: CaseResult[] = []
  for (const c of CONFORMANCE_CASES) {
    try {
      await c.run(await hooks.create(), hooks)
      out.push({ name: c.name, ok: true })
    } catch (e) {
      out.push({ name: c.name, ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  }
  for (const c of ADAPTER_CASES) {
    try {
      await c.run()
      out.push({ name: `[adapter] ${c.name}`, ok: true })
    } catch (e) {
      out.push({
        name: `[adapter] ${c.name}`,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }
  return out
}

declare global {
  // eslint-disable-next-line no-var
  var __conformance: CaseResult[] | undefined
  // eslint-disable-next-line no-var
  var __conformanceDone: boolean | undefined
}

void (async () => {
  // Wiped first: OPFS persists across reloads, so a rerun would otherwise see
  // the previous run's `case-1` already populated and stop testing what it
  // claims to test.
  const opfs = await navigator.storage.getDirectory()
  for await (const name of opfs.keys()) {
    await opfs.removeEntry(name, { recursive: true }).catch(() => {})
  }
  globalThis.__conformance = await runAll()
  globalThis.__conformanceDone = true
  const failed = globalThis.__conformance.filter((r) => !r.ok)
  document.title = failed.length === 0 ? 'conformance: PASS' : `conformance: ${failed.length} FAILED`
})()
