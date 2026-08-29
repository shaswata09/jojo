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
  'nvidia',
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
  /**
   * Whether the request leaves this machine.
   *
   * The privacy fact, and the one that matters in a local-first app. It used to
   * carry a second claim as well — the warning copy read "and is billed to your
   * account" — which was true of every cloud provider here until NVIDIA, whose
   * free tier bills nothing and rate-limits instead. Telling someone they are
   * being charged for something that is free is not a small inaccuracy on the
   * screen where they decide whether to use it, so the two facts are separate
   * fields now.
   */
  readonly cloud: boolean
  /**
   * Where this provider's own terms and privacy policy live.
   *
   * Empty for a local server, which has neither: nothing leaves the machine, so
   * there is no second party and no agreement. For everything else these are
   * shown at the moment of choosing, because that is the moment the person is
   * deciding to be bound by them — a link buried in a settings page they have
   * already finished with is a link nobody follows.
   */
  readonly termsUrl: string
  readonly privacyUrl: string
  /**
   * True when the provider's own licence forbids production use.
   *
   * Only NVIDIA today. Its API Trial Terms of Service permit use "for internal
   * testing and evaluation purposes, not in production", and separately forbid
   * uploading "personal information relating to an identifiable individual" —
   * which is most of what jojo's assistant sends. Both facts are the user's to
   * act on and neither is discoverable from the app without being told, so this
   * flag exists to make the warning say something different rather than louder.
   */
  readonly evaluationOnly: boolean
  /**
   * Whether using it costs money.
   *
   * Separate from `cloud` because "my records are leaving this device" and "this
   * is running up a bill" are different worries and a person may accept one and
   * not the other.
   */
  readonly billed: boolean
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
  /**
   * What this provider's keys look like, for the placeholder.
   *
   * The field said `sk-…` for everybody, which is OpenAI's shape and nobody
   * else's: Anthropic's are `sk-ant-…` and NVIDIA's are `nvapi-…`. A placeholder
   * showing the wrong prefix is a small lie in the one field where a person is
   * checking whether they pasted the right thing.
   */
  readonly keyLooksLike: string
  /**
   * Where to get one, when there is a page for it.
   *
   * Empty for the local providers, which need no key. It earns its place on the
   * free tier especially: "sign in and it gives you a key" is the whole
   * onboarding, and somebody who cannot find that page does not get an agent.
   */
  readonly keyUrl: string
  /**
   * A real model id from this catalogue, for the placeholder.
   *
   * Empty for the local providers, where the server states its own and a guess
   * would be worse than blank. It exists because a hosted catalogue's ids are
   * long and structured — `nvidia/nemotron-3-ultra-550b-a55b` — and someone
   * typing one into an empty box has no way to tell whether the shape is right
   * until a request fails.
   */
  readonly modelLooksLike: string
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
    billed: false,
    cloud: false,
    termsUrl: '',
    privacyUrl: '',
    evaluationOnly: false,
    // The reason this provider has its own dialect at all.
    canSetContext: true,
    modelLooksLike: '',
    keyLooksLike: '',
    keyUrl: '',
    defaultContext: 32768,
  },
  {
    id: 'openai-compatible',
    label: 'A local server (vLLM, LM Studio, llama.cpp)',
    endpoint: '',
    dialect: 'openai',
    fixedEndpoint: false,
    needsKey: false,
    billed: false,
    cloud: false,
    termsUrl: '',
    privacyUrl: '',
    evaluationOnly: false,
    modelLooksLike: '',
    keyLooksLike: '',
    keyUrl: '',
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
    billed: true,
    cloud: true,
    termsUrl: 'https://www.anthropic.com/legal/commercial-terms',
    privacyUrl: 'https://www.anthropic.com/legal/privacy',
    evaluationOnly: false,
    canSetContext: false,
    modelLooksLike: 'claude-sonnet-4-5',
    keyLooksLike: 'sk-ant-…',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    defaultContext: 200_000,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    endpoint: 'https://api.openai.com/v1',
    dialect: 'openai',
    fixedEndpoint: true,
    needsKey: true,
    billed: true,
    cloud: true,
    termsUrl: 'https://openai.com/policies/business-terms/',
    privacyUrl: 'https://openai.com/policies/privacy-policy/',
    evaluationOnly: false,
    canSetContext: false,
    modelLooksLike: 'gpt-4o',
    keyLooksLike: 'sk-…',
    keyUrl: 'https://platform.openai.com/api-keys',
    defaultContext: 128_000,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1',
    dialect: 'openai',
    fixedEndpoint: true,
    needsKey: true,
    billed: true,
    cloud: true,
    termsUrl: 'https://openrouter.ai/terms',
    privacyUrl: 'https://openrouter.ai/privacy',
    evaluationOnly: false,
    canSetContext: false,
    modelLooksLike: 'meta-llama/llama-3.3-70b-instruct',
    keyLooksLike: 'sk-or-…',
    keyUrl: 'https://openrouter.ai/keys',
    defaultContext: 128_000,
  },
  {
    id: 'groq',
    label: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1',
    dialect: 'openai',
    fixedEndpoint: true,
    needsKey: true,
    billed: true,
    cloud: true,
    termsUrl: 'https://groq.com/terms-of-use/',
    privacyUrl: 'https://groq.com/privacy-policy/',
    evaluationOnly: false,
    canSetContext: false,
    modelLooksLike: 'llama-3.3-70b-versatile',
    keyLooksLike: 'gsk_…',
    keyUrl: 'https://console.groq.com/keys',
    defaultContext: 128_000,
  },
  {
    /*
     * NVIDIA's hosted catalogue at build.nvidia.com.
     *
     * Here because it is the one entry in this table that a person can use
     * without paying anything: an account gives credits that refresh, the API is
     * OpenAI-shaped, and the models on it include several large open-weight ones
     * that this app's tool catalog actually fits inside. For somebody who cannot
     * run a 70B locally and will not put a card down, it is the difference
     * between an agentic jojo and a filing cabinet.
     *
     * `billed: false` and `cloud: true` together, and the pair is the honest
     * reading: nothing is charged, and the records still leave the device. This
     * is the provider that made those two separate fields.
     *
     * Rate limits are the cost instead, and they are strict enough that a person
     * WILL meet them — which is why `model-server.ts` learned to name a 429
     * rather than quoting it. Nothing here retries on the user's behalf: a
     * silent retry against a rate limit is how one slow answer becomes four.
     */
    id: 'nvidia',
    label: 'NVIDIA (build.nvidia.com) — free, rate limited',
    endpoint: 'https://integrate.api.nvidia.com/v1',
    dialect: 'openai',
    fixedEndpoint: true,
    needsKey: true,
    billed: false,
    cloud: true,
    termsUrl:
      'https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf',
    privacyUrl: 'https://www.nvidia.com/en-us/about-nvidia/privacy-policy/',
    evaluationOnly: true,
    canSetContext: false,
    modelLooksLike: 'nvidia/nemotron-3-ultra-550b-a55b',
    keyLooksLike: 'nvapi-…',
    keyUrl: 'https://build.nvidia.com/',
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
 * What a typed context window means, for the field both apps now show.
 *
 * `undefined` is a real answer and not a failure: it means "use the provider's
 * default", and for Ollama it additionally means jojo sends no `num_ctx` at
 * all, so the server sizes itself against its own VRAM instead of failing to
 * load a model at a number somebody guessed. Empty, whitespace, zero, junk and
 * a negative all collapse to it — `contextOf` would ignore each of them anyway,
 * and storing one would leave a field reading `0` beside an app planning
 * against 4,096.
 *
 * Here rather than in either settings screen because it was written twice, once
 * per app, and a rule about what a number means is not a rule about a text
 * input. Components are never mounted in this project's tests, so logic left in
 * JSX is logic nothing can check.
 */
export const parseContextWindow = (typed: string): number | undefined => {
  const digits = typed.trim()
  if (!/^\d+$/.test(digits)) return undefined
  const n = Number.parseInt(digits, 10)
  return Number.isFinite(n) && n > 0 ? n : undefined
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

/**
 * Whether an endpoint points at the machine doing the asking.
 *
 * ## Why this is a phone problem and not a bug in the defaults
 *
 * Ollama's default endpoint is `http://localhost:11434` and LM Studio's is
 * loopback too, and on a desktop browser both are exactly right — the server is
 * on the same machine as the page. On a phone the same string is a different
 * address: it is the phone, the phone is not running Ollama, and the request
 * fails with a connection error that reads identically to a server that is
 * switched off. Somebody following the setup copy has then done everything
 * correctly and been told it does not work.
 *
 * So the defaults stay as they are — they are correct where they are correct —
 * and the app that cannot use them says so. This is the rule for "would that
 * only work on this machine", kept here beside the endpoints it judges, and
 * kept pure so it can be tested without a network.
 *
 * `.local` is deliberately NOT loopback: an mDNS name resolves to a real
 * address on the network and is a perfectly good way for a phone to find a
 * desktop. It is the one people are most likely to type after being warned.
 */
export function isLoopbackEndpoint(raw: string): boolean {
  const authority = raw
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .split(/[/?#]/)[0]
  if (authority === undefined || authority === '') return false

  /*
   * Stripping the port without eating an IPv6 address.
   *
   * A bracketed literal is unambiguous. An UNBRACKETED one is not a legal URL
   * but people type it, and `http://::1` run through a plain `:\d+$` strip
   * becomes `:` — the address disappears and the check quietly returns false,
   * which is the failure mode this whole function exists to prevent. Two or
   * more colons and no brackets means the colons are the address.
   */
  const bracketed = /^\[([^\]]*)\]/.exec(authority)
  const host = (
    bracketed
      ? bracketed[1]
      : (authority.match(/:/g)?.length ?? 0) > 1
        ? authority
        : authority.replace(/:\d+$/, '')
  )?.toLowerCase()

  if (host === undefined || host === '') return false
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true
  // The whole 127/8 block, not just 127.0.0.1 — `127.0.0.2` is equally the
  // machine asking, and someone who has read a tutorial may well have it.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
}
