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

/** Empty rather than a guess: an unconfigured app must read as unconfigured. */
export const DEFAULTS: ModelSettings = {
  /*
   * The open-ended provider, not a named one.
   *
   * An unconfigured app must read as unconfigured — the same reason `endpoint`
   * and `model` are empty rather than guessed. Defaulting to a specific
   * provider would put its name on screen before the person has chosen, and a
   * guess printed where the answer goes is a guess they have to notice is
   * wrong.
   */
  provider: 'openai-compatible',
  endpoint: '',
  model: '',
}

/*
 * The three suggested addresses moved into `core/provider.ts`.
 *
 * They were a label and a port; a provider is a label, a port, a dialect, a
 * key requirement and a context default, and every one of those is needed at
 * the same moment. Keeping a second list of two of the five fields beside the
 * real one is how the two end up disagreeing about which port Ollama uses.
 */

export type ModelSettingsValue = {
  settings: ModelSettings
  /** MarkItDown's MCP address, or '' when nothing is configured. */
  reader: string
  setReader: (endpoint: string) => void
  /** Every server this browser has connected to, most recently added last. */
  servers: readonly ModelServer[]
  save: (next: ModelSettings) => void
  /** Records a server that answered. Called on a successful test, not on typing. */
  remember: (entry: {
    name: string
    endpoint: string
    model: string
    /** Carried so a saved row loads back as the same provider, not a guess. */
    provider?: string
    /** Carried so a saved row loads back usable. Never enters the graph. */
    apiKey?: string
  }) => void
  rename: (id: string, name: string) => void
  forget: (id: string) => void
}

export const ModelSettingsContext = createContext<ModelSettingsValue | null>(null)

export function useModelSettings() {
  const ctx = useContext(ModelSettingsContext)
  if (!ctx) throw new Error('useModelSettings must be used inside <ModelSettingsProvider>')
  return ctx
}
