/**
 * L1 — what a captured page IS, and what a capture is allowed to contain.
 *
 * A job posting is the one document in a search that belongs to somebody else.
 * The listing comes down the week after the interview and takes the requirements
 * with it, so jojo keeps a copy: the page as it read on the day it was filed.
 *
 * ## Why the rules are here and the serialiser is not
 *
 * Taking the copy needs a DOM — a real one, in a context that already holds the
 * user's session, because a posting behind a Workday or LinkedIn login is not
 * reachable any other way. On web that is an extension content script running in
 * the tab; on the phone it is a script injected into the app's own WebView. Both
 * are page contexts, neither is importable from here, and `check-platform.mjs`
 * bans a `Document` type in this layer outright.
 *
 * So the DOM WALK is written twice and the POLICY is written once. Everything
 * that decides what a capture may contain — which elements never survive, which
 * URL schemes are safe to keep, how big is too big — is a constant in this file,
 * and neither serialiser carries a list of its own: `web/extension/policy.js`
 * transcribes these arrays under a test that fails on any drift
 * (`web/src/lib/capture-policy.test.ts`), and `mobile/src/lib/capture-script.ts`
 * interpolates them straight into the script it injects, under a test of its own
 * (`mobile/src/lib/capture-script.test.ts`) that fails when a constant stops
 * being read.
 *
 * One exception, stated rather than glossed: the final SWEEP in each inliner
 * hardcodes its own attribute list, because it is a regex over a string rather
 * than a walk over elements and the two cannot share a spelling. It is
 * deliberately the same list as `REMOTE_REF` below and has to be changed with
 * it — three places, and nothing checks that they agree.
 *
 * That split is the honest one. Two DOM walks that agree because they were
 * written from one rule set is a maintainable duplication; two rule sets that
 * agree because somebody remembered is the `buildMonth` drift again.
 *
 * The walks are NOT in this file, and could not be. A DOM walk needs `Document`
 * and `Element`, `tsconfig.core.json` compiles this layer with `"lib":
 * ["ES2023"]` and no ambient types, and `check-platform.mjs` bans the globals
 * outright — which is the correct answer rather than an obstacle: this layer has
 * to compile inside a React Native bundle, where none of those exist.
 *
 * ## The invariant the whole feature rests on
 *
 * **A stored capture reaches the network never.** Not on capture — that part is
 * the platform's problem — but on VIEW, every time, forever. An archive that
 * phones out is worse than no archive: it turns "read my own notes" into a
 * tracking beacon fired at a company the user may be mid-negotiation with, from
 * an app whose entire promise is that nothing leaves the device.
 *
 * **And it rests on ONE mechanism, not two.** An earlier version of this comment
 * claimed the viewer's sandbox was a second lock — "scripts disabled inside a
 * sandbox that could not fetch anyway". That is false and worth stating plainly,
 * because it is the kind of false that makes people relax. `sandbox=""` blocks
 * scripts, forms, popups, top-level navigation and same-origin access; it does
 * NOT block subresource loads. An `<img>`, a `@font-face` or a
 * `background-image` inside a fully sandboxed frame fetches exactly as it would
 * anywhere else, and the phone's `originWhitelist` gates navigations rather than
 * fetches. There is no CSP on the viewer either.
 *
 * So the invariant is carried entirely by the capture: every subresource is
 * inlined as a `data:` URI, and anything that cannot be inlined is emptied
 * rather than kept. `remoteRefCount` below is the check that the emptying
 * actually happened, and it is the last line of defence rather than a
 * belt-and-braces second one. Treat a hole in it as a live beacon, because that
 * is what it is.
 *
 * A real second lock would be a `Content-Security-Policy` on the frame. That is
 * worth adding and is not here yet.
 */

import type { Instant } from './model'

/**
 * The only schemes a posting can live at, and the only ones stored as a source.
 *
 * Identical in spirit to `parse-posting.ts`'s `parseUrl`, and deliberately
 * restated rather than shared: that function's job is guessing an application
 * out of pasted text, and it retries a scheme-less string as `https://`, which
 * is exactly wrong here. A capture's source is not a guess — it is where the
 * bytes came from, and if that is not already an absolute http(s) URL then
 * whatever produced it was not a browser.
 */
export const CAPTURE_SCHEMES = ['http:', 'https:'] as const

