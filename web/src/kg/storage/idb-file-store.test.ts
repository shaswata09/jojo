/**
 * `idb-file-store` against the shared `FileStore` contract.
 *
 * The third host for `file-store-conformance.ts`, and the cheapest: the memory
 * store runs in Vitest but proves nothing about a real database, and the File
 * System Access adapter needs a browser and a CDP harness. This one runs on
 * `fake-indexeddb` in the ordinary test process, so the adapter that will hold
 * every user's documents is checked on every gate rather than on a good day.
 */

import 'fake-indexeddb/auto'
import { deleteDB, openDB } from 'idb'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  CONFORMANCE_CASES,
  type ConformanceHooks,
} from '@jojo/service/storage/file-store-conformance'
import type { FileStore } from '@jojo/service/storage/file-store'
import { createIdbFileStore, isBlockedFailure, type IdbFileStore } from './idb-file-store'

const enc = new TextEncoder()

/** A fresh database per case, so `trash` leftovers cannot leak between them. */
let seq = 0

/**
 * Monotonic and synthetic rather than a clock read.
 *
 * `check-platform.mjs` bans wall-clock reads in this layer, and a test asserting
 * on mtime needs predictable values anyway — `memory-file-store` mints its own
 * for the same two reasons.
 */
function tickingClock() {
  let tick = 1_000
  return () => (tick += 1)
}

async function freshStore(): Promise<IdbFileStore> {
  const dbName = `jojo-files-test-${++seq}`
  await deleteDB(dbName)
  const store = createIdbFileStore({ now: tickingClock(), dbName })
  // `connected()` is synchronous on the port, so it cannot open the database
  // itself. The suite expects an already-connected store.
  const opened = await store.open()
  expect(opened.ok, 'the store failed to open').toBe(true)
  await store.write(
    'jojo/folder.json',
    enc.encode(
      JSON.stringify({
        vaultId: `vault-idb-${seq}`,
        createdAt: '2026-01-01T00:00:00.000Z',
        appVersion: 'test',
      }),
    ),
  )
  return store
}

const hooks: ConformanceHooks = {
  create: () => freshStore(),
  // "Behind the store's back" is a user in Finder for a folder adapter. There is
  // no behind here — the store IS the storage — so the hooks go through the same
  // methods. That is a genuine difference in what these cases can prove for this
  // adapter, and pretending otherwise would be worse than saying it.
  place: async (store, path, data) => {
    await (store as FileStore).write(path, data)
  },
  remove: async (store, path) => {
    await (store as FileStore).trash(path)
  },
}

describe('idb-file-store — FileStore conformance', () => {
  // One `it` per case, so a failure names the contract clause it broke rather
  // than reporting "conformance failed" and leaving you to read the output.
  for (const c of CONFORMANCE_CASES) {
    it(c.name, async () => {
      await c.run(await hooks.create(), hooks)
    })
  }
})

