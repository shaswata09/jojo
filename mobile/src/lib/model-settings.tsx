import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { ModelSettings } from '@/lib/llm'
import { DEFAULTS, ModelSettingsContext, STORAGE_KEY } from '@/lib/model-settings-context'

/**
 * Reads the model's address off the device once, and writes it back on change.
 *
 * The context, the hook and the constants live in `model-settings-context.ts`,
 * the split every other provider in this app makes: a module exporting both a
 * provider and a hook loses Fast Refresh for everything importing it, which
 * `npm run lint` enforces.
 */
export function ModelSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ModelSettings>(DEFAULTS)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let live = true
    void AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!live) return
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as Partial<ModelSettings>
            setSettings({ ...DEFAULTS, ...parsed })
          } catch {
            // A corrupt settings blob is not worth a banner: the defaults are
            // empty, which reads as "not connected", which is the truth.
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

  const save = useCallback((next: ModelSettings) => {
    setSettings(next)
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }, [])

  const value = useMemo(() => ({ settings, ready, save }), [settings, ready, save])
  return <ModelSettingsContext.Provider value={value}>{children}</ModelSettingsContext.Provider>
}
