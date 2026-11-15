import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearSiteData } from './storage'
import dataPanelSource from '@/components/settings/DataPanel.tsx?raw'

/**
 * Q064: Settings can clear everything the site keeps in the browser — the
 * IndexedDB databases, local and session storage, caches and cookies — and only
 * after the person confirms.
 *
 * `clearSiteData` is exercised against stubbed browser globals (no jsdom, D20);
 * the button and its confirmation are JSX, so they are pinned as source.
 */

function memoryStorage(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries))
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  }
}

function stubBrowser() {
  const local = memoryStorage({ 'jojo.theme': 'dark', 'jojo.lastBackupAt': '2026-11-01' })
  const session = memoryStorage({ 'jojo.tab': 'x' })
  const databases = new Set(['jojo-kg', 'jojo-files'])
  const deleted: string[] = []
  const cacheNames = new Set(['workbox-precache'])
  let jar = 'a=1; b=2'

  vi.stubGlobal('window', { localStorage: local, sessionStorage: session })
  vi.stubGlobal('indexedDB', {
    databases: async () => [...databases].map((name) => ({ name, version: 1 })),
    deleteDatabase: (name: string) => {
      const request: { onsuccess?: () => void } = {}
      setTimeout(() => {
        databases.delete(name)
        deleted.push(name)
        request.onsuccess?.()
      }, 0)
      return request
    },
  })
  vi.stubGlobal('caches', {
    keys: async () => [...cacheNames],
    delete: async (key: string) => cacheNames.delete(key),
  })
  vi.stubGlobal('document', {
    get cookie() {
      return jar
    },
    set cookie(value: string) {
      const name = value.split('=')[0]
      if (value.includes('expires=Thu, 01 Jan 1970')) {
        jar = jar
          .split(';')
          .map((c) => c.trim())
          .filter((c) => c && c.split('=')[0] !== name)
          .join('; ')
      }
    },
  })

  return { local, session, databases, deleted, cacheNames, jar: () => jar }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('clearing browser storage (Q064)', () => {
  it('empties local and session storage, every database, the caches and the cookies', async () => {
    const browser = stubBrowser()
    const report = await clearSiteData()

    expect(browser.local.length).toBe(0)
    expect(browser.session.length).toBe(0)
    expect([...browser.databases]).toEqual([])
    expect(browser.deleted.sort()).toEqual(['jojo-files', 'jojo-kg'])
    expect([...browser.cacheNames]).toEqual([])
    expect(browser.jar()).toBe('')

    expect(report).toMatchObject({
      localStorage: 2,
      sessionStorage: 1,
      indexedDB: 2,
      caches: 1,
      cookies: 2,
      indexedDBUnknown: false,
    })
  })

  it('still clears the rest when one store refuses', async () => {
    const browser = stubBrowser()
    vi.stubGlobal('window', {
      get localStorage(): never {
        throw new DOMException('blocked', 'SecurityError')
      },
      sessionStorage: browser.session,
    })
    const report = await clearSiteData()
    expect(report.localStorage).toBe(0)
    expect(browser.session.length).toBe(0)
    expect([...browser.databases]).toEqual([])
  })
})

describe('the Settings control (Q064)', () => {
  const code = dataPanelSource.replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')

  it('asks first: the button only stages the clear', () => {
    const row = code.slice(code.indexOf('label="Clear browser storage"'))
    expect(row).toMatch(/onClick=\{\(\) => setPending\('storage'\)\}/)
    expect(row.slice(0, row.indexOf('</Button>'))).not.toContain('onClearStorage')
  })

  it('clears only from the confirmation dialog', () => {
    expect(code).toMatch(/<ConfirmDialog\s+open=\{pending !== null\}[\s\S]*?onConfirm=\{applyPending\}/)
    const apply = code.slice(code.indexOf('const applyPending = () => {'))
    expect(apply).toMatch(/if \(pending === 'storage'\) \{\s*void onClearStorage\(\)/)
    // The only caller of the wipe is that branch.
    expect(code.match(/onClearStorage\(\)/g)).toHaveLength(1)
  })

  it('wipes through clearSiteData, after closing the store', () => {
    const clear = code.slice(code.indexOf('const onClearStorage = async () => {'))
    const closed = clear.indexOf('closeStore()')
    const wiped = clear.indexOf('await clearSiteData()')
    expect(closed).toBeGreaterThan(-1)
    expect(wiped).toBeGreaterThan(closed)
  })
})