describe('idb-file-store — what only this adapter has to answer for', () => {
  beforeEach(() => {
    seq += 100
  })

  it('survives a reopen, because the whole point is that bytes outlive the tab', async () => {
    const dbName = `jojo-files-reopen-${++seq}`
    await deleteDB(dbName)

    const first = createIdbFileStore({ now: tickingClock(), dbName })
    await first.open()
    await first.write('Documents/CV.pdf', enc.encode('original'))

    // A second store over the same database is what a reload is.
    const second = createIdbFileStore({ now: tickingClock(), dbName })
    await second.open()
    const back = await second.read('Documents/CV.pdf')
    expect(back.ok).toBe(true)
    if (back.ok) expect(new TextDecoder().decode(back.value)).toBe('original')
  })

  it('keeps binary bytes exactly, including the ones that break a string round-trip', async () => {
    const store = await freshStore()
    // 0x00 terminates a C string, 0xFF and 0xFE are UTF-16 byte-order marks, and
    // 0xED leads a surrogate in UTF-8. A store that decodes anywhere mangles at
    // least one of them, and a PDF contains all four.
    const bytes = new Uint8Array([0x00, 0xff, 0xfe, 0xed, 0x25, 0x50, 0x44, 0x46])
    await store.write('Documents/CV.pdf', bytes)
    const back = await store.read('Documents/CV.pdf')
    expect(back.ok).toBe(true)
    if (back.ok) expect([...back.value]).toEqual([...bytes])
  })

  it('a five-megabyte document round-trips, which is larger than any real CV', async () => {
    const store = await freshStore()
    const big = new Uint8Array(5 * 1024 * 1024)
    for (let i = 0; i < big.length; i += 1) big[i] = (i * 31 + 7) & 0xff
    const written = await store.write('Documents/big.pdf', big)
    expect(written.ok).toBe(true)
    if (written.ok) expect(written.value.bytes).toBe(big.length)

    const back = await store.read('Documents/big.pdf')
    expect(back.ok).toBe(true)
    if (back.ok) {
      expect(back.value.length).toBe(big.length)
      // Sampled rather than compared whole: a byte-by-byte assert on 5 MB is
      // slow enough to matter on every gate and proves nothing more.
      for (let i = 0; i < big.length; i += 9973) expect(back.value[i]).toBe(big[i])
    }
  })

  it('forget() really destroys, because here there is no folder left holding the bytes', async () => {
    const store = await freshStore()
    await store.write('Documents/CV.pdf', enc.encode('gone soon'))
    await store.forget()

    // The other two adapters keep the user's folder and drop only the binding.
    // This one IS the storage, so the same method means something much stronger,
    // and a caller offering it to a person has to say so.
    expect(store.connected()).toBe(false)
    const after = await store.read('Documents/CV.pdf')
    expect(after.ok).toBe(false)
  })

  it('a trashed document can be read back and rewritten, which is what Undo does', async () => {
    // `useVaultBlobs.restore` is a hook and D20 rules out mounting it, so what is
    // pinned here is the sequence it performs. Undo is expressible only in read,
    // write and trash — the port has no rename — and if trash did not keep the
    // full relative path under `jojo/Trash`, the read below would miss.
    const store = await freshStore()
    const path = 'Documents/file_x__CV.pdf'
    await store.write(path, enc.encode('%PDF-1.7 tailored'))

    await store.trash(path)
    const gone = await store.exists(path)
    expect(gone.ok).toBe(true)
    if (gone.ok) expect(gone.value).toBe(false)

    const fromTrash = await store.read(`jojo/Trash/${path}`)
    expect(fromTrash.ok, 'trash did not keep the full relative path').toBe(true)
    if (!fromTrash.ok) return

    const back = await store.write(path, fromTrash.value)
    expect(back.ok).toBe(true)
    const reread = await store.read(path)
    expect(reread.ok).toBe(true)
    if (reread.ok) expect(new TextDecoder().decode(reread.value)).toBe('%PDF-1.7 tailored')
  })

  it('purgeTrash reclaims deleted documents, which trash alone never does', async () => {
    const store = await freshStore()
    await store.write('Documents/a.pdf', enc.encode('one'))
    await store.write('Documents/b.pdf', enc.encode('two'))
    await store.trash('Documents/a.pdf')

    // Still there, still costing quota — that is the whole defect.
    const inTrash = await store.read('jojo/Trash/Documents/a.pdf')
    expect(inTrash.ok, 'trash should keep it until swept').toBe(true)

    const freed = await store.purgeTrash()
    expect(freed).toBe(1)
    expect((await store.read('jojo/Trash/Documents/a.pdf')).ok).toBe(false)

    // And it takes nothing else with it.
    const survivor = await store.read('Documents/b.pdf')
    expect(survivor.ok, 'purge must only touch jojo/Trash').toBe(true)
    if (survivor.ok) expect(new TextDecoder().decode(survivor.value)).toBe('two')
  })

  it('listTrash says when each copy was trashed and from where, and stamps one that predates that', async () => {
    const store = await freshStore()
    await store.write('Documents/f1__CV (2).pdf', enc.encode('two'))
    await store.trash('Documents/f1__CV (2).pdf')
    // A copy an older build trashed: written straight under the trash, so its
    // `meta` has neither field.
    await store.write('jojo/Trash/Documents/old__cv.pdf', enc.encode('old'))

    const first = await store.listTrash('jojo/Trash/Documents')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const byPath = new Map(first.value.map((e) => [e.path, e]))
    const fresh = byPath.get('jojo/Trash/Documents/f1__CV (2).pdf')
    // The exact name, which the key alone cannot give back.
    expect(fresh?.from).toBe('Documents/f1__CV (2).pdf')
    const old = byPath.get('jojo/Trash/Documents/old__cv.pdf')
    expect(old?.from).toBeUndefined()
    expect(typeof old?.trashedAt).toBe('number')

    // The stamp is kept: listing again does not restart the window.
    const second = await store.listTrash('jojo/Trash/Documents')
    expect(second.ok && second.value.find((e) => e.path === old?.path)?.trashedAt).toBe(
      old?.trashedAt,
    )
    expect((await store.listTrash('Documents')).ok).toBe(false)
  })

  it('purgeTrash on an empty trash is a no-op, not an error', async () => {
    const store = await freshStore()
    await store.write('Documents/a.pdf', enc.encode('one'))
    expect(await store.purgeTrash()).toBe(0)
    expect((await store.read('Documents/a.pdf')).ok).toBe(true)
  })

  it('url() hands back something a viewer can point at', async () => {
    const store = await freshStore()
    await store.write('Documents/CV.pdf', enc.encode('%PDF-1.7'))
    const url = await store.url('Documents/CV.pdf')
    expect(url.ok).toBe(true)
    if (url.ok) expect(url.value.startsWith('blob:')).toBe(true)
  })
})

