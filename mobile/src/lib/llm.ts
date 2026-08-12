/**
 * The one place this app talks to a model, and the only network call it makes.
 *
 * OpenAI's chat-completions shape, because vLLM, Ollama and LM Studio all speak
 * it — pointing at a local server is a URL, not an integration. Nothing is sent
 * anywhere else: the endpoint is whatever the user typed in Settings, it
 * defaults to localhost, and there is no key, no telemetry and no fallback host.
 *
 * WHAT THIS REFUSES TO DO.
 *
 * It never invents a reply. Every failure — no endpoint, refused connection,
 * a timeout, a non-200, a body in a shape it does not recognise — comes back as
 * a `Failure` with a sentence the screen prints verbatim. The assistant has
 * shipped canned answers with a badge saying so since the first build, and the
 * one thing worse than a canned answer is a canned answer presented as a real
 * one because the request quietly failed.
 *
 * The timeout is the reason this file owns an `AbortController` rather than
 * awaiting `fetch` directly. A local model on a cold start can take a long time
 * to answer, but "a long time" and "the server is not there" are the same
 * experience without one — `fetch` to a closed port on a phone can hang until
 * the OS gives up, which is far longer than anybody will sit and watch.
 */

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type ModelSettings = {
  /** Base URL, OpenAI-style: '.../v1'. `chat/completions` is appended. */
  endpoint: string
  model: string
}

export type LlmResult =
  | { ok: true; text: string }
  | { ok: false; reason: string; kind: 'unconfigured' | 'unreachable' | 'refused' | 'malformed' }

/** Long enough for a cold local model, short enough to not read as a hang. */
const TIMEOUT_MS = 60_000

const join = (base: string, path: string) => `${base.replace(/\/+$/, '')}/${path}`

export function isConfigured(settings: ModelSettings): boolean {
  return settings.endpoint.trim().length > 0 && settings.model.trim().length > 0
}

export async function complete(
  settings: ModelSettings,
  messages: readonly ChatMessage[],
  signal?: AbortSignal,
): Promise<LlmResult> {
  if (!isConfigured(settings)) {
    return {
      ok: false,
      kind: 'unconfigured',
      reason: 'No model is connected. Settings is where the endpoint goes.',
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  // The caller's cancel and our timeout both have to reach the same request.
  signal?.addEventListener('abort', () => controller.abort())

  try {
    const response = await fetch(join(settings.endpoint.trim(), 'chat/completions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: settings.model.trim(),
        messages,
        // Streaming would be nicer and is a bigger change: it needs a reader on
        // a platform whose fetch does not give one without a polyfill. A local
        // model answers fast enough that the wait is tolerable, and a partial
        // answer that stops mid-sentence on a dropped socket is its own problem.
        stream: false,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      return {
        ok: false,
        kind: 'refused',
        reason: `The model answered ${String(response.status)}${body ? ` — ${body.slice(0, 200)}` : ''}.`,
      }
    }

    const payload: unknown = await response.json()
    const text = readReply(payload)
    if (text === null) {
      return {
        ok: false,
        kind: 'malformed',
        reason: 'The server answered, but not in the shape an OpenAI-compatible endpoint uses.',
      }
    }
    return { ok: true, text }
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    return {
      ok: false,
      kind: 'unreachable',
      reason: aborted
        ? `Nothing answered within ${String(TIMEOUT_MS / 1000)} seconds.`
        : `Could not reach ${settings.endpoint.trim()} — ${error instanceof Error ? error.message : String(error)}.`,
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Digs the reply out without trusting the shape.
 *
 * Written defensively because "OpenAI-compatible" is a claim each server makes
 * about itself. A missing `choices[0].message.content` is reported as malformed
 * rather than rendered as `undefined`, which is what an optional chain into a
 * template literal would have done.
 */
function readReply(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const message = (choices[0] as { message?: unknown }).message
  if (typeof message !== 'object' || message === null) return null
  const content = (message as { content?: unknown }).content
  return typeof content === 'string' && content.trim().length > 0 ? content : null
}

/** A one-shot request the Settings panel uses to say connected or not. */
export async function ping(settings: ModelSettings): Promise<LlmResult> {
  return complete(settings, [{ role: 'user', content: 'Reply with the single word: ready' }])
}
