import ReactNativeBlobUtil from 'react-native-blob-util'
import {
  CAPTURE_MAX_ASSET_BYTES,
  CAPTURE_SCHEMES,
  readCapture,
  type CaptureEnvelope,
  type CaptureRejection,
} from '@jojo/service/core/capture'

/**
 * The half of a capture that runs outside the WebView.
 *
 * `capture-script.ts` walks the page and hands back addresses; this fetches
 * them, inlines them and puts the result on disk. The split is forced: a fetch
 * from inside the WebView carries the page's origin and is refused by every CDN
 * a job board uses, while React Native's own `fetch` is not subject to CORS at
 * all — there is no browser between it and the socket.
 *
 * ## What it does not do
 *
 * It does not carry the user's session. Cookies for the posting live in the
 * WebView's jar, not in RN's networking stack, so an asset behind the same login
 * as the page comes back 403 and is dropped and counted. That is the right
 * trade: the TEXT of the posting — which is the thing worth keeping — is already
 * in the DOM the WebView handed over. What is at risk is a logo.
 */

/** What the injected script posts back, before anything trusts it. */
export type RawCapture = {
  type: string
  url?: string
  title?: string
  html?: string
  assets?: { href: string; kind: string }[]
  dropped?: number
  message?: string
}

export type CaptureOutcome =
  | { ok: true; capture: CaptureEnvelope }
  | { ok: false; reason: CaptureRejection | 'script-failed'; detail?: string }

/**
 * Turns what the page sent into something `readCapture` will accept.
 *
 * `now` is passed in rather than read, because nothing in this app reads a clock
 * except `lib/today.ts` — the same rule that keeps the service layer
 * deterministic applies one level up, and the capture's timestamp is a fact the
 * caller already holds.
 */