describe('idb-file-store — what list and open cost', () => {
  /*
   * R33. `list` read every document in full to report its size and mtime, so
   * forty 1 MB documents were 40 MB read on every page load. Counted here at
   * the IndexedDB boundary: how many records come out of `blobs` during a list.
   */
  it('lists without reading a single document', async () => {
    const store = await freshStore()
    for (let i = 0; i < 5; i += 1)
      await store.write(`Documents/${String(i)}.pdf`, new Uint8Array(1000 + i))
    const proto = IDBObjectStore.prototype
    const realGet = proto.get
    let blobReads = 0
    proto.get = function (this: IDBObjectStore, key: IDBValidKey | IDBKeyRange) {
      if (this.name === 'blobs') blobReads += 1
      return realGet.call(this, key)
    }
    try {
      const listed = await store.list('Documents')
      expect(listed.ok).toBe(true)
      if (listed.ok) {
        expect(listed.value.map((e) => e.bytes).sort()).toEqual([1000, 1001, 1002, 1003, 1004])
        expect(listed.value.every((e) => e.mtime > 1_000)).toBe(true)
      }
    } finally {
      proto.get = realGet
    }
    expect(blobReads).toBe(0)
  })

  it('carries a version-1 database over, sizes and times intact', async () => {
    const dbName = `jojo-files-v1-${++seq}`
    await deleteDB(dbName)
    // The shape version 1 wrote: one store, `{ data, mtime }` per key.
    const old = await openDB(dbName, 1, {
      upgrade(fresh) {
        fresh.createObjectStore('blobs')
      },
    })
    await old.put('blobs', { data: new Uint8Array(42), mtime: 7 }, 'Documents/old.pdf')
    old.close()

    const store = createIdbFileStore({ now: tickingClock(), dbName })
    expect((await store.open()).ok).toBe(true)
    const listed = await store.list('Documents')
    expect(listed.ok && listed.value).toEqual([{ path: 'Documents/old.pdf', bytes: 42, mtime: 7 }])
    const read = await store.read('Documents/old.pdf')
    expect(read.ok && read.value.length).toBe(42)
  })

  it('opens one connection for concurrent first calls', async () => {
    const dbName = `jojo-files-once-${++seq}`
    await deleteDB(dbName)
    const realOpen = indexedDB.open.bind(indexedDB)
    let opens = 0
    indexedDB.open = (name: string, version?: number) => {
      if (name === dbName) opens += 1
      return realOpen(name, version)
    }
    try {
      const store = createIdbFileStore({ now: tickingClock(), dbName })
      await Promise.all([store.exists('a'), store.exists('b'), store.list(''), store.stat('c')])
    } finally {
      indexedDB.open = realOpen
    }
    expect(opens).toBe(1)
  })

  it('lets go when another tab upgrades, and reopens on the next call', async () => {
    const dbName = `jojo-files-blocking-${++seq}`
    await deleteDB(dbName)
    const store = createIdbFileStore({ now: tickingClock(), dbName })
    await store.write('Documents/CV.pdf', enc.encode('kept'))
    // A newer build in another tab. Without `blocking` handling this open
    // would wait forever on the connection the store above is holding.
    const newer = await openDB(dbName, 3)
    newer.close()
    // The store's next call reopens — and meets version 3, which it cannot
    // open at version 2. A failure, not a hang.
    const after = await Promise.race([
      store.exists('Documents/CV.pdf'),
      new Promise<'hung'>((resolve) =>
        setTimeout(() => {
          resolve('hung')
        }, 2_000),
      ),
    ])
    expect(after).not.toBe('hung')
  })

  /*
   * R3 platform finding: a tab still running a build from before version 2
   * holds the database at version 1 and has no `versionchange` handler, so the
   * upgrade here was blocked until that tab closed — `list` and `open` pending
   * with nothing on screen. Now the store waits out its grace, answers
   * `files/failed` marked as blocked, and recovers on its own once that tab
   * lets go, without opening a second connection.
   */
  it('a pre-v2 tab holding the database blocks for the grace, then fails, then recovers', async () => {
    const dbName = `jojo-files-blocked-${++seq}`
    await deleteDB(dbName)
    // The old tab: version 1, and no `versionchange` handler, exactly as it shipped.
    const oldTab = await openDB(dbName, 1, {
      upgrade(fresh) {
        fresh.createObjectStore('blobs')
      },
    })
    await oldTab.put('blobs', { data: new Uint8Array(5), mtime: 9 }, 'Documents/cv.pdf')

    const realOpen = indexedDB.open.bind(indexedDB)
    let opens = 0
    indexedDB.open = (name: string, version?: number) => {
      if (name === dbName) opens += 1
      return realOpen(name, version)
    }
    try {
      const store = createIdbFileStore({ now: tickingClock(), dbName, blockedGraceMs: 300 })
      const first = await Promise.race([
        store.list('Documents'),
        new Promise<'hung'>((resolve) =>
          setTimeout(() => {
            resolve('hung')
          }, 2_000),
        ),
      ])
      expect(first).not.toBe('hung')
      expect(first !== 'hung' && !first.ok && first.error.code).toBe('files/failed')
      expect(first !== 'hung' && !first.ok && isBlockedFailure(first.error)).toBe(true)
      // Still blocked: answered at once, not after another grace.
      const again = await Promise.race([
        store.open(),
        new Promise<'waited'>((resolve) =>
          setTimeout(() => {
            resolve('waited')
          }, 100),
        ),
      ])
      expect(again !== 'waited' && !again.ok && isBlockedFailure(again.error)).toBe(true)

      // The old tab closes. The pending open lands, and the data written under
      // version 1 reads back through the store.
      oldTab.close()
      let listed = await store.list('Documents')
      for (let i = 0; i < 20 && !listed.ok; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10))
        listed = await store.list('Documents')
      }
      expect(listed.ok && listed.value).toEqual([{ path: 'Documents/cv.pdf', bytes: 5, mtime: 9 }])
    } finally {
      indexedDB.open = realOpen
    }
    expect(opens).toBe(1)
  })
})