/**
 * Schemes a subresource may still name inside a stored capture.
 *
 * `data:` because that is what inlining produces, and `about:` because
 * `about:blank` is what an emptied `<iframe src>` becomes. Everything else —
 * `http:`, `https:`, `blob:`, `filesystem:` and the two that are code rather
 * than content — is either a fetch or an execution, and neither belongs in an
 * archive.
 *
 * Note what is NOT here: `https:`. A capture that kept its remote image URLs
 * would render more faithfully on the day it was taken and would be a beacon
 * every day after.
 *
 * READ BY NOTHING, and kept deliberately rather than by neglect. Both walks
 * decide the same question the other way round — they ask what may be FETCHED
 * (`CAPTURE_SCHEMES`) and empty everything else — so this list is the statement
 * of what a well-formed capture may contain, which is what `remoteRefCount`
 * checks by exclusion. If a third platform ever validates a stored capture
 * rather than producing one, this is the constant it needs. Anyone deleting it
 * as dead should delete this paragraph with it and not merely the line.
 */
export const CAPTURE_SUBRESOURCE_SCHEMES = ['data:', 'about:'] as const

/**
 * Elements that never survive a capture, whatever they contain.
 *
 * `script` and `noscript` are the obvious pair — one is code and the other is
 * the fallback shown precisely when code is off, which is the state the viewer
 * renders in, so keeping it would show the reader "please enable JavaScript"
 * where the posting used to be.
 *
 * `iframe`, `frame`, `object` and `embed` are nested browsing contexts: each is
 * a second document with its own fetches, and a sandbox that covers the outer
 * page has to be reasoned about again for every one of them. Dropping them costs
 * an embedded map or video that would not have loaded offline anyway.
 *
 * `link` is here and `style` is not, which looks inconsistent and is not: a
 * `<link rel=stylesheet>` is a fetch by definition, and the serialiser's job is
 * to replace it with the `<style>` it resolves to. A `link` that survives to
 * this list is one the serialiser could not resolve.
 */
export const CAPTURE_STRIP_TAGS = [
  'script',
  'noscript',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'link',
  'base',
  'meta',
] as const

/**
 * Attributes stripped from every surviving element.
 *
 * Every `on*` handler, because markup can carry code without a `<script>` tag
 * and a viewer that ever gained scripts would gain them here first. `ping` and
 * `target` because they are navigation side effects. `srcset` and `imagesrcset`
 * because they are a SECOND set of URLs beside `src` — inline `src` and forget
 * `srcset` and the browser picks the remote one at the first resize, which is a
 * fetch that happens on a device rotation and nowhere in any test.
 *
 * `integrity` and `crossorigin` go because they only describe fetches that no
 * longer happen, and a stale `integrity` on an inlined resource is a
 * subresource-integrity failure that blanks the element.
 */
export const CAPTURE_STRIP_ATTRS = [
  'ping',
  'target',
  'srcset',
  'imagesrcset',
  'integrity',
  'crossorigin',
  'nonce',
] as const

/** Attributes that carry a URL and therefore have to be inlined or emptied. */
export const CAPTURE_URL_ATTRS = ['src', 'href', 'poster', 'data', 'action', 'formaction'] as const

/**
 * Where an anchor's destination goes, because it does not stay in `href`.
 *
 * A link is the one URL in a captured page that is not a fetch: nothing loads it
 * until somebody clicks. That made it look safe to keep, and it is not — the
 * viewer renders inside a sandbox that stops the frame navigating the TAB, and
 * stops scripts, and stops popups, and does not stop a click navigating the
 * FRAME. So one click on "Apply now" in a year-old capture loads the live site
 * inside the preview pane: a request to a company the user may be mid-offer
 * with, from an app that promised nothing leaves the device, at a moment when
 * they were reading their own notes.
 *
 * So the destination moves here and the anchor keeps its text. The page still
 * reads as it did — the words are the point — and nothing in the document can
 * navigate anywhere. What is lost is following a link out of an archive, which
 * was never going to be right anyway: the page it pointed at is as gone as the
 * posting.
 *
 * The consequence for `remoteRefCount` is what makes the scan tractable:
 * `<link>` and `<base>` are stripped entirely and anchors are rewritten, so ANY
 * surviving `href="http…"` is a serialiser bug rather than a judgement call.
 */
export const CAPTURE_HREF_ATTR = 'data-jojo-href'

