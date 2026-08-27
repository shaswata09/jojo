import { MODEL_TIMEOUT_MS, stalled, unreachable } from '@jojo/service/core/model-server'
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
 * The one browser block this transport can be CERTAIN of.
 *
 * An https page calling a plain http address is refused by rule, before a socket
 * is opened — so unlike everything else that arrives as `TypeError: Failed to
 * fetch`, there is nothing else it could have been. That certainty is what makes
 * it the only case allowed to report `why: 'blocked'`; see `send` below.
 *
 * MIXED CONTENT NEEDS BOTH HALVES, and this used to check only one.
 *
 * The old version blamed mixed content whenever the PAGE was https, without
 * looking at where the request was going. So a hosted copy calling
 * `https://integrate.api.nvidia.com/v1` — https to https, not mixed content at
 * all — was told "browsers forbid calling a plain http address … put the model
 * behind https", about a model that was already behind https. That sends
 * somebody to fix a configuration that is already correct, which is worse than
 * saying nothing.
 */
/**
 * Loopback, which the Mixed Content algorithm does NOT block.
 *
 * `localhost`, `127.0.0.0/8` and `[::1]` are *potentially trustworthy* origins,
 * so an https page reaching them over plain http is allowed — and that is the
 * single most common address this app talks to. Calling it `blocked` sends
 * somebody to fix a browser policy that is not stopping them, while the actual
 * cause is almost always that nothing is listening on the port.
 */
const LOOPBACK = /^https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:$|\/)/i

/**
 * A machine on the person's own network — which the extension will relay to.
 *
 * Kept in step with `isPrivateNetwork` in `web/extension/background.js`. It
 * decides what may be relayed; this decides which remedy to offer, and the two
 * disagreeing is how the old sentence came to recommend an extension that would
 * refuse the very address it was recommended for.
 */
const isPrivate = (target?: string): boolean => {
  if (target === undefined) return false
  const host = target.replace(/^https?:\/\//i, '').split('/')[0]?.split(':')[0]?.toLowerCase() ?? ''
  if (host.endsWith('.local')) return true
  const o = host.split('.').map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : -1))
  if (o.length !== 4 || o.some((n) => n < 0 || n > 255)) return false
  return o[0] === 10 || (o[0] === 172 && o[1]! >= 16 && o[1]! <= 31) || (o[0] === 192 && o[1] === 168) || (o[0] === 169 && o[1] === 254)
}

const mixedContent = (target?: string) =>
  globalThis.location?.protocol === 'https:' &&
  target !== undefined &&
  /^http:\/\//i.test(target) &&
  !LOOPBACK.test(target)

/**
 * What a bare `Failed to fetch` could mean, in the order worth checking.
 *
 * Mixed content is checked first and answered alone because it is the one case
 * that is certain: an https page calling http is blocked by rule, so there is
 * nothing else it could be and offering alternatives would be noise.
 */
