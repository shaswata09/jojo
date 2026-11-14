/** The one-request hop to the reader, jojo-bridge or a model provider. */

/**
 * How long the far end gets, reader or model provider. Converting a large PDF is
 * genuinely slow, and so is a 70B model composing a first token.
 *
 * The PAGE has to be willing to wait at least this long, and for most of this
 * constant's life it was not: `capture-bridge.ts` gave the same request the
 * scan's 40 seconds, so a conversion this worker finished at 55 had already been
 * abandoned at the other end and reported as "the extension did not answer" —
 * and the answer, when it came, was posted into a closed channel. Reads do not
 * stream, so nothing re-armed that timer.
 *
 * `RELAY_TIMEOUT_MS` over there is now a transcription of this number with a
 * margin, and `reader-relay.test.ts` fails if the two drift. Whichever end gives
 * up first writes the sentence the user reads, and it should be this one: it
 * knows what was being called and for how long.
 */
export const READ_TIMEOUT_MS = 120000

/**
 * The only methods any relay carries. Every request jojo makes through one is a
 * GET (a model list, the link's poll) or a POST (a completion, an MCP call);
 * anything else a page asks for is a verb jojo never sends, aimed at a server
 * that would act on it.
 */
const RELAY_METHODS = ['GET', 'POST']

/** The method to send, or null when it is not one a relay carries. */
export function relayMethod(request) {
  const method = typeof request?.method === 'string' ? request.method.trim().toUpperCase() : 'POST'
  return RELAY_METHODS.includes(method) ? method : null
}

/**
 * One request to the reader, relayed verbatim.
 *
 * The page owns the MCP protocol — the handshake, the JSON-RPC envelope, the
 * session header — and this owns only the hop. Keeping the split there means
 * the protocol stays in `@jojo/service/agent/markitdown`, where it is tested,
 * instead of being half-reimplemented in an extension nothing can test.
 *
 * The answer comes back as `{ ok, status, text }`, the same shape the page's own
 * transport returns, so the caller cannot tell which route was taken.
 */
export async function relay(request, what) {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, READ_TIMEOUT_MS)
  const method = relayMethod(request)
  if (method === null) {
    clearTimeout(timer)
    return {
      ok: false,
      status: 0,
      text: '',
      reason: `The extension relays GET and POST only, so the ${what} was not called.`,
    }
  }
  // A GET may not carry one, and `fetch` throws rather than ignoring it:
  // "Request with GET/HEAD method cannot have body". The model list is a GET.
  const sendsBody = method !== 'GET'
  try {
    const response = await fetch(request.url, {
      method,
      headers: request.headers && typeof request.headers === 'object' ? request.headers : {},
      ...(sendsBody && typeof request.body === 'string' && request.body !== ''
        ? { body: request.body }
        : {}),
      signal: controller.signal,
      // Same rule as the page's transport: a loopback server shares an origin
      // policy with nothing, and credentials it never asked for are how a local
      // request stops being local.
      credentials: 'omit',
    })
    return {
      ok: response.ok,
      status: response.status,
      text: await response.text().catch(() => ''),
    }
  } catch (error) {
    const aborted = error && error.name === 'AbortError'
    /*
     * NOTHING IS RECORDED HERE, and the absence is the fix.
     *
     * This called `recordExtensionCrash`, which is defined nowhere — not in this
     * file, not in the repo. So the commonest failure this function has, a
     * reader that was never started, threw `ReferenceError` out of the catch
     * before reaching the return below: `sendResponse` was never called, the
     * message channel closed, and the page showed Chrome's "message port closed
     * before a response was received" instead. Every sentence written in this
     * function was dead code, including the one naming which thing was called.
     *
     * The failure does reach the person, by the only route a service worker has
     * to them: the `reason` below crosses the bridge and is shown. A worker's
     * own crash log — what the recorder was meant to be — needs the
     * `jojo:crash-reporting` handler that `bridge.js` already forwards to and
     * this worker does not implement; when that lands, it goes here.
     */
    return {
      ok: false,
      status: 0,
      text: '',
      // Named by what was being called. This said "the reader" for everything,
      // so a failed model request reported a document reader that was not
      // involved — two wrong nouns in one sentence about a third thing.
      reason: aborted
        ? `The ${what} did not answer within ${String(READ_TIMEOUT_MS / 1000)} seconds.`
        : `Could not reach the ${what} at ${request.url} — ${String(error && error.message ? error.message : error)}.`,
    }
  } finally {
    clearTimeout(timer)
  }
}