/**
 * Where a lazily-loaded image keeps its real address.
 *
 * An image below the fold has not loaded when the capture is taken, so its
 * `src` is a placeholder, a transparent pixel, or absent — and the address the
 * loader was going to use sits in a `data-` attribute whose name every library
 * spells differently. LinkedIn keys on `data-delayed-url`.
 *
 * Ordered by how specific each one is. `data-src` is the near-universal
 * spelling and goes first; the rest are the ones actually seen on job boards.
 *
 * These are read, never kept. A `data-delayed-url` that survives into a stored
 * capture is inert — nothing left in the document reads it — but it is still a
 * list of CDN addresses sitting in the user's archive, so the walk consumes it
 * and the attribute goes.
 */
export const CAPTURE_LAZY_ATTRS = [
  'data-src',
  'data-delayed-url',
  'data-original',
  'data-lazy-src',
  'data-ghost-url',
] as const

/**
 * Marks an element the capture has un-clamped.
 *
 * The single biggest fidelity problem in a saved posting, and it is invisible
 * until a year later. LinkedIn renders the WHOLE job description into the DOM
 * and clamps it to five lines behind a "See more" button. A faithful capture
 * keeps the text and the clamp — and the button is inert, because scripts are
 * stripped. So the reader opens the archive they made precisely to reread the
 * requirements, and sees five lines and a dead control, with the rest of it in
 * the file and unreachable.
 *
 * Fidelity and usefulness are in direct opposition here and the capture has to
 * pick one. It picks readable: the serialiser detects clamping from the RENDERED
 * page — computed `-webkit-line-clamp`, or a `max-height` with hidden overflow
 * the content overruns — stamps this attribute on those elements, and appends
 * one rule that releases them. Detected rather than matched by class name,
 * because the class is different on every site and the computed style is not.
 */
export const CAPTURE_UNCLAMP_ATTR = 'data-jojo-unclamp'

/**
 * The cap on one stored capture, and on one inlined subresource.
 *
 * 8 MB total is roughly four times the largest posting measured with every
 * asset inlined, and is chosen against the thing that actually breaks: the web
 * store is IndexedDB, whose quota was measured at about 2 GB in Brave, and the
 * phone writes into app storage that a user cannot see filling up. A cap that
 * lets one page take 200 MB because it embedded a video is a cap that turns a
 * saved posting into a support question.
 *
 * The per-asset cap is what stops one hero image or one webfont eating the
 * whole budget before the text has been reached — the serialiser walks assets in
 * document order, and without a per-asset limit the first `<video poster>` on
 * the page can exhaust it.
 */
export const CAPTURE_MAX_BYTES = 8 * 1024 * 1024
export const CAPTURE_MAX_ASSET_BYTES = 2 * 1024 * 1024

/**
 * Extensions that name a saved page.
 *
 * NOT read by `kindOfFile` — that has its own `KIND_BY_EXT` map, which carries
 * these four among thirty others because it answers a different question ("what
 * kind is this file") for every kind at once. This list is the capture side's
 * own statement of what it produces, and the two are checked against each other
 * in `capture.test.ts` rather than shared, because collapsing them would put a
 * capture concern inside a map that thirty unrelated extensions also live in.
 */
export const CAPTURE_EXTENSIONS = ['html', 'htm', 'mhtml', 'mht'] as const

/**
 * What a platform serialiser hands back.
 *
 * Deliberately not a `VaultFile` and not a tool input: this is the wire shape
 * between a page context and the app, and both of the things producing it —
 * an extension's message and a WebView's `postMessage` — are strings that
 * crossed a trust boundary. It is parsed by `readCapture` below before anything
 * else in the app sees it.
 */
export type CaptureEnvelope = {
  /** The page's own address. Absolute, http(s). */
  url: string
  /** `document.title` at capture time, trimmed. May be empty — plenty of pages have none. */
  title: string
  /** The serialised document, assets already inlined. */
  html: string
  /** When the serialiser ran, from the platform's clock — never invented here (D26). */
  capturedAt: Instant
  /** Assets the serialiser could not inline and therefore dropped. Reported, never hidden. */
  dropped: number
  /**
   * Shadow roots the walk could not reach, and therefore parts of the page that
   * are simply absent from the copy.
   *
   * A shadow root cannot be serialised at all: `cloneNode` does not copy one and
   * `outerHTML` never writes one out. So the honest options were to say nothing
   * — which is a hole in the archive that looks like a page that failed to load
   * — or to count them and tell the user. This is the count, and it reaches the
   * file's note; a capture that lost a widget says so.
   */
  shadowRoots: number
}

/** Why a capture was refused. Each maps to a sentence the user reads. */
export type CaptureRejection = 'not-a-page' | 'bad-source' | 'empty' | 'too-large' | 'leaks'

