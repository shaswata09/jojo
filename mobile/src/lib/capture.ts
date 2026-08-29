import ReactNativeBlobUtil from 'react-native-blob-util'
import {
  CAPTURE_MAX_ASSET_BYTES,
  CAPTURE_MAX_ASSETS,
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

/**
 * Fetched stylesheet text, made unable to close the element it is spliced into.
 *
 * The web inliner has had this since a sheet ending
 * `}</style><img src=https://evil.example/beacon.png>` was shown to close its
 * `<style>` block and write a live tag into the archive; the phone, which runs
 * the same splice on the same untrusted bytes, never got it. Reproduced here
 * before the fix: `inlineCapture` returned ok with
 * `<img alt="a > b" src=https://evil.example/beacon.png>` in the stored capture
 * and `remoteRefCount` calling the file clean.
 *
 * `<` is the only character that can end a `<style>` block, and `\3c ` is its
 * CSS escape — the trailing space is part of the escape and is consumed by the
 * CSS parser, so a rule that genuinely contained `<` renders identically.
 *
 * `<` ALONE is enough only while a `css` token always sits inside a `<style>`,
 * and that is a rule with a keeper rather than an assumption: `capture-script.ts`
 * drops an `@import` found in a style ATTRIBUTE instead of tokenising it, which
 * was the one path that put stylesheet text inside a quoted attribute value.
 */
const cssSafe = (css: string) => css.replace(/</g, '\\3c ')

/** What the injected script posts back, before anything trusts it. */
export type RawCapture = {
  type: string
  url?: string
  title?: string
  html?: string
  assets?: { href: string; kind: string }[]
  dropped?: number
  shadowRoots?: number
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
  /** Which resolved values are stylesheet TEXT. See the splice below. */
  const cssKeys = new Set<string>()
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
    if (i >= CAPTURE_MAX_ASSETS) {
      /*
       * The loop walks a list ITS OWN BODY APPENDS TO, and `byHref` only
       * collapses repeats of the same address — so a page whose sheets import
       * two FRESH ones apiece never ends. Measured on this file before the cap:
       * one asset produced 6001 requests, and the loop stopped only because the
       * harness had begun failing them. On a phone that is the Save button on
       * 'Keeping…' forever, over the user's mobile data, with nothing to do but
       * kill the app.
       *
       * Counted rather than silently truncated: `dropped` is what the note on
       * the file says. Their tokens are emptied by the sweep below exactly as a
       * failed fetch's are, so "inlined or gone" still holds.
       */
      dropped += assets.length - i
      break
    }
    const asset = assets[i]
    if (asset === undefined) continue
    const key = `__JOJO_ASSET_${String(i)}__`

    /*
     * Keyed by KIND as well as address, and this branch records `cssKeys` the
     * way the fetch path does.
     *
     * `capture-script.ts` mints a token per OCCURRENCE with no de-duplication of
     * its own, so two identical `<link rel=stylesheet>` tags — or a `<link>` and
     * an `@import` of the same sheet — produce two tokens for one address.
     * Without the `cssKeys.add` here the splice below would escape whichever
     * occurrence happened to be fetched and splice every later one raw, which is
     * escaping decided by iteration order. The kind is in the key because it
     * decides the escape and because the same address wanted as `css` (text) and
     * as `css-asset` (a data URI inside `url()`) must not hand one form of the
     * value to the other. The duplication this map exists to kill — the same
     * webfont in two `<style>` blocks — is same-kind and still collapses.
     */
    const cacheKey = `${asset.kind}\u0000${asset.href}`
    const seen = byHref.get(cacheKey)
    if (seen !== undefined) {
      resolved.set(key, seen)
      if (asset.kind === 'css') cssKeys.add(key)
      continue
    }

    try {
      // Timed out rather than hung: the loop is sequential, so one CDN that
      // never answers leaves the Save button on 'Keeping…' forever.
      const response = await withTimeout(asset.href)
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)

      if (asset.kind === 'css') {
        const text = await response.text()
        // Its own @imports first, then its own url()s — both queued onto the
        // list this loop walks, so one pass covers arbitrary nesting. The
        // @import half was missing and was a live leak: a FETCHED stylesheet
        // carrying `@import "https://…"` passed through untouched and the viewer
        // fetched it on every open.
        const withImports = text.replace(
          /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)[^;]*;?/gi,
          (whole, _q1: string, viaUrl: string, _q2: string, viaString: string) => {
            const raw = viaUrl || viaString || ''
            if (raw.trim().startsWith('data:')) return whole
            const nested = absolute(raw, asset.href)
            if (nested === null) {
              dropped += 1
              return ''
            }
            const at = assets.length
            assets.push({ href: nested, kind: 'css' })
            return `__JOJO_ASSET_${String(at)}__`
          },
        )
        const inlinedCss = withImports.replace(
          /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
          (whole, _q: string, url: string) => {
            const value = url.trim()
            if (value.startsWith('__JOJO_ASSET_')) return whole
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
        /*
         * `image-set()`, whose URL can be a BARE STRING.
         *
         * `image-set("https://cdn/x.png" 1x)` is a fetch with no `url(`, no
         * `@import` and no attribute name, so the two rewrites above walk past
         * it and every pattern in `remoteRefCount` was blind to it. Measured
         * before this ran: the address reached the stored capture untouched and
         * `readCapture` accepted the file. `capture-script.ts` tokenises the
         * same shape in the page's own CSS; this is the half that covers a
         * stylesheet fetched from the network.
         *
         * After the `url()` pass, so a `url()` inside an image-set is already a
         * token. The inner replace consumes a parenthesised group whole, which
         * keeps it off that token and off `type("image/avif")` — an image-set
         * option whose string is a MIME type rather than an address.
         *
         * Anchored on the literal `image-set(` rather than on a pattern that
         * absorbs the vendor prefix: a leading `[a-z-]*` rescans to the end of
         * every run of letters at every offset, and a 2 MB stylesheet made this
         * quadratic — measured as a test run that never finished. The prefix
         * stays outside the match, so `-webkit-image-set` is still rewritten.
         */
        const withImageSets = inlinedCss.replace(
          /(image-set\()((?:[^()"']|"[^"]*"|'[^']*'|\([^()]*\))*)\)/gi,
          (_whole, head: string, body: string) =>
            `${head}${body.replace(
              /\([^()]*\)|(['"])([^'"]*)\1/gi,
              (piece: string, _quote: string | undefined, url: string | undefined) => {
                if (url === undefined) return piece
                const value = url.trim()
                if (value === '' || value.startsWith('__JOJO_ASSET_')) return piece
                if (value.startsWith('data:')) return piece
                const nested = absolute(url, asset.href)
                if (nested === null) {
                  dropped += 1
                  // `url("")` rather than `none`: an image-set option has to be
                  // a URL, and `none` there invalidates the declaration.
                  return 'url("")'
                }
                const at = assets.length
                assets.push({ href: nested, kind: 'css-asset' })
                return `url("__JOJO_ASSET_${String(at)}__")`
              },
            )})`,
        )
        resolved.set(key, withImageSets)
        // Recorded rather than inferred. Only stylesheet TEXT is spliced as
        // markup-adjacent content and needs escaping; a data URI is base64 and
        // cannot contain `<` — but deciding that by sniffing the value would be
        // one refactor away from being wrong.
        cssKeys.add(key)
        byHref.set(cacheKey, withImageSets)
        continue
      }

      const blob = await response.blob()
      if (blob.size > CAPTURE_MAX_ASSET_BYTES) throw new Error('asset too large')
      const uri = await dataUri(blob)
      resolved.set(key, uri)
      byHref.set(cacheKey, uri)
    } catch {
      dropped += 1
      resolved.set(key, '')
      // Remembered as a failure too, so a page naming a dead asset ten times
      // makes one request rather than ten.
      byHref.set(cacheKey, '')
    }
  }

  let html = raw.html
  for (const [key, value] of resolved) {
    /*
     * Stylesheet text is spliced into the document, so it must not be able to
     * LEAVE the element it is spliced into.
     *
     * The token for a `<link rel=stylesheet>` sits inside a `<style>` block and
     * the value is whatever the remote server returned. A sheet ending
     * `}</style><img alt="a > b" src=https://evil.example/beacon.png>` closes
     * the block and writes a live tag into the archive — and it was written that
     * way precisely because the sweep below and `remoteRefCount` were both blind
     * to it. Both know it now; this stops the splice creating the tag at all,
     * which is the half that does not depend on a pattern being complete.
     */
    html = html.split(key).join(cssKeys.has(key) ? cssSafe(value) : value)
  }

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
  //
  // The value may be UNQUOTED. HTML does not require quotes and browsers honour
  // `src=https://…`, so a sweep that demanded them left the one shape
  // `remoteRefCount` was also blind to — a capture that beaconed on every
  // viewing while both checks reported it clean. The two must widen together:
  // a scan stricter than the sweep refuses captures with no remedy.
  //
  // And the anchor consumes QUOTED RUNS rather than stopping at the first `>`.
  // A `>` inside an attribute value is legal and unescaped — the HTML serialiser
  // escapes `&`, nbsp and `"` in a value and leaves `>` alone — so `<[^>]*?`
  // made one earlier attribute enough to hide every attribute after it.
  // Measured: `<img src=https://evil.example/b.png>` was emptied,
  // `<img alt="a > b" src=https://evil.example/b.png>` was not, and
  // `remoteRefCount` was blind in the same way from the same spelling. `<` must
  // be followed by an ASCII letter because that is exactly when the tokeniser
  // starts a tag. Identical to `REMOTE_REF` in `service/kg/core/capture.ts` —
  // a third copy lives in `web/extension/background.js`, and the three change
  // together.
  html = html.replace(
    /(<[a-zA-Z](?:[^>"']|"[^"]*"|'[^']*')*?\s(?:src|srcset|imagesrcset|href|poster|data|action|formaction|background)\s*=\s*)(?:(["'])\s*(?:https?:|\/\/)[^"']*\2|(?:https?:|\/\/)[^\s>]*)/gi,
    (_whole, head: string, quote: string | undefined) => {
      dropped += 1
      // An unquoted value is emptied by writing a quoted empty one, which is
      // valid HTML and cannot be re-read as a URL.
      const q = quote ?? '"'
      return `${head}${q}${q}`
    },
  )

  const read = readCapture({
    url: raw.url,
    title: raw.title ?? '',
    html,
    capturedAt: now,
    dropped,
    // Counted inside the WebView and thrown away here, until this line. The
    // phone was the only platform whose captures could not tell the user that
    // part of the page had been unreachable.
    shadowRoots: raw.shadowRoots,
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
    // `credentials: 'omit'` to match the extension. Without it RN's networking
    // stack shares the WebView's cookie jar, so the phone would inline
    // auth-gated assets the browser drops — the same page yielding a different
    // capture per platform, and this file's own header claiming the opposite.
    return await fetch(href, { signal: controller.signal, credentials: 'omit' })
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
