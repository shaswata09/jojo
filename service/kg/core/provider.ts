/**
 * Who is answering — a local server on this machine, or a company's API. L1 core.
 *
 * Until now there was one shape: an OpenAI-compatible server at a URL the user
 * typed. That was the right first answer, because vLLM, Ollama and LM Studio all
 * speak it and a local-first app should reach for the local thing first. It is
 * no longer the only answer, and the two additions do not fit the same mould:
 *
 *   - **Ollama** speaks the OpenAI shape but will not let a client choose its
 *     context window through it. That is not a detail. Its default window is far
 *     below what this app's tool catalog needs, and it TRUNCATES rather than
 *     refusing — so the model silently receives a mutilated tool list and the
 *     person sees a stupid assistant rather than a misconfiguration.
 *   - **Anthropic** does not speak the OpenAI shape at all. Different auth
 *     header, system prompt hoisted out of the message list, a different tool
 *     schema, and tool calls that come back as content blocks rather than as a
 *     `tool_calls` array of JSON strings.
 *
 * So the provider becomes a stored fact rather than something inferred from the
 * URL, and everything that differs between them is looked up here.
 *
 * ## Why the registry is data and not a switch statement
 *
 * Because three separate places need to agree about the same provider: the
 * Settings form (what to ask for), the request builder (where to send it and
 * how to authenticate), and the copy that explains a failure. A switch in each
 * is three places to forget a case. One table, read three times, cannot drift —
 * and `satisfies` makes a new provider a compile error until every field is
 * answered.
 *
 * ## What is deliberately NOT here
 *
 * The network. This layer builds requests and parses responses as data — see
 * `ModelRequest` in `model-server.ts` — because `check-platform` bans the
 * network from core and is right to. Everything below is arithmetic and string
 * work, which is the half that can be wrong in an interesting way.
 */

/** The providers this app knows how to talk to. */
export const PROVIDER_IDS = [
  'openai-compatible',
  'ollama',
  'openai',
  'anthropic',
  'openrouter',
  'groq',
] as const

export type ProviderId = (typeof PROVIDER_IDS)[number]

/**
 * How a provider wants to be spoken to.
 *
 * Three dialects, not six. Most "different" providers are OpenAI's shape with a
 * different hostname and key, which is the whole reason adding OpenRouter or
 * Groq costs a table row rather than an adapter.
 */
export type Dialect =
  /** `POST /chat/completions`, `tools:[{type:'function',…}]`, `choices[0].message`. */
  | 'openai'
  /** `POST /api/chat`, `options.num_ctx`, `message.tool_calls` with OBJECT arguments. */
  | 'ollama'
  /** `POST /v1/messages`, `input_schema`, `content:[{type:'tool_use'}]`. */
  | 'anthropic'

export type ProviderMeta = {
  readonly id: ProviderId
  readonly label: string
  /**
   * Prefilled in the endpoint field, or '' when the user must supply it.
   *
   * Empty for `openai-compatible` on purpose: it is the "something else" entry,
   * and a guess printed in the field where the answer goes is a guess the user
   * has to notice is wrong.
   */
  readonly endpoint: string
  readonly dialect: Dialect
  /** True when the endpoint is fixed and the field should not be offered. */
  readonly fixedEndpoint: boolean
  /** True when a key is required for anything to work. */
  readonly needsKey: boolean
  /** Whether this provider bills the user per token. Drives the warning copy. */
  readonly cloud: boolean
  /**
   * Whether jojo can set the context window in the request.
   *
   * Only the Ollama dialect can: its native endpoint takes `options.num_ctx`.
   * For everyone else the window is a property of the deployment and the number
   * in Settings is used only to WARN before sending, never to instruct.
   */
  readonly canSetContext: boolean
  /** A sensible starting window, and what the preflight check assumes. */
  readonly defaultContext: number
}

/**
 * Every provider, with the facts that differ between them.
 *
 * The order is the order they are offered: local first, because this is a
 * local-first app and the thing that costs nothing and sends nothing should be
 * the path of least resistance.
 */
