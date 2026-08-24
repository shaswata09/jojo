import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { removeServer, renameServer, saveServer } from '@jojo/service/core/model-server'
import type { ModelServer } from '@jojo/service/core/model-server'
import type { ModelSettings } from '@/lib/llm'
import {
  DEFAULTS,
  ModelSettingsContext,
  READER_KEY,
  SERVERS_KEY,
  STORAGE_KEY,
} from '@/lib/model-settings-context'

/**
 * Reads the model's address and the saved list off the device, and writes back.
 *
 * The context, the hook and the constants live in `model-settings-context.ts`,
 * the split every other provider in this app makes: a module exporting both a
 * provider and a hook loses Fast Refresh for everything importing it, which
 * `npm run lint` enforces.
 *
 * Two keys rather than one document. The current endpoint changes whenever the
 * user types; the saved list changes only when a server answers. Splitting them
 * means the common write is small, and — the reason that matters — a settings
 * document this build cannot parse cannot take the saved list down with it.
 */
export function ModelSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ModelSettings>(DEFAULTS)
  const [servers, setServers] = useState<readonly ModelServer[]>([])
  const [reader, setReaderState] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let live = true
    void AsyncStorage.multiGet([STORAGE_KEY, SERVERS_KEY, READER_KEY])
      .then((entries) => {
        if (!live) return
        const stored = new Map(entries)
        setReaderState(stored.get(READER_KEY) ?? '')
        const rawSettings = stored.get(STORAGE_KEY)
        if (rawSettings) {
          try {
            setSettings({ ...DEFAULTS, ...(JSON.parse(rawSettings) as Partial<ModelSettings>) })
          } catch {
            // A corrupt settings blob is not worth a banner: the defaults are
            // empty, which reads as "not connected", which is the truth.
          }
        }
        const rawServers = stored.get(SERVERS_KEY)
        if (rawServers) {
          try {
            const parsed: unknown = JSON.parse(rawServers)
            // Filtered rather than cast. This list is drawn as rows with a
            // delete button; one entry with a missing `id` would render a row
            // whose delete removes nothing and whose key collides with the next
            // broken one.
            if (Array.isArray(parsed)) setServers(parsed.filter(isServer))
          } catch {
            // Same reasoning: an unreadable list reads as an empty one.
          }
        }
        setReady(true)
      })
      .catch(() => {
        if (live) setReady(true)
      })
    return () => {
      live = false
    }
  }, [])

  const setReader = useCallback((endpoint: string) => {
    setReaderState(endpoint)
    void AsyncStorage.setItem(READER_KEY, endpoint)
  }, [])

  const save = useCallback((next: ModelSettings) => {
    setSettings(next)
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }, [])

  /**
   * Applies a change to the list and writes the result.
   *
   * Takes the updater rather than the new list so the write always persists the
   * value React just committed. Computing the next list at the call site and
   * passing it to both `setServers` and `setItem` is the same thing until two
   * changes land in one tick, at which point the second reads a stale `servers`
   * and the disk keeps whichever finished last.
   */
  const write = useCallback((change: (list: readonly ModelServer[]) => ModelServer[]) => {
    setServers((list) => {
      const next = change(list)
      void AsyncStorage.setItem(SERVERS_KEY, JSON.stringify(next))
      return next
    })
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
    () => ({ settings, servers, reader, ready, save, setReader, remember, rename, forget }),
    [settings, servers, reader, ready, save, setReader, remember, rename, forget],
  )
  return <ModelSettingsContext.Provider value={value}>{children}</ModelSettingsContext.Provider>
}

const isServer = (v: unknown): v is ModelServer =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as ModelServer).id === 'string' &&
  typeof (v as ModelServer).name === 'string' &&
  typeof (v as ModelServer).endpoint === 'string' &&
  typeof (v as ModelServer).model === 'string'
