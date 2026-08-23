import { MODEL_TIMEOUT_MS, unreachable } from '@jojo/service/core/model-server'
import type { ModelRequest, ModelResponse } from '@jojo/service/core/model-server'

/**
 * One request to a service running on this machine, sent.
 *
 * Extracted from `llm.ts` when a second local service arrived. The app talks to
 * two now — an OpenAI-compatible model and MarkItDown's MCP server — and both
 * are the same shape of thing: an address the user typed, a described request,
 * and a body to read back. A second copy of this in `markitdown.ts` would be a
 * second place for the timeout and the failure wording to drift.
 *
 * The timeout is why this owns an `AbortController` rather than awaiting `fetch`
 * directly. A local model on a cold start can take a long time to answer, and so
 * can a hundred-page PDF, but "a long time" and "nothing is there" are the same
 * experience without one.
 */
export type Sent = ModelResponse | { failed: ReturnType<typeof unreachable> }

export const failed = (r: Sent): r is { failed: ReturnType<typeof unreachable> } => 'failed' in r

/**
 * What a bare `Failed to fetch` could mean, in the order worth checking.
 *
 * Mixed content is checked first and answered alone because it is the one case
 * that is certain: an https page calling http is blocked by rule, so there is
 * nothing else it could be and offering alternatives would be noise.
 */
const browserBlocked = () =>
  globalThis.location?.protocol === 'https:'
    ? ' This page is on https, which browsers forbid from calling a plain http address — serve jojo over http, or put the model behind https.'
    : ' The browser would not say why. Either nothing is listening there, or the server answered without the CORS headers a browser needs to read a reply — which both of the services this app talks to do in some cases, so a server that is running can fail this way too.'

/**
 * Sends a described request and reports what came back.
 *
 * Never throws. A thrown `fetch` is a fact about the network, and the callers
 * turn every fact about the network into the same shape of sentence.
 *
 * The timeout is why this owns an `AbortController` rather than awaiting
 * `fetch` directly. A local model on a cold start can take a long time to
 * answer, but "a long time" and "the server is not there" are the same
 * experience without one.
 */
export async function send(
  request: ModelRequest,
  endpoint: string,
  signal?: AbortSignal,
): Promise<Sent> {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, MODEL_TIMEOUT_MS)
  // The caller's cancel and our timeout both have to reach the same request.
  signal?.addEventListener('abort', () => {
    controller.abort()
  })
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
      // No cookies, ever. A local server on loopback shares an origin policy
      // with nothing, and sending credentials it never asked for is how a
      // request that was meant to be local stops being local.
      credentials: 'omit',
    })
    return { ok: response.ok, status: response.status, text: await response.text().catch(() => '') }
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    const detail = error instanceof Error ? error.message : String(error)
    const failure = unreachable(endpoint, detail, aborted)
    // A timeout is not ambiguous — something was listening long enough to keep
    // us waiting — so it keeps the plain wording and is not second-guessed.
    return { failed: aborted ? failure : { ...failure, reason: failure.reason + browserBlocked() } }
  } finally {
    clearTimeout(timer)
  }
}
