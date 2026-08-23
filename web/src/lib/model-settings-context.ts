import { createContext, useContext } from 'react'
import type { ModelServer } from '@jojo/service/core/model-server'
import type { ModelSettings } from '@/lib/llm'

/**
 * Where the model's address lives.
 *
 * Deliberately NOT in the graph. Everything in `@jojo/service` is a record —
 * something the user authored, that belongs to them, that Transfer would carry
 * to another machine. An endpoint is none of those: it describes *this
 * browser's* network, and carrying `http://localhost:8000/v1` to a different
 * machine would move a setting that is wrong there by definition. So it sits in
 * localStorage beside the graph rather than inside it, and the journal never
 * sees it.
 *
 * The saved list is the same argument at one remove. It is a list of addresses
 * on this network, which is exactly as machine-specific as the single address
 * was, so it gets its own key rather than becoming a record type. What IS shared
 * is the rules for the list — add, rename, remove, and the fact that it is keyed
 * by URL — because those are the parts that can be wrong, and
 * `kg/core/model-server` holds them for both apps.
 */

export const STORAGE_KEY = 'jojo/model-settings/v1'

/** Its own key, so the saved list survives a change to the settings document. */
export const SERVERS_KEY = 'jojo/model-servers/v1'

/** Empty rather than a guess: an unconfigured app must read as unconfigured. */
export const DEFAULTS: ModelSettings = { endpoint: '', model: '' }

/**
 * The three servers worth offering by name, with the port each ships with.
 *
 * The port is the whole value of this list. Everyone who runs a local model
 * knows what they are running; nobody remembers whether Ollama is 11434 or
 * 11343. No model is suggested alongside it — the server is asked for that now,
 * and a guess printed in the field where the answer goes is a guess the user has
 * to notice is wrong.
 */
export const SUGGESTIONS: readonly { label: string; endpoint: string }[] = [
  { label: 'vLLM', endpoint: 'http://localhost:8000/v1' },
  { label: 'Ollama', endpoint: 'http://localhost:11434/v1' },
  { label: 'LM Studio', endpoint: 'http://localhost:1234/v1' },
]

export type ModelSettingsValue = {
  settings: ModelSettings
  /** Every server this browser has connected to, most recently added last. */
  servers: readonly ModelServer[]
  save: (next: ModelSettings) => void
  /** Records a server that answered. Called on a successful test, not on typing. */
  remember: (entry: { name: string; endpoint: string; model: string }) => void
  rename: (id: string, name: string) => void
  forget: (id: string) => void
}

export const ModelSettingsContext = createContext<ModelSettingsValue | null>(null)

export function useModelSettings() {
  const ctx = useContext(ModelSettingsContext)
  if (!ctx) throw new Error('useModelSettings must be used inside <ModelSettingsProvider>')
  return ctx
}
