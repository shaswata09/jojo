/** The streaming model relay: one request, its answer posted back chunk by chunk. */

import { modelRefusal } from './routing.js'
import { READ_TIMEOUT_MS, relayMethod } from './relay.js'
import { reasonOf } from './util.js'

/**
 * The port name the streaming model relay answers on.
 *
 * Shared with `bridge.js`; a mismatch is a silent no-op rather than an
 * error, because `onConnect` simply never fires for a name nobody listens
 * for — which is why it is a named constant on both sides.
 */
const MODEL_STREAM_PORT = 'jojo:model-stream'

/**
 * The same relay, but handing back the body AS IT ARRIVES.
 *
 * ## Why this exists
 *
 * A cloud provider cannot be called from the page: NVIDIA, OpenAI and Anthropic
 * do not send `access-control-allow-origin` to a browser origin, so the request
 * is made here instead. Until now that meant `await response.text()` — the
 * whole answer, handed back in one piece — and a person watching a slow model
 * write three paragraphs saw a spinner for the entire time, then all of it at
 * once. Local models have streamed since streaming was added; this is what
 * makes a hosted one behave the same.
 *
 * ## Why a Port and not `sendResponse`
 *
 * `sendResponse` fires exactly once. Streaming is many messages over one
 * request, which is what `chrome.runtime.connect` is for. The port also gives a
 * disconnect signal, so a tab that navigates away aborts the fetch instead of
 * leaving it running in a worker nobody is listening to.
 *
 * The final message carries the assembled text as well, so a caller that missed
 * a chunk — or a page that would rather not reassemble — has the whole body on
 * the same terms as the non-streaming relay.
 */
export function onModelStreamConnect(port) {
  if (port.name !== MODEL_STREAM_PORT) return

  const controller = new AbortController()
  let closed = false
  port.onDisconnect.addListener(() => {
    closed = true
    controller.abort()
  })

  port.onMessage.addListener((message) => {
    void (async () => {
      const request = message?.request
      const url = typeof request?.url === 'string' ? request.url : ''
      const send = (payload) => {
        if (closed) return
        try {
          port.postMessage(payload)
        } catch {
          // The page went away mid-answer. Nothing to do and nothing to log:
          // the disconnect listener has already aborted the fetch.
          closed = true
        }
      }

      // Inside a try like everything after it: a throw here would otherwise
      // end the stream with no 'done', and the page would wait out its budget.
      let refusal
      try {
        refusal = await modelRefusal(url)
      } catch (error) {
        refusal = `The extension could not read its routing settings: ${reasonOf(error)}`
      }
      if (refusal) {
        send({ type: 'done', ok: false, status: 0, text: '', reason: refusal })
        return
      }
      await streamAnswer(request, url, controller, send, () => closed)
    })()
  })
}

/**
 * Fetches one model request and posts its body back as it arrives: `chunk`s,
 * then one `done` with the whole text. `isClosed` says whether the page has
 * gone, which ends the stream early.
 */
async function streamAnswer(request, url, controller, send, isClosed) {
  // Same ceiling as the whole-body relay, but reset by ARRIVING BYTES
  // rather than by the request finishing: a long answer is not a stall, and
  // a fixed deadline would cut off exactly the slow responses this exists
  // to make watchable.
  let timer = null
  const arm = () => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      controller.abort()
    }, READ_TIMEOUT_MS)
  }
  arm()

  try {
    const method = relayMethod(request)
    if (method === null) throw new Error('the extension relays GET and POST only')
    const sendsBody = method !== 'GET'
    const response = await fetch(url, {
      method,
      headers: request.headers && typeof request.headers === 'object' ? request.headers : {},
      ...(sendsBody && typeof request.body === 'string' && request.body !== ''
        ? { body: request.body }
        : {}),
      signal: controller.signal,
      credentials: 'omit',
    })

    // A refusal has a body worth reading whole — it is an error message, not
    // a stream, and forwarding it as chunks would make the page parse an
    // SSE frame that was never sent.
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '')
      if (timer !== null) clearTimeout(timer)
      send({ type: 'done', ok: response.ok, status: response.status, text })
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let whole = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      arm()
      // `stream: true` on the DECODER as well: a multi-byte character can be
      // split across two network chunks, and decoding each in isolation
      // turns one é into two replacement characters.
      const text = decoder.decode(value, { stream: true })
      if (text === '') continue
      whole += text
      send({ type: 'chunk', text })
      if (isClosed()) return
    }
    whole += decoder.decode()
    if (timer !== null) clearTimeout(timer)
    send({ type: 'done', ok: true, status: response.status, text: whole })
  } catch (error) {
    if (timer !== null) clearTimeout(timer)
    const aborted = error && error.name === 'AbortError'
    send({
      type: 'done',
      ok: false,
      status: 0,
      text: '',
      reason: aborted
        ? 'The model provider stopped sending before the answer was finished.'
        : `The extension could not reach the model provider: ${String(error && error.message ? error.message : error)}`,
    })
  }
}
