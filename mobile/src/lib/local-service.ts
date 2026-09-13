import { MODEL_TIMEOUT_MS, unreachable } from '@jojo/service/core/model-server'
import type { ModelRequest, ModelResponse } from '@jojo/service/core/model-server'

/**
 * One request to a service on the machine this phone can reach, sent.
 *
 * Extracted from `llm.ts` when a second local service arrived. The app talks to
 * two now — an OpenAI-compatible model and MarkItDown's MCP server — and both
 * are the same shape of thing: an address the user typed, a described request,
 * and a body to read back. A second copy of this in `markitdown.ts` would be a
 * second place for the timeout and the failure wording to drift.
 *
 * The timeout is why this owns an `AbortController` rather than awaiting `fetch`
 * directly. A local model on a cold start can take a long time to answer, and so
 * can a hundred-page PDF, but "a long time" and "the server is not there" are
 * the same experience without one — `fetch` to a closed port on a phone can hang
 * until the OS gives up, which is far longer than anybody will sit and watch.
 */
export type Sent = ModelResponse | { failed: ReturnType<typeof unreachable> }

export const failed = (r: Sent): r is { failed: ReturnType<typeof unreachable> } => 'failed' in r

/**
 * Sends a described request and reports what came back.
 *
 * Never throws. A thrown `fetch` is a fact about the network, and the callers
 * turn every fact about the network into the same shape of sentence.
 */
export async function send(
  request: ModelRequest,
  endpoint: string,
  signal?: AbortSignal,
  /*
   * A TOTAL budget, and the one place it can be raised. This app cannot
   * stream — `chatRequest`'s note says why: a reader on a platform whose fetch
   * does not give one — so a reply is cut at this many milliseconds however
   * fast the server is going. Sixty seconds is right for a tool call and wrong
   * for a document: tailoring a cover letter on the local box is ~2,000 tokens
   * at ~14 a second, which is well past the default and nowhere near stalled.
   * The caller that asks for a document says how long a document takes.
   */
  timeoutMs: number = MODEL_TIMEOUT_MS,
): Promise<Sent> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  // A signal aborted BEFORE it got here never fires again — `addEventListener`
  // after the fact hears nothing — so a cancel pressed during the document
  // read would still send the model request. See the web twin.
  if (signal?.aborted === true) {
    clearTimeout(timer)
    return { failed: unreachable(endpoint, 'Stopped before it was sent.', true) }
  }
  // The caller's cancel and our timeout both have to reach the same request.
  signal?.addEventListener('abort', () => controller.abort())
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    })
    return {
      ok: response.ok,
      status: response.status,
      text: await response.text().catch(() => ''),
      // Read here because only the platform half has a `Response`. Absent on
      // almost every answer, which is why the core treats it as optional.
      retryAfter: response.headers.get('retry-after'),
    }
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    const detail = error instanceof Error ? error.message : String(error)
    return { failed: unreachable(endpoint, detail, aborted) }
  } finally {
    clearTimeout(timer)
  }
}
