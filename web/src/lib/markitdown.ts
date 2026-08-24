import {
  MAX_BYTES,
  convertRequest,
  dataUri,
  initializeRequest,
  initializedNotification,
  readConvertResponse,
  readHandshake,
  trimForModel,
} from '@jojo/service/agent/markitdown'
import type { ConvertResult } from '@jojo/service/agent/markitdown'
import { failed, send } from '@/lib/local-service'
import type { Sent } from '@/lib/local-service'
import { readDocument } from '@/lib/capture-bridge'

/**
 * Reading a document, through MarkItDown running on this machine.
 *
 * MarkItDown is Microsoft's, MIT-licensed, and is not shipped here — see
 * `THIRD-PARTY-NOTICES.md` and the header of `@jojo/service/agent/markitdown`,
 * which carries the reasoning for talking to it rather than bundling it.
 *
 * What is in THIS file is the browser's half: turning a `File` out of IndexedDB
 * into base64, and sending. Both are platform work — the service layer may not
 * fetch, and it has never heard of a `File`.
 */

/** Kept for the session: MCP wants a handshake before the first call. */
let shookHands: string | null = null

/**
 * An address on this machine, which the page itself cannot call.
 *
 * The two rules that decide it: markitdown-mcp sends no CORS headers, so a
 * cross-port POST from a page is refused whatever the ports; and an https://
 * page may not touch `127.0.0.1` at all. A relative path is exempt from both —
 * it is same-origin, which is what the dev server's proxy buys — so this asks
 * "is this a hop the page is allowed to make".
 */
const needsExtension = (endpoint: string) => /^https?:\/\//i.test(endpoint.trim())

/**
 * The reader's transport, chosen per address.
 *
 * A path goes direct, because same-origin is same-origin and the dev proxy is
 * the whole reason the default is a path. A full `http://…` address goes through
 * the extension, which fetches under its own `host_permissions` rather than the
 * page's origin — the only route that exists from a deployed copy to a reader
 * on the user's own machine.
 *
 * Deliberately NOT a fallback chain. Trying direct first and relaying on failure
 * would cost every call a doomed request plus a browser console error nobody can
 * act on, and "it failed, so try the other way" is how one transport bug becomes
 * two that mask each other.
 */
async function sendToReader(
  request: ReturnType<typeof initializeRequest>,
  endpoint: string,
  signal?: AbortSignal,
): Promise<Sent> {
  if (!needsExtension(endpoint)) return send(request, endpoint, signal)
  const relayed = await readDocument({
    url: request.url,
    method: request.method,
    headers: request.headers,
    ...(request.body === undefined ? {} : { body: request.body }),
  })
  // `unreachable` is the same kind the direct transport reports for a hop that
  // never landed — the relay not answering is that, one layer out.
  return 'failed' in relayed
    ? { failed: { ok: false, kind: 'unreachable', reason: relayed.failed.reason } }
    : relayed
}

async function handshake(endpoint: string): Promise<ConvertResult> {
  if (shookHands === endpoint) return { ok: true, markdown: '' }
  const opened = await sendToReader(initializeRequest(endpoint), endpoint)
  if (failed(opened)) return { ok: false, reason: opened.failed.reason }
  const read = readHandshake(opened, endpoint)
  if (!read.ok) return read
  // Fire-and-forget: JSON-RPC forbids a reply to a notification, so there is
  // nothing to wait for and a server that ignores it is within spec.
  void sendToReader(initializedNotification(endpoint), endpoint)
  shookHands = endpoint
  return { ok: true, markdown: '' }
}

/** Settings' "Test connection" for the reader. Also warms the handshake. */
export async function testReader(endpoint: string): Promise<ConvertResult> {
  shookHands = null
  if (endpoint.trim().length === 0) {
    return { ok: false, reason: 'No address yet. See Settings.' }
  }
  const opened = await sendToReader(initializeRequest(endpoint), endpoint)
  if (failed(opened)) return { ok: false, reason: opened.failed.reason }
  return readHandshake(opened, endpoint)
}

/**
 * Base64 of a file's bytes.
 *
 * `arrayBuffer()` rather than `FileReader`, which was the first version: the
 * reader is callback-based, hands back a whole `data:` URL whose prefix then has
 * to come off, and exists only in a browser — so the live check against a real
 * markitdown-mcp could not run this path at all. This one is a promise, returns
 * the bytes, and works anywhere.
 *
 * CHUNKED, and that is not tidiness. `String.fromCharCode(...bytes)` on an
 * eight-megabyte array throws "Maximum call stack size exceeded" — the spread
 * becomes eight million arguments — so the naive one-liner works on every
 * document small enough to test with by hand and fails on the CVs people
 * actually keep.
 */
const CHUNK = 0x8000

async function base64Of(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let at = 0; at < bytes.length; at += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK))
  }
  return btoa(binary)
}

export async function convertFile(endpoint: string, file: File): Promise<ConvertResult> {
  if (file.size > MAX_BYTES) {
    return {
      ok: false,
      // The number, so the person can see how far over it is rather than
      // guessing at a limit nobody stated.
      reason: `That document is ${String(Math.round(file.size / 1024 / 1024))} MB and the reader takes up to ${String(MAX_BYTES / 1024 / 1024)} MB.`,
    }
  }
  const ready = await handshake(endpoint)
  if (!ready.ok) return ready

  let base64: string
  try {
    base64 = await base64Of(file)
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }

  const answer = await sendToReader(convertRequest(endpoint, dataUri(file.type, base64)), endpoint)
  if (failed(answer)) {
    // The handshake is per-connection; a dropped one has to be redone rather
    // than remembered as good.
    shookHands = null
    return { ok: false, reason: answer.failed.reason }
  }
  const out = readConvertResponse(answer, endpoint)
  return out.ok ? { ok: true, markdown: trimForModel(out.markdown) } : out
}

/**
 * A page on the web, fetched and converted by the reader.
 *
 * `convert_to_markdown` takes "an http:, https:, file: or data: URI" — its own
 * words, off `tools/list` — so the same call that reads a local PDF reads a job
 * posting, and the FETCH HAPPENS ON THE READER rather than in this tab. That is
 * the whole reason this exists: the browser cannot fetch a job board itself,
 * because a cross-origin GET without CORS headers is unreadable by rule, and
 * every job board there is declines to add them for us.
 *
 * What it cannot do is run JavaScript. Measured against real boards while this
 * was written: a Greenhouse listing came back as 8k characters of real content,
 * `example.com` as 167, and an Ashby board as the single line "You need to
 * enable JavaScript to run this app." Wikipedia answered 403 outright. So a
 * successful call is not a successful read, and the caller has to be ready for
 * a page that parsed perfectly and says nothing — which is what `notAPosting`
 * in `@jojo/service/agent/read-posting` is for.
 *
 * No size pre-check, unlike `convertFile`: the bytes are the reader's to fetch
 * and this side never sees them, so there is nothing here to measure.
 */
export async function convertUrl(
  endpoint: string,
  url: string,
  signal?: AbortSignal,
): Promise<ConvertResult> {
  const ready = await handshake(endpoint)
  if (!ready.ok) return ready

  const answer = await sendToReader(convertRequest(endpoint, url), endpoint, signal)
  if (failed(answer)) {
    shookHands = null
    return { ok: false, reason: answer.failed.reason }
  }
  const out = readConvertResponse(answer, endpoint)
  return out.ok ? { ok: true, markdown: trimForModel(out.markdown) } : out
}