const browserBlocked = (target?: string) => {
  const pageIsHttps = globalThis.location?.protocol === 'https:'
  if (mixedContent(target)) {
    /*
     * The remedy names the extension again, and this time it is true.
     *
     * It said "install the jojo extension, which relays that one hop for you"
     * while `background.js` relayed only loopback and five hosted providers —
     * so somebody with a LAN model server installed an extension that then told
     * them their address was not a provider it knew about. The extension now
     * relays private-network addresses (RFC 1918, link-local, `.local`) over
     * http, which is what makes this sentence honest.
     *
     * A PUBLIC http address is still refused by both, and the sentence says so
     * rather than sending somebody to install something that will not help.
     */
    return isPrivate(target)
      ? ' This page is on https, which browsers forbid from calling a plain http address — install the jojo extension, which relays that one hop to your own network for you. Or serve jojo over http.'
      : ' This page is on https, which browsers forbid from calling a plain http address. Serve jojo over http, or put the model on this machine, on your own network, or behind https — the extension relays those, but not a plain http address on the public internet.'
  }
  if (pageIsHttps) {
    return ' Both this page and that address are https, so this is not a mixed-content block. The likely cause is CORS: the server answered without the headers a browser needs to read a reply. Cloud providers generally do not send them, which is what the jojo extension is for — check it is installed and enabled.'
  }
  return ' The browser would not say why. Either nothing is listening there, or the server answered without the CORS headers a browser needs to read a reply — which both of the services this app talks to do in some cases, so a server that is running can fail this way too.'
}

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
    const failure = unreachable(endpoint, detail, aborted)
    // A timeout is not ambiguous — something was listening long enough to keep
    // us waiting — so it keeps the plain wording and is not second-guessed.
    return {
      failed: aborted
        ? failure
        : {
            ...failure,
            /*
             * Reported as `blocked` ONLY where it is certain, which is mixed
             * content and nothing else.
             *
             * `unreachable()` labels every non-timeout as `why: 'unreachable'`,
             * which was wrong for a page the browser refused to let out — and
             * the temptation is to flip the whole branch to `blocked` instead.
             * That trades one confident lie for another: a `Failed to fetch`
             * here is a dead local server, a CORS-less error response and a
             * mixed-content refusal all wearing the same exception, which is
             * the point `llm.ts` spends three paragraphs on. Most of what
             * reaches this transport IS a local server, so calling it all
             * `blocked` would bury the ordinary case under the rare one.
             *
             * Mixed content is the exception because the browser decides it by
             * rule before the request leaves, so there is no other explanation
             * for it to be hiding.
             */
            ...(mixedContent(request.url) ? { why: 'blocked' as const } : {}),
            reason: failure.reason + browserBlocked(request.url),
          },
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The same request, read as it arrives.
 *
 * ## Why this exists, in numbers
 *
 * `send` above waits for the whole body and gives up after
 * `MODEL_TIMEOUT_MS`. That is a duration budget, and a duration budget is a
 * TOKEN budget in disguise: measured against a vLLM box serving a 31B model,
 * generation runs at about fourteen tokens a second, so sixty seconds buys
 * roughly eight hundred and fifty tokens. Short answers landed. A long
 * structured tool call — "build my profile from my CV" — did not, and the
 * person waited a full minute to be told nothing answered while the server was
 * working correctly the whole time.
 *
 * ## The timeout here is IDLE, not total
 *
 * The timer resets on every chunk. A stream that keeps producing is never cut
 * off however long it runs, and a stream that stops producing is reported after
 * the same interval it always was. That is the fix: "nothing is there" and
 * "this is taking a while" stop being the same experience, which is what the
 * comment above `send` claims a timeout buys and could not deliver while the
 * budget was total.
 *
 * ## What it does not do
 *
 * It does not parse. `onChunk` is handed raw text and the caller feeds it to
 * `createStreamReader`, which is where the format lives and where the tests
 * are. This function owns the socket and the clock and nothing else.
 */
export async function sendStream(
  request: ModelRequest,
  endpoint: string,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<Sent> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const idle = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      controller.abort()
    }, MODEL_TIMEOUT_MS)
  }
  const stopClock = () => {
    if (timer !== undefined) clearTimeout(timer)
  }
  idle()
  signal?.addEventListener('abort', () => {
    controller.abort()
  })

  // Read in the catch, to tell a stream that never started from one that stopped.
  let sofar = 0

  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body === undefined ? {} : { body: request.body }),
      signal: controller.signal,
      credentials: 'omit',
    })

    /*
     * A non-2xx never streams: the body is an error document, and the callers
     * already know how to read one. Handing it back in the ordinary shape means
     * a 401, a 429 and a 500 produce exactly the sentence they always did.
     */
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '')
      stopClock()
      return {
        ok: response.ok,
        status: response.status,
        text,
        ...(response.headers.get('retry-after') === null
          ? {}
          : { retryAfter: response.headers.get('retry-after') as string }),
      }
    }

    const reader = response.body.getReader()
    const decode = new TextDecoder()
    let whole = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      // `stream: true` on the decoder, because a multi-byte character can be
      // split across two network chunks and decoding each alone turns an
      // accented name into a replacement character.
      const text = decode.decode(value, { stream: true })
      if (text !== '') {
        whole += text
        sofar += text.length
        idle()
        onChunk(text)
      }
    }
    stopClock()
    // The accumulated body, so a caller that also wants to parse it whole —
    // or to report what arrived — has it in the same shape `send` returns.
    return { ok: true, status: response.status, text: whole }
  } catch (error) {
    stopClock()
    const aborted = error instanceof Error && error.name === 'AbortError'
    // A stalled stream gets its own sentence — see `stalled` in core. The
    // caller's own abort is not a failure to report at all, but it arrives here
    // as the same `AbortError`, so the two are told apart by whose signal fired.
    const mine = aborted && signal?.aborted !== true
    if (mine) return { failed: stalled(endpoint, sofar) }
    const failure = unreachable(
      endpoint,
      aborted ? 'aborted' : `network${browserBlocked(request.url)}`,
      false,
    )
    // The same certainty rule as `send` — a stream is refused by the same rule
    // a whole request is, and reporting the two differently would make the
    // numbers depend on which transport a caller happened to pick.
    return {
      failed:
        !aborted && mixedContent(request.url) ? { ...failure, why: 'blocked' as const } : failure,
    }
  }
}
