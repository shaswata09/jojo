import ReactNativeBlobUtil from 'react-native-blob-util'
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
import { mimeOfFile } from '@jojo/service/core/files'
import { failed, send } from '@/lib/local-service'

/**
 * Reading a document, through MarkItDown running on the machine this phone can
 * reach.
 *
 * MarkItDown is Microsoft's, MIT-licensed, and is not shipped here — see
 * `THIRD-PARTY-NOTICES.md` and the header of `@jojo/service/agent/markitdown`.
 *
 * What is in THIS file is the phone's half. It differs from the browser's in the
 * part that matters: a document here is a `file://` path on the handset, and the
 * converter is on another machine, so the path is worthless to it. The bytes go
 * as base64 in a `data:` URI — which is also why `MAX_BYTES` exists, since the
 * whole string is built in this process before it is sent.
 */

/** Kept for the session: MCP wants a handshake before the first call. */
let shookHands: string | null = null

/** `file:///a/b.pdf` → `/a/b.pdf`, which is what the filesystem module takes. */
const pathOf = (uri: string) => (uri.startsWith('file://') ? uri.slice('file://'.length) : uri)

async function handshake(endpoint: string): Promise<ConvertResult> {
  if (shookHands === endpoint) return { ok: true, markdown: '' }
  const opened = await send(initializeRequest(endpoint), endpoint)
  if (failed(opened)) return { ok: false, reason: opened.failed.reason }
  const read = readHandshake(opened, endpoint)
  if (!read.ok) return read
  // Fire-and-forget: JSON-RPC forbids a reply to a notification.
  void send(initializedNotification(endpoint), endpoint)
  shookHands = endpoint
  return { ok: true, markdown: '' }
}

/** Settings' "Test connection" for the reader. */
export async function testReader(endpoint: string): Promise<ConvertResult> {
  shookHands = null
  if (endpoint.trim().length === 0) {
    return { ok: false, reason: 'No address yet. See Settings.' }
  }
  const opened = await send(initializeRequest(endpoint), endpoint)
  if (failed(opened)) return { ok: false, reason: opened.failed.reason }
  return readHandshake(opened, endpoint)
}

export async function convertDocument(
  endpoint: string,
  uri: string,
  name: string,
): Promise<ConvertResult> {
  const path = pathOf(uri)
  try {
    const stat = await ReactNativeBlobUtil.fs.stat(path)
    const size = Number(stat.size)
    if (size > MAX_BYTES) {
      return {
        ok: false,
        reason: `That document is ${String(Math.round(size / 1024 / 1024))} MB and the reader takes up to ${String(MAX_BYTES / 1024 / 1024)} MB.`,
      }
    }
  } catch {
    return { ok: false, reason: 'The copy of that document is no longer on this device.' }
  }

  const ready = await handshake(endpoint)
  if (!ready.ok) return ready

  let base64: string
  try {
    base64 = await ReactNativeBlobUtil.fs.readFile(path, 'base64')
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }

  // `mimeOfFile` from the record's NAME rather than from the path: the stored
  // copy is named by id, and a converter told `application/octet-stream` for a
  // PDF has to guess at what it was handed.
  const answer = await send(convertRequest(endpoint, dataUri(mimeOfFile(name), base64)), endpoint)
  if (failed(answer)) {
    shookHands = null
    return { ok: false, reason: answer.failed.reason }
  }
  const out = readConvertResponse(answer)
    /*
   * The WHOLE document, untrimmed. The cut belongs to `vault.file.read`, which
   * is the only caller that can offer a way to read past it — trimming here made
   * the rest unreachable by anything, which is how a three-page CV became one
   * page and the model started asking people to paste the remainder.
   *
   * `convertUrl` below still trims: a job posting is read in one bite by
   * `read-posting`, which has no offset to pass and no conversation to continue.
   */
  return out.ok ? { ok: true, markdown: out.markdown } : out
}

/**
 * A page on the web, fetched and converted by the reader.
 *
 * The twin of web's `convertUrl`, and the same call: `convert_to_markdown`
 * takes "an http:, https:, file: or data: URI" — its own words, off
 * `tools/list` — so the FETCH HAPPENS ON THE READER rather than on the handset.
 * On the web that is the only way to read a job board at all, since a browser
 * is forbidden from reading a cross-origin page. Here it is a choice, and the
 * right one: it keeps a WebView, an HTML parser and a rendering engine off the
 * path, and it means both platforms extract from byte-identical text.
 *
 * A successful call is not a successful read. Boards that render with
 * JavaScript answer with a shell, so the caller has to be ready for a page that
 * converted perfectly and says nothing.
 *
 * No size check, unlike `convertDocument` above: that one exists because the
 * whole document is base64'd in this process first. Here the bytes are the
 * reader's to fetch and this side never sees them.
 */
export async function convertUrl(
  endpoint: string,
  url: string,
  signal?: AbortSignal,
): Promise<ConvertResult> {
  const ready = await handshake(endpoint)
  if (!ready.ok) return ready

  const answer = await send(convertRequest(endpoint, url), endpoint, signal)
  if (failed(answer)) {
    shookHands = null
    return { ok: false, reason: answer.failed.reason }
  }
  const out = readConvertResponse(answer)
  return out.ok ? { ok: true, markdown: trimForModel(out.markdown) } : out
}
