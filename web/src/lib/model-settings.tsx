import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { removeServer, renameServer, saveServer } from '@jojo/service/core/model-server'
import type { ModelServer } from '@jojo/service/core/model-server'
import { isRetiredServer, withoutRetired } from '@jojo/service/core/provider'
import type { ModelSettings } from '@/lib/llm'
import {
  DEFAULTS,
  ModelSettingsContext,
  READER_KEY,
  SERVERS_KEY,
  STORAGE_KEY,
} from '@/lib/model-settings-context'
import { readStored, writeStored } from '@/lib/storage'

/**
 * Reads the model's address and the saved list out of localStorage, and writes
 * back on change.
 *
 * The context, the hook and the constants live in `model-settings-context.ts`,
 * the split every other provider in this app makes: a module exporting both a
 * provider and a hook loses Fast Refresh for everything importing it, which
 * `npm run lint` enforces.
 *
 * Read synchronously in the initialiser rather than in an effect, which is the
 * one real difference from the phone's copy of this file. `localStorage` is
 * synchronous, so there is no moment where the app is mounted and does not yet
 * know whether a model is connected — and therefore no `ready` flag, and no
 * first paint that says "not connected" to a user who is. AsyncStorage cannot
 * offer that, which is why the phone has both.
 *
 * Every access goes through `lib/storage`, because `localStorage` is a getter
 * that THROWS rather than returning null when a browser blocks storage. An
 * unguarded read here would take Settings down in Safari private mode.
 *
 * Two keys rather than one document. The current endpoint changes whenever the
 * user types; the saved list changes only when a server answers. Splitting them
 * means the common write is small, and — the reason that matters — a settings
 * document this build cannot parse cannot take the saved list down with it.
 */
export function ModelSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ModelSettings>(readSettings)
  const [servers, setServers] = useState<readonly ModelServer[]>(readServers)
  const [reader, setReaderState] = useState<string>(() => readStored(READER_KEY) ?? '')

  const setReader = useCallback((endpoint: string) => {
    setReaderState(endpoint)
    writeStored(READER_KEY, endpoint)
  }, [])

  const save = useCallback((next: ModelSettings) => {
    setSettings(next)
    writeStored(STORAGE_KEY, JSON.stringify(next))
  }, [])

  /**
   * Applies a change to the list and writes the result.
   *
   * Takes the updater rather than the new list so the write always persists the
   * value React just committed. Computing the next list at the call site and
   * passing it to both `setServers` and `writeStored` is the same thing until
   * two changes land in one render, at which point the second reads a stale
   * `servers` and storage keeps whichever finished last.
   */
  const write = useCallback((change: (list: readonly ModelServer[]) => ModelServer[]) => {
    /*
     * From storage, not from React's copy of it. Another tab may have written
     * since this one mounted, and the list here is whole-list-replaced: with
     * two tabs open, forgetting a server in A and then renaming one in B wrote
     * B's stale list back — the forgotten server, API key and all, returned.
     * Storage is the one list both tabs share; reading it at the moment of the
     * write applies this change to the latest of it. The updater form stays for
     * the reason above: two changes in one render each read what the last wrote.
     */
    setServers((list) => {
      // Nothing stored is either a browser that blocks storage — where this
      // tab's copy is the only list there is — or a list never written.
      const next = change(readStored(SERVERS_KEY) === null ? list : readServers())
      writeStored(SERVERS_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  /*
   * Another tab's change, taken in. The `storage` event reaches every other tab
   * of this origin, never the one that wrote; `key === null` is a cleared
   * storage. Without this a tab went on showing — and offering to load — a
   * server another tab had forgotten, and kept an endpoint or reader that had
   * since changed.
   */
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      const all = event.key === null
      if (all || event.key === SERVERS_KEY) setServers(readServers())
      if (all || event.key === STORAGE_KEY) setSettings(readSettings())
      if (all || event.key === READER_KEY) setReaderState(readStored(READER_KEY) ?? '')
    }
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const remember = useCallback(
    (entry: { name: string; endpoint: string; model: string }) => {
      write((list) => saveServer(list, entry))
    },
    [write],
  )

  const rename = useCallback(
    (id: string, name: string) => {
      write((list) => renameServer(list, id, name))
    },
    [write],
  )

  const forget = useCallback(
    (id: string) => {
      write((list) => removeServer(list, id))
    },
    [write],
  )

  const value = useMemo(
    () => ({ settings, servers, reader, save, setReader, remember, rename, forget }),
    [settings, servers, reader, save, setReader, remember, rename, forget],
  )
  return <ModelSettingsContext.Provider value={value}>{children}</ModelSettingsContext.Provider>
}

function readSettings(): ModelSettings {
  const raw = readStored(STORAGE_KEY)
  if (!raw) return DEFAULTS
  try {
    const stored = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ModelSettings>) }
    const kept = withoutRetired(stored, DEFAULTS)
    // A retired provider (NVIDIA, Q345) is cleared from storage too, key and
    // all, rather than left behind under a setting nothing reads.
    if (kept !== stored) writeStored(STORAGE_KEY, JSON.stringify(DEFAULTS))
    return kept
  } catch {
    // A corrupt settings blob is not worth a banner: the defaults are empty,
    // which reads as "not connected", which is the truth.
    return DEFAULTS
  }
}

function readServers(): readonly ModelServer[] {
  const raw = readStored(SERVERS_KEY)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    // Filtered rather than cast. This list is drawn as rows with a delete
    // button; one entry with a missing `id` would render a row whose delete
    // removes nothing and whose key collides with the next broken one.
    return Array.isArray(parsed) ? parsed.filter(isServer) : []
  } catch {
    return []
  }
}

const isServer = (v: unknown): v is ModelServer =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as ModelServer).id === 'string' &&
  typeof (v as ModelServer).name === 'string' &&
  typeof (v as ModelServer).endpoint === 'string' &&
  typeof (v as ModelServer).model === 'string' &&
  // A row for a retired provider is dropped here, and so from storage on the
  // list's next write (Q345).
  !isRetiredServer(v as ModelServer)
