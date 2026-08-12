import { createContext, useContext } from 'react'
import type { ModelSettings } from '@/lib/llm'

/**
 * Where the model's address lives.
 *
 * Deliberately NOT in the graph. Everything in `src/kg` is a record — something
 * the user authored, that belongs to them, that Transfer would carry to another
 * phone. An endpoint is none of those: it describes *this device's* network,
 * and carrying `http://localhost:8000/v1` to a different phone would move a
 * setting that is wrong there by definition. So it sits in AsyncStorage beside
 * the graph rather than inside it, and the journal never sees it.
 *
 * That also keeps the ported layer honest. `src/kg` came from the web app and
 * has no concept of a model endpoint; adding one to `ProfileProps` to save
 * writing this file would have been the first edit to a copied module, made for
 * the convenience of a screen.
 */

const KEY_DOC = 'jojo/model-settings/v1'

/** Empty rather than a guess: an unconfigured app must read as unconfigured. */
export const DEFAULTS: ModelSettings = { endpoint: '', model: '' }

export const STORAGE_KEY = KEY_DOC

export const SUGGESTIONS: readonly { label: string; endpoint: string; model: string }[] = [
  { label: 'Ollama', endpoint: 'http://localhost:11434/v1', model: 'llama3.1:8b' },
  { label: 'LM Studio', endpoint: 'http://localhost:1234/v1', model: 'local-model' },
  { label: 'vLLM', endpoint: 'http://localhost:8000/v1', model: 'llama-3.1-8b-instruct' },
]

export type ModelSettingsValue = {
  settings: ModelSettings
  /** False until the stored value has been read, so nothing reads "not connected" early. */
  ready: boolean
  save: (next: ModelSettings) => void
}

export const ModelSettingsContext = createContext<ModelSettingsValue | null>(null)

export function useModelSettings() {
  const ctx = useContext(ModelSettingsContext)
  if (!ctx) throw new Error('useModelSettings must be used inside <ModelSettingsProvider>')
  return ctx
}