export const PROVIDERS = [
  {
    id: 'ollama',
    label: 'Ollama',
    endpoint: 'http://localhost:11434',
    dialect: 'ollama',
    fixedEndpoint: false,
    needsKey: false,
    cloud: false,
    // The reason this provider has its own dialect at all.
    canSetContext: true,
    defaultContext: 32768,
  },
  {
    id: 'openai-compatible',
    label: 'A local server (vLLM, LM Studio, llama.cpp)',
    endpoint: '',
    dialect: 'openai',
    fixedEndpoint: false,
    needsKey: false,
    cloud: false,
    defaultContext: 32768,
    canSetContext: false,
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    endpoint: 'https://api.anthropic.com/v1',
    dialect: 'anthropic',
    fixedEndpoint: true,
    needsKey: true,
    cloud: true,
    canSetContext: false,
    defaultContext: 200_000,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    endpoint: 'https://api.openai.com/v1',
    dialect: 'openai',
    fixedEndpoint: true,
    needsKey: true,
    cloud: true,
    canSetContext: false,
    defaultContext: 128_000,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1',
    dialect: 'openai',
    fixedEndpoint: true,
    needsKey: true,
    cloud: true,
    canSetContext: false,
    defaultContext: 128_000,
  },
  {
    id: 'groq',
    label: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1',
    dialect: 'openai',
    fixedEndpoint: true,
    needsKey: true,
    cloud: true,
    canSetContext: false,
    defaultContext: 128_000,
  },
] as const satisfies readonly ProviderMeta[]

const BY_ID = new Map<string, ProviderMeta>(PROVIDERS.map((p) => [p.id, p]))

/**
 * The provider's facts, falling back to the open-ended one.
 *
 * Never throws and never returns undefined. A settings document written by a
 * newer build can name a provider this one has never heard of, and the honest
 * reading of that is "some OpenAI-compatible server" — which is what the
 * fallback is, and which will very often actually work.
 */
export const providerMeta = (id: string): ProviderMeta =>
  BY_ID.get(id) ?? BY_ID.get('openai-compatible')!

/**
 * Everything needed to reach a model, in one object.
 *
 * `apiKey` is optional because the local providers have none, and
 * `contextWindow` is optional because a settings document written before this
 * existed has none. Both are read through helpers below rather than directly,
 * so the absent case is answered in one place.
 */
export type ModelSettings = {
  readonly provider: ProviderId
  readonly endpoint: string
  readonly model: string
  /**
   * The user's key, when the provider needs one.
   *
   * ## Where this must never go
   *
   * Into the graph. Settings live in `localStorage` on web and `AsyncStorage` on
   * mobile, BESIDE the store rather than inside it — see the header of
   * `model-settings-context.ts` — which means a backup export cannot carry a key
   * even by accident: `buildBackup` takes nodes, edges and documents, and a key
   * is none of those. That separation was made for a different reason and this
   * is the second thing it buys.
   *
   * It is also never logged, never put in a journal entry, and never sent
   * anywhere but the provider's own host.
   */
  readonly apiKey?: string
  /** What the user says their deployment can hold. See `contextOf`. */
  readonly contextWindow?: number
}

/** The window to plan against — the user's number, or the provider's default. */
export const contextOf = (settings: ModelSettings): number => {
  const meta = providerMeta(settings.provider)
  const raw = settings.contextWindow
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : meta.defaultContext
}

/**
 * Whether this is enough to attempt a request.
 *
 * A cloud provider with no key is unconfigured rather than broken, and saying so
 * before sending is the difference between "add your key" and a 401 the user has
 * to interpret.
 */
export const isConfigured = (settings: ModelSettings): boolean => {
  const meta = providerMeta(settings.provider)
  if (settings.model.trim().length === 0) return false
  if (!meta.fixedEndpoint && settings.endpoint.trim().length === 0) return false
  if (meta.needsKey && (settings.apiKey ?? '').trim().length === 0) return false
  return true
}

/**
 * The endpoint to actually use.
 *
 * A fixed-endpoint provider ignores whatever is stored, so that switching from
 * a local server to Claude does not carry `http://localhost:11434` across into
 * a request that would then fail for a reason nobody could guess from the
 * screen.
 */
export const endpointOf = (settings: ModelSettings): string => {
  const meta = providerMeta(settings.provider)
  return meta.fixedEndpoint ? meta.endpoint : settings.endpoint
}

/**
 * What a key looks like, roughly, so an obviously wrong paste is caught early.
 *
 * Deliberately weak. This rejects the empty string and whitespace and nothing
 * else of substance: key formats change, and an app that refuses a valid key
 * because its prefix is new is worse than one that lets the provider answer 401.
 * The one real check is the whitespace, because a key copied from a web page
 * often arrives with a newline on the end and the resulting header is rejected
 * with a message about the HEADER rather than about the key.
 */
export const cleanKey = (raw: string): string => raw.trim()