export const CAPTURE_REJECTION_MESSAGE: Record<CaptureRejection, string> = {
  'not-a-page': 'That did not come back as a page.',
  'bad-source': 'A posting has to be an http or https address.',
  empty: 'The page came back empty — it may not have finished loading.',
  'too-large': 'That page is too big to keep. Try again once it has finished loading images.',
  leaks: 'The copy still points at the site it came from, so it was not kept.',
}

/** True when `url` is something a posting can actually live at. */
export function isCaptureSource(url: string): boolean {
  try {
    return (CAPTURE_SCHEMES as readonly string[]).includes(new URL(url).protocol)
  } catch {
    return false
  }
}

/**
 * Every remaining absolute-URL reference in a serialised capture.
 *
 * A regex over the markup rather than a parse, and that is a deliberate
 * downgrade: this runs on the app side, where there is no DOM on the phone, and
 * its job is not to understand the document but to answer one question — did the
 * serialiser miss anything. A false positive costs a refused capture the user
 * can retry; a parser dependency in `core` costs the layer rule.
 *
 * Three narrowings, each earned by a false positive that would have refused a
 * real posting.
 *
 * **Attribute names are spelled out** rather than matched as "anything = a URL",
 * so `data-jojo-href` can hold a rewritten anchor destination without tripping
 * the scan — `data-jojo-href="https://…"` and `href="https://…"` are identical
 * from the value rightwards, and only one is a fetch waiting to happen. (`data`
 * is on the list and does not catch `data-jojo-href`, because the name is
 * followed by `-` rather than `=`. Load-bearing, not luck.)
 *
 * **Anchored inside a tag** with `<[^>]*?`, because postings quote markup. One
 * measured against a fixture read `To embed it write &lt;img
 * src="https://example.com/x.png"&gt;` — the entity-escaped prose serialises
 * with real quotes, an unanchored pattern counted it as a leak, and
 * `readCapture` threw the whole capture away over the posting's own body text.
 * A reference outside a tag is not a fetch, so nothing is lost by requiring one.
 *
 * **Prose is left alone**, which is the same rule the sweep in each inliner
 * follows. The two have to agree: a scan stricter than the sweep refuses
 * captures the sweep considered clean, which is a rejection with no remedy.
 */