export async function inlineCapture(raw: RawCapture, now: string): Promise<CaptureOutcome> {
  if (raw.type === 'jojo:capture-failed') {
    return { ok: false, reason: 'script-failed', detail: raw.message }
  }
  if (typeof raw.html !== 'string' || typeof raw.url !== 'string') {
    return { ok: false, reason: 'not-a-page' }
  }

  const assets = [...(raw.assets ?? [])]
  const resolved = new Map<string, string>()
  /**
   * One entry per ADDRESS, beside the one-entry-per-token map above.
   *
   * Without it the same font referenced twice is base64-encoded twice. Measured
   * on the web side against ten live postings, that duplication was 4.1 MB of a
   * 9.3 MB capture and put every Lever page over `CAPTURE_MAX_BYTES` — refused
   * outright rather than merely bloated. The phone shares the inliner's shape,
   * so it shared the bug.
   */
  const byHref = new Map<string, string>()
  let dropped = raw.dropped ?? 0

  // Indexed rather than for-of because the loop appends to what it is walking:
  // a stylesheet's own url() references are discovered only once its text has
  // been fetched, and they are queued onto the end to be picked up by a later
  // turn of this same loop. One pass covers both levels.
  for (let i = 0; i < assets.length; i += 1) {
    const asset = assets[i]
    if (asset === undefined) continue
    const key = `__JOJO_ASSET_${String(i)}__`

    const seen = byHref.get(asset.href)
    if (seen !== undefined) {
      resolved.set(key, seen)
      continue
    }

    try {
      // Timed out rather than hung: the loop is sequential, so one CDN that
      // never answers leaves the Save button on 'Keeping…' forever.
      const response = await withTimeout(asset.href)
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)

      if (asset.kind === 'css') {
        const text = await response.text()
        const inlinedCss = text.replace(
          /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
          (whole, _q: string, url: string) => {
            const value = url.trim()
            if (value.startsWith('data:')) return whole
            // A same-document reference — `filter='url(#frameNoise)'` inside an
            // inline SVG. Resolving one invents a URL that never existed, which
            // is fetched, counted as dropped, and written back as `url("")`,
            // corrupting a data URI already decided upon.
            if (value.startsWith('#') || value.startsWith('%23')) return whole
            const nested = absolute(url, asset.href)
            if (nested === null) {
              dropped += 1
              return 'none'
            }
            const at = assets.length
            assets.push({ href: nested, kind: 'css-asset' })
            return `url("__JOJO_ASSET_${String(at)}__")`
          },
        )
        resolved.set(key, inlinedCss)
        byHref.set(asset.href, inlinedCss)
        continue
      }

      const blob = await response.blob()
      if (blob.size > CAPTURE_MAX_ASSET_BYTES) throw new Error('asset too large')
      const uri = await dataUri(blob)
      resolved.set(key, uri)
      byHref.set(asset.href, uri)
    } catch {
      dropped += 1
      resolved.set(key, '')
      // Remembered as a failure too, so a page naming a dead asset ten times
      // makes one request rather than ten.
      byHref.set(asset.href, '')
    }
  }

  let html = raw.html
  for (const [key, value] of resolved) html = html.split(key).join(value)

  // Anything the walk missed. A leftover token would render as literal text, and
  // a surviving http(s) address is the one thing that must not ship — so both
  // are swept rather than hoped about. `readCapture` refuses a capture with any
  // remote reference left, so without this sweep one missed asset would throw
  // the whole page away.
  html = html.replace(/__JOJO_ASSET_\d+__/g, '')
  // Anchored to `<[^>]*?`, so it can only match INSIDE a tag. Unanchored it ran
  // over text nodes too, and `outerHTML` does not escape `"` in text — so a
  // posting whose body quoted `<img src="https://…">` had its own prose
  // rewritten to `src=""` and counted as a dropped asset.
  html = html.replace(
    /(<[^>]*?\s(?:src|srcset|imagesrcset|href|poster|data|action|formaction|background)\s*=\s*)(["'])\s*(?:https?:|\/\/)[^"']*\2/gi,
    (_whole, head: string, quote: string) => {
      dropped += 1
      return `${head}${quote}${quote}`
    },
  )

  const read = readCapture({
    url: raw.url,
    title: raw.title ?? '',
    html,
    capturedAt: now,
    dropped,
  })

  return typeof read === 'string' ? { ok: false, reason: read } : { ok: true, capture: read }
}

/**
 * A GET that gives up.
 *
 * `AbortSignal.timeout` would be the one-liner and is not in React Native's lib
 * — Hermes ships `AbortController` but not the static helper — so the controller
 * is driven by hand. The timer is always cleared, including on the success path,
 * or a capture with eighty assets leaves eighty timers pending.
 */
const ASSET_TIMEOUT_MS = 15000

async function withTimeout(href: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ASSET_TIMEOUT_MS)
  try {
    return await fetch(href, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function absolute(value: string, base: string): string | null {
  try {
    const url = new URL(value, base)
    return (CAPTURE_SCHEMES as readonly string[]).includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

/**
 * A Blob as a `data:` URI.
 *
 * `FileReader` rather than `blob.arrayBuffer()` plus a hand-rolled base64: RN's
 * FileReader is the one path that is present and correct on both platforms, and
 * base64 of a multi-megabyte buffer written in JS is measurably slower than the
 * native implementation behind it.
 */
function dataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('unreadable asset'))
    reader.readAsDataURL(blob)
  })
}

/** Where a capture's bytes live on the device. */
const captureDir = () => `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/jojo-captures`

/**
 * Writes the page and returns the `file://` URI the record will carry.
 *
 * A directory of jojo's own rather than beside the picked documents, which land
 * in per-call UUID folders `keepLocalCopy` chooses. These are files this app
 * produced, so it gets to name them — and a predictable directory is what makes
 * "how much are the captures using" answerable later.
 *
 * The name is the record id, not the document's name: two captures of the same
 * posting a month apart are two records with one filename between them, and the
 * id is the only thing guaranteed unique. The readable name stays on the record.
 */
export async function writeCapture(id: string, html: string): Promise<string> {
  const dir = captureDir()
  if (!(await ReactNativeBlobUtil.fs.exists(dir))) await ReactNativeBlobUtil.fs.mkdir(dir)
  const path = `${dir}/${id}.html`
  await ReactNativeBlobUtil.fs.writeFile(path, html, 'utf8')
  return `file://${path}`
}

/** Reads a capture back for the viewer. */
export async function readStoredCapture(uri: string | undefined): Promise<string | null> {
  if (uri === undefined) return null
  try {
    const path = uri.startsWith('file://') ? decodeURIComponent(uri.slice('file://'.length)) : uri
    if (!(await ReactNativeBlobUtil.fs.exists(path))) return null
    return await ReactNativeBlobUtil.fs.readFile(path, 'utf8')
  } catch {
    return null
  }
}
