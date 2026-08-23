import { createContext, useContext } from 'react'
import type { ModelServer } from '@jojo/service/core/model-server'
import type { ModelSettings } from '@/lib/llm'

/**
 * Where the model's address lives.
 *
 * Deliberately NOT in the graph. Everything in `@jojo/service` is a record — something
 * the user authored, that belongs to them, that Transfer would carry to another
 * phone. An endpoint is none of those: it describes *this device's* network,
 * and carrying `http://localhost:8000/v1` to a different phone would move a
 * setting that is wrong there by definition. So it sits in AsyncStorage beside
 * the graph rather than inside it, and the journal never sees it.
 *
 * The saved list is the same argument at one remove. It is a list of addresses
 * on this network, which is exactly as device-specific as the single address
 * was, so it sits beside the graph under its own key rather than becoming a
 * record type. What IS shared is the rules for the list — add, rename, remove,
 * and the fact that it is keyed by URL — because those are the parts that can be
 * wrong, and `kg/core/model-server` holds them for both apps.
 *
 * That also keeps the shared layer honest. `@jojo/service` is the one copy both
 * apps import and it has no concept of a model endpoint; adding one to
 * `ProfileProps` to save writing this file would be a change to the web app's
 * model, made for the convenience of one screen on one platform.
 */

const KEY_DOC = 'jojo/model-settings/v1'

/** Empty rather than a guess: an unconfigured app must read as unconfigured. */
export const DEFAULTS: ModelSettings = { endpoint: '', model: '' }

export const STORAGE_KEY = KEY_DOC

/**
 * Where MarkItDown is, if the user runs it.
 *
 * Its own key, and its own setting, because it is a different program: the model
 * answers questions and the reader opens documents, and a person may well have
 * one without the other. Storing them together would mean a build that could not
 * parse one lost both.
 */
export const READER_KEY = 'jojo/document-reader/v1'

/** Its own key, so the saved list survives a change to the settings document. */
export const SERVERS_KEY = 'jojo/model-servers/v1'

/**
 * The three servers worth offering by name, with the port each ships with.
 *
 * The port is the whole value of this list. Everyone who runs a local model
 * knows what they are running; nobody remembers whether Ollama is 11434 or
 * 11343. No model is suggested alongside it any more — the server is asked for
 * that now, and a guess printed in the field where the answer goes is a guess
 * the user has to notice is wrong.
 */
export const SUGGESTIONS: readonly { label: string; endpoint: string }[] = [
  { label: 'vLLM', endpoint: 'http://localhost:8000/v1' },
  { label: 'Ollama', endpoint: 'http://localhost:11434/v1' },
  { label: 'LM Studio', endpoint: 'http://localhost:1234/v1' },
]

export type ModelSettingsValue = {
  settings: ModelSettings
  /** MarkItDown's MCP address, or '' when nothing is configured. */
  reader: string
  setReader: (endpoint: string) => void
  /** Every server this device has connected to, most recently added last. */
  servers: readonly ModelServer[]
  /** False until the stored value has been read, so nothing reads "not connected" early. */
  ready: boolean
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