const REMOTE_REF =
  /<[^>]*?\s(?:src|srcset|imagesrcset|href|poster|data|action|formaction|background)\s*=\s*(["'])\s*(?:https?:|\/\/)[^"']*\1/gi

/**
 * The other half, and it was missing.
 *
 * The pattern above reads attribute NAMES, so it sees `src="https://…"` and is
 * blind to a URL that lives inside a VALUE — `style="background:url(https://…)"`
 * and every `url()` inside a `<style>` block. That is not hypothetical: a real
 * bug in the web serialiser shipped exactly that shape (an early `continue` skipped
 * the inline-style rewrite for `<img>`), and this scan reported zero while a live
 * CDN address sat in the stored file. A check that passes over the leak it exists
 * to find is worse than no check, because it is quoted as evidence.
 *
 * `url(` is matched anywhere rather than only in a style context, deliberately.
 * The cost is a false positive on a posting whose body text contains the literal
 * `url(https://…` — which refuses a capture the user can retry — and the benefit
 * is that a stylesheet reference cannot hide in a place the parser was not
 * looking. For an invariant whose failure is silent and permanent, that is the
 * right way round.
 */
const REMOTE_CSS_REF = /url\(\s*(['"]?)\s*(?:https?:|\/\/)[^)'"]*\1\s*\)/gi

/**
 * The third spelling, and the one that got through.
 *
 * `@import "https://…";` is a stylesheet fetch with no `url(` and no attribute,
 * so neither pattern above sees it. It reached a stored capture through a route
 * nothing was watching: the walk rewrote the imports it could see in the page's
 * own `<style>` blocks, then the inliner fetched a stylesheet and rewrote only
 * that sheet's `url()`s — so an `@import` INSIDE a fetched stylesheet survived
 * untouched, passed this scan, and was fetched by the viewer every time the
 * capture was opened.
 *
 * A leak that a check misses is worse than one it catches loudly, and this file
 * says the scan is the only line of defence. It has to know all three.
 */
const REMOTE_IMPORT_REF = /@import\s+(?:url\(\s*)?(['"]?)\s*(?:https?:|\/\/)[^)'";]*\1/gi

/** How many remote references survived. Zero is the only acceptable answer. */
export function remoteRefCount(html: string): number {
  /*
   * Counted as MERGED RANGES, not as three tallies added together.
   *
   * The patterns overlap on purpose — `@import url("https://…")` is both an
   * import and a `url()` — and they do not start at the same offset, so neither
   * summing them nor de-duplicating by start position gives the right answer.
   * Summing reported two leaks where there is one.
   *
   * The invariant only cares whether this is zero, so none of that changes
   * whether a capture is accepted. It changes what the user is told, and a
   * count that says two about one thing is a count nobody can act on.
   */
  const spans: [number, number][] = []
  for (const pattern of [REMOTE_REF, REMOTE_CSS_REF, REMOTE_IMPORT_REF]) {
    for (const match of html.matchAll(pattern)) {
      spans.push([match.index, match.index + match[0].length])
    }
  }
  if (spans.length === 0) return 0

  spans.sort((a, b) => a[0] - b[0])
  let count = 1
  let end = spans[0]![1]
  for (const [from, to] of spans.slice(1)) {
    if (from >= end) count += 1
    end = Math.max(end, to)
  }
  return count
}

/**
 * The trust boundary for a capture, and the only way one enters the app.
 *
 * Returns the envelope or the reason it was refused. Note the order: size is
 * checked before the leak scan, because the scan is a regex over the whole
 * document and a 200 MB string is exactly the input that should not reach it.
 */
export function readCapture(value: unknown): CaptureEnvelope | CaptureRejection {
  if (typeof value !== 'object' || value === null) return 'not-a-page'
  const raw = value as Record<string, unknown>

  const { url, title, html, capturedAt, dropped } = raw
  if (typeof url !== 'string' || typeof html !== 'string' || typeof capturedAt !== 'string') {
    return 'not-a-page'
  }
  if (!isCaptureSource(url)) return 'bad-source'
  if (html.trim().length === 0) return 'empty'
  if (byteLength(html) > CAPTURE_MAX_BYTES) return 'too-large'
  if (remoteRefCount(html) > 0) return 'leaks'

  const count = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0

  return {
    url,
    title: typeof title === 'string' ? title.trim() : '',
    html,
    capturedAt,
    dropped: count(dropped),
    shadowRoots: count(raw['shadowRoots']),
  }
}

/**
 * UTF-8 length without a TextEncoder.
 *
 * `TextEncoder` is a global, and `check-platform.mjs` is right to be suspicious
 * of those in this layer even where all three platforms happen to have one — the
 * point of the ban is that the layer states its own dependencies. Counting code
 * points is exact for the question being asked and needs nothing.
 */
function byteLength(text: string): number {
  let bytes = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
  }
  return bytes
}

/**
 * The filename a capture is filed under.
 *
 * Built from the page's own title where it has a usable one and from the host
 * otherwise, because a Vault full of `www-workday-com.html` is a Vault nobody
 * can read. The date is in the name rather than only in the record: a second
 * capture of the same posting a month later is a different document and should
 * not silently look like the same one, and the name is what the user sees when
 * they export the folder and open it somewhere jojo is not.
 *
 * Kept short — filesystems and IndexedDB keys both tolerate more than this, but
 * a 200-character name is unreadable in a list and unusable in a download.
 */
export function captureFileName(url: string, title: string, day: string): string {
  const stem = title.trim().length > 0 ? title : hostOf(url)
  const safe = stem
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
    .replace(/-+$/, '')
  return `${safe.length > 0 ? safe : 'posting'}-${day}.html`
}

/**
 * The address of a posting, rewritten to the one that opens without a login.
 *
 * Measured against LinkedIn: `/jobs/view/<id>` and `/jobs/view/<slug>-<id>` both
 * return the full description to a signed-OUT browser — the "See more" clamp is
 * CSS, and the whole body is in the DOM. But the two shapes people actually have
 * in hand redirect to the login wall: `/comm/jobs/view/<id>` is what a job-alert
 * email contains, and `?currentJobId=<id>` is what the LinkedIn app's share
 * sheet produces. Same posting, same id, three URLs, and only one of them works.
 *
 * So this is not a nicety. Without it the common case for the commonest job site
 * is "jojo showed me a login page", and with it the same paste captures cleanly
 * with no sign-in at all.
 *
 * Deliberately per-board, never generic. A blanket "strip tracking params" rule
 * would eventually drop a query parameter that IS the posting — the four boards
 * below all put identity in the PATH, but plenty of smaller ones use `?id=`, so
 * anything not recognised here is returned untouched rather than tidied.
 *
 * The other four were added when the scout started reading search-results pages,
 * and that is the context that makes them necessary rather than tidy: a results
 * page attaches its own tracking to every row it lists, so the same Greenhouse
 * job reached from a search and from a saved link differed only by `?gh_src=`
 * and read as two different jobs. Dedupe is only as good as this function, and
 * `isKnownPosting` is what the scout's "never propose one twice" promise rests
 * on — so a board this does not understand is a board the scout will nag about.
 */
export function canonicalPostingUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()

    if (host.endsWith('linkedin.com')) return linkedIn(parsed)
    if (host.endsWith('greenhouse.io')) return greenhouse(parsed)
    if (host.endsWith('lever.co')) return lever(parsed)
    if (host.endsWith('ashbyhq.com')) return ashby(parsed)
    if (host.endsWith('myworkdayjobs.com')) return workday(parsed, host)

    return url
  } catch {
    return url
  }
}

function linkedIn(parsed: URL): string {
  const fromQuery = parsed.searchParams.get('currentJobId')
  if (fromQuery !== null && /^\d+$/.test(fromQuery)) {
    return `https://www.linkedin.com/jobs/view/${fromQuery}/`
  }

  // `/comm/jobs/view/<id>` and `/jobs/view/<slug>-<id>` alike: take the digits
  // off the end of the view segment, which is the id in every spelling.
  const match = /\/jobs\/view\/(?:[^/?#]*?-)?(\d+)/.exec(parsed.pathname)
  if (match !== null) return `https://www.linkedin.com/jobs/view/${match[1]!}/`

  return parsed.href
}

/**
 * Two live hostnames for one board, and both are in circulation.
 *
 * `boards.greenhouse.io` is the old one and still resolves; `job-boards.` is
 * what the embed writes today. Folding to one is most of the value here — the
 * `?gh_src=` a search result carries is the other half.
 */
function greenhouse(parsed: URL): string {
  const match = /^\/(?:embed\/job_app\?for=)?([^/?#]+)\/jobs\/(\d+)/.exec(parsed.pathname)
  if (match === null) return parsed.href
  return `https://job-boards.greenhouse.io/${match[1]!}/jobs/${match[2]!}`
}

/** `/apply` is the same job with the form open, not a second job. */
function lever(parsed: URL): string {
  const match = /^\/([^/?#]+)\/([0-9a-f-]{16,})/i.exec(parsed.pathname)
  if (match === null) return parsed.href
  return `https://jobs.lever.co/${match[1]!}/${match[2]!.toLowerCase()}`
}

/** `/application` is Ashby's spelling of the same thing. */
function ashby(parsed: URL): string {
  const match = /^\/([^/?#]+)\/([0-9a-f-]{16,})/i.exec(parsed.pathname)
  if (match === null) return parsed.href
  return `https://jobs.ashbyhq.com/${match[1]!}/${match[2]!.toLowerCase()}`
}

/**
 * Workday puts the requisition id on the end of the last path segment, and the
 * rest of the path is the tenant's own site structure — which changes between
 * `/job/<location>/<slug>_<REQ>` and `/details/<slug>_<REQ>` for one posting.
 *
 * The req is unique within a tenant, and the tenant is the hostname, so host
 * plus req is the whole identity and everything between them is decoration.
 */
function workday(parsed: URL, host: string): string {
  const match = /_((?:R|JR|REQ)[-_]?\d{3,})(?:\/|$)/i.exec(parsed.pathname)
  if (match === null) return parsed.href
  return `https://${host}/${match[1]!.toUpperCase()}`
}

/**
 * The note a captured file carries, in the user's words.
 *
 * Written here rather than in each app because it is the same sentence on both
 * and it is the only place a capture's losses are ever surfaced — the counts
 * exist to be read, and a count nothing renders is a count nobody should have
 * bothered to make.
 */
export function captureNote(capture: CaptureEnvelope): string {
  const parts = [`Captured from ${hostOf(capture.url)}`]
  if (capture.dropped > 0) {
    parts.push(
      `${String(capture.dropped)} ${capture.dropped === 1 ? 'asset' : 'assets'} could not be kept`,
    )
  }
  if (capture.shadowRoots > 0) {
    parts.push(
      `${String(capture.shadowRoots)} ${capture.shadowRoots === 1 ? 'part' : 'parts'} of the page could not be copied`,
    )
  }
  return parts.join(' · ')
}

/** `https://boards.greenhouse.io/x/jobs/1` -> `boards.greenhouse.io`. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return 'posting'
  }
}
