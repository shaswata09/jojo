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
 * fetches.
 *
 * So the invariant is carried first by the capture: every subresource is
 * inlined as a `data:` URI, and anything that cannot be inlined is emptied
 * rather than kept. `remoteRefCount` below is the check that the emptying
 * actually happened.
 *
 * The second lock is `lockedCaptureHtml`: the web viewer writes a
 * `Content-Security-Policy` into the document before rendering it, with
 * `default-src 'none'` and only `data:` let back in, so a reference every
 * pattern below missed is refused by the browser rather than fetched. It closes
 * the whole class — CSS escapes, entity-encoded schemes, SMIL — that a regex
 * scan can only chase one spelling at a time. It does not cover a capture opened
 * from a downloaded file or on the phone's viewer unless those add it too, so a
 * hole in the scan is still a live beacon somewhere.
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
 * The most addresses one capture will ever fetch.
 *
 * Both inliners walk a list THEIR OWN BODY APPENDS TO: a fetched stylesheet's
 * `@import`s and `url()`s are queued as they are discovered, and each of those
 * is a stylesheet that can queue more. The per-address de-duplication in each
 * one only collapses repeats of the SAME address, so a page whose sheets import
 * two FRESH ones apiece has no end — an unbounded fetch loop driven by the page
 * being captured. Measured on the phone before this cap reached it: 6001
 * requests from one asset, and the loop stopped only because the harness had
 * started failing them.
 *
 * Set far above what a real posting needs — the widest board measured while the
 * de-duplication was written queued 47 addresses — and far below forever.
 * Everything past it is counted as dropped, which is the outcome an asset that
 * failed to fetch already has.
 *
 * `web/extension/background.js` restates the number rather than reading it:
 * the extension is loaded from disk and imports `policy.js`, which transcribes
 * this file under `web/src/lib/capture-policy.test.ts` — and that test does not
 * carry this constant. Two copies, one owner, and the extension's copy is the
 * one to change with it.
 */
export const CAPTURE_MAX_ASSETS = 500

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
 * **Anchored inside a tag**, because postings quote markup. One measured
 * against a fixture read `To embed it write &lt;img
 * src="https://example.com/x.png"&gt;` — the entity-escaped prose serialises
 * with real quotes, an unanchored pattern counted it as a leak, and
 * `readCapture` threw the whole capture away over the posting's own body text.
 * A reference outside a tag is not a fetch, so nothing is lost by requiring one.
 *
 * The anchor used to be `<[^>]*?`, and that spelling could not cross a `>` —
 * which is legal, unescaped, and common inside an attribute VALUE, because the
 * HTML serialiser escapes `&`, nbsp and `"` in a value and leaves `>` alone. So
 * one earlier attribute carrying a `>` blinded the scan to every attribute after
 * it. Measured: `<img src="https://evil.example/b.png">` counted 1, and
 * `<img alt="a > b" src="https://evil.example/b.png">` counted 0 — the same
 * address, one attribute earlier, invisible. The `>` did not even have to be on
 * a tag of the attacker's choosing beyond the one it was leaking from.
 *
 * It now walks a tag the way the tokeniser does: quoted runs are consumed whole
 * (`"[^"]*"` / `'[^']*'`) and only an UNQUOTED `>` ends the tag. `<` must be
 * followed by an ASCII letter for the same reason — that is exactly when the
 * tokeniser starts a tag, and it keeps a stray `<` inside a `<style>` block from
 * opening a scan that runs to the end of the document.
 *
 * **Prose is left alone**, which is the same rule the sweep in each inliner
 * follows. The two have to agree: a scan stricter than the sweep refuses
 * captures the sweep considered clean, which is a rejection with no remedy.
 *
 * **Unquoted values count too**, and leaving them out was a hole in the one
 * check this file calls the last line of defence. HTML does not require quotes
 * and every browser honours `<img src=https://evil.example/beacon.png>` — but
 * the pattern demanded a quote it could backreference, so that shape scanned as
 * ZERO remote references and a stored capture beaconed on every viewing.
 * Measured: quoted 1, single-quoted 1, unquoted 0, protocol-relative unquoted 0.
 *
 * The unquoted arm ends at whitespace or `>`, which is exactly where the HTML
 * tokeniser ends an unquoted attribute value.
 */
const SCHEME = String.raw`(?:h[\t\n\r]*t[\t\n\r]*t[\t\n\r]*p[\t\n\r]*(?:s[\t\n\r]*)?:|[\\/][\t\n\r]*[\\/])`
/** The unquoted spelling: a tab or newline ENDS an unquoted value, so none can sit inside. */
const SCHEME_BARE = String.raw`(?:https?:|[\\/]{2})`
/** Whatever the URL parser strips off the front of a value: C0 controls and space. */
const LEAD = String.raw`[\x00-\x20]*`
/** A tag, walked the way the tokeniser walks one — quoted runs whole, only an unquoted `>` ends it. */
const TAG = String.raw`<[a-zA-Z](?:[^>"']|"[^"]*"|'[^']*')*?`

/*
 * The scheme is spelled loosely ON PURPOSE (`SCHEME` above), and each loosening
 * is a spelling the URL parser accepts and the old `https?:|\/\/` did not:
 * ASCII tab and newline are deleted from anywhere in a URL (`h<TAB>ttps://`),
 * leading C0 controls and spaces are trimmed, and a backslash is a slash in a
 * special scheme — `\\evil.example/x` against an https base is protocol-
 * relative. A serialiser rewrites all of those correctly, because it resolves
 * with `new URL`; this scan is the check that it did, so it has to read them as
 * the parser does.
 *
 * `xlink:href` is on the name list because the old `\s(?:…href)` needed
 * whitespace before `href` and an SVG link has a colon there — the walk handled
 * it and nothing checked that it had.
 */
const REMOTE_REF = new RegExp(
  String.raw`${TAG}\s(?:xlink:)?(?:src|href|poster|data|action|formaction|background)\s*=\s*(?:["']${LEAD}${SCHEME}|${SCHEME_BARE})`,
  'gi',
)

/**
 * `srcset` names one URL PER CANDIDATE, and only the first sat where
 * `REMOTE_REF` looks: `srcset="data:… 1x, https://cdn/big.png 2x"` passed with
 * the 2x image live, to be fetched on the first high-density screen. Every
 * candidate is read here. `https?:` anywhere in the value counts (a base64
 * payload has no `:`), and `//` only after whitespace or the opening quote,
 * because base64 does contain `/` and a `,//8A…` payload is not an address.
 */
const REMOTE_SRCSET_REF = new RegExp(
  String.raw`${TAG}\s(?:srcset|imagesrcset)\s*=\s*(?:"(?:[^"]*?https?:|(?:[^"]*?\s)?[\\/]{2})|'(?:[^']*?https?:|(?:[^']*?\s)?[\\/]{2})|${SCHEME_BARE})`,
  'gi',
)

/**
 * SVG animation writes an attribute at VIEW time: `<set attributeName="href"
 * to="https://…">` gives an `<image>` a live address after every check here
 * has read it as having none. SMIL runs with scripts off, so the sandbox does
 * not stop it. Any URL in an animation value counts — `values` is a `;` list, so
 * not just at the start.
 */
const REMOTE_ANIMATION_REF = new RegExp(
  String.raw`${TAG}\s(?:to|from|by|values)\s*=\s*(?:"[^"]*?${SCHEME}|'[^']*?${SCHEME}|${SCHEME_BARE})`,
  'gi',
)

/**
 * `<meta http-equiv=refresh content="0;url=https://…">` navigates the frame on
 * open, with no attribute this file names. Both walks strip every refresh, so
 * one surviving is a walk that missed it.
 */
const REMOTE_REFRESH_REF = new RegExp(
  String.raw`<meta\b(?:[^>"']|"[^"]*"|'[^']*')*?\shttp-equiv\s*=\s*["']?\s*refresh`,
  'gi',
)

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
/*
 * Matched up to the scheme and no further. It used to demand the closing quote
 * and `)` as well, with `[^)'"]*` between — and so `url("https://x/a)b.png")`,
 * a `)` legally inside a quoted URL, scanned as clean. Reaching the scheme is
 * already the whole finding. `src()` is the CSS Values 4 spelling of the same
 * function.
 */
const REMOTE_CSS_REF = new RegExp(String.raw`(?:url|src)\(\s*["']?${LEAD}${SCHEME}`, 'gi')

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
// `\s*`, not `\s+`: `@import"https://…"` needs no space and is honoured.
const REMOTE_IMPORT_REF = new RegExp(String.raw`@import\s*(?:url\(\s*)?["']?${LEAD}${SCHEME}`, 'gi')

/**
 * The fourth spelling, and the only one with no `url(` and no attribute at all.
 *
 * `image-set()` takes a BARE STRING as well as a `url()`:
 * `background-image: image-set("https://cdn/x.png" 1x, "https://cdn/x@2x.png" 2x)`
 * is a live fetch that the pattern above cannot see (no attribute name),
 * `REMOTE_CSS_REF` cannot see (no `url(`) and `REMOTE_IMPORT_REF` cannot see
 * (no `@import`). Measured before this existed: `remoteRefCount` returned 0 and
 * `readCapture` ACCEPTED a document with a live CDN address in it, in all three
 * spellings — `image-set`, `-webkit-image-set`, and single-quoted.
 *
 * Both serialisers tokenise those strings now (`queueCssUrls` in
 * `web/extension/serialise.js` and in `mobile/src/lib/capture-script.ts`, and
 * the fetched-stylesheet rewrite in each inliner), so this is the check that
 * the tokenising happened rather than a stricter rule than the sweep.
 *
 * The body pattern cannot leave the `image-set(` it started in: a `)` is
 * consumed only as part of a balanced `\([^()]*\)`, so a bare closing paren
 * ends the match rather than letting it run on to a quoted URL elsewhere in the
 * document. A `url("https://…")` INSIDE an image-set is therefore not counted
 * here — `REMOTE_CSS_REF` already counts it, and the merged-range tally below
 * would collapse the two anyway.
 */
const REMOTE_IMAGE_SET_REF = new RegExp(
  String.raw`image-set\((?:[^()"']|\([^()]*\)|"[^"]*"|'[^']*')*?["']?${LEAD}${SCHEME}`,
  'gi',
)

/**
 * A CSS identifier spelled with an escape: `u\72 l(…)`, `@\69mport "…"`.
 *
 * The CSS parser decodes escapes in identifiers, so those ARE `url(` and
 * `@import` — and every pattern above, and both serialisers' tokenisers, read
 * the literal letters and walked past them. Measured: a `<style>` carrying
 * `.a{background:u\72 l(https://…)}` scanned as clean and fetched on view.
 *
 * Refused whatever it points at. The web serialiser round-trips page CSS
 * through the CSSOM, which writes escapes back out as plain letters, so an
 * escaped `url` surviving to here is one no tokeniser ever saw — and its target,
 * relative or not, was never inlined.
 */
// One maximal identifier run per match, greedy and with nothing to backtrack
// into, so an 8 MB document is one linear pass rather than a quadratic one.
const CSS_IDENT_RUN = /@?(?:[\w-]|\\(?:[0-9a-f]{1,6}[ \t\r\n\f]?|[^\r\n\f0-9a-f]))+/gi

const PATTERNS = [
  REMOTE_REF,
  REMOTE_SRCSET_REF,
  REMOTE_ANIMATION_REF,
  REMOTE_REFRESH_REF,
  REMOTE_CSS_REF,
  REMOTE_IMPORT_REF,
  REMOTE_IMAGE_SET_REF,
]

/** The identifiers an escape must not be allowed to spell. */
const FETCHING_IDENTS = new Set(['url', 'src', '@import', 'image-set', '-webkit-image-set'])

/**
 * The ASCII named references that can spell part of a URL or a CSS token.
 *
 * Not the whole HTML table: every other named reference decodes to something
 * outside ASCII, which cannot form a scheme or a bracket. `lt`/`gt` are
 * deliberately absent, and the quotes decode to a SPACE — see `safeChar`.
 */
const NAMED: Record<string, string> = {
  quot: ' ',
  apos: ' ',
  amp: '&',
  colon: ':',
  sol: '/',
  bsol: '\\',
  lpar: '(',
  rpar: ')',
  period: '.',
  comma: ',',
  semi: ';',
  equals: '=',
  num: '#',
  commat: '@',
  percnt: '%',
  quest: '?',
  excl: '!',
  plus: '+',
  lowbar: '_',
  hyphen: '-',
  dash: '-',
  tab: '\t',
  newline: '\n',
}

/**
 * One decoded code point, with the three that would change the document's
 * STRUCTURE held back.
 *
 * `<` and `>` stay encoded. Decoding them would turn a posting's prose about
 * markup (`&lt;img src="https://…"&gt;`) into a tag and refuse the capture over
 * its own body text; and cssSafe's `\3c ` exists precisely so a hostile sheet's
 * `</style><img…>` never becomes one.
 *
 * A quote becomes a SPACE. Every pattern above accepts a URL with no quote
 * before it, so `url(&quot;https://…` still reads as `url( https://…` and is
 * caught — while the real quotes that delimit attribute values keep their
 * pairing. A decoded `"` inside `style="…"` would end that value early for the
 * tag walk, the walk would pair quotes off by one from there on, and one tag
 * could be scanned to the end of an 8 MB document.
 */
const safeChar = (code: number, original: string): string => {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return original
  if (code === 0x3c || code === 0x3e) return original
  if (code === 0x22 || code === 0x27) return ' '
  return String.fromCodePoint(code)
}

/**
 * The document as the browser will READ it, for the patterns above.
 *
 * `outerHTML` writes `style="background-image: url(&quot;https://…&quot;)"`,
 * and an attacker can write `https&#58;//` — both are a live URL to the parser
 * and neither matched a pattern that wants a literal quote and colon. So the
 * patterns are also run over a copy with character references decoded, then CSS
 * escapes decoded (`\68 ttps`), in the order the browser applies them to a
 * `style` attribute.
 *
 * A second copy has CSS comments removed outside strings, because a comment
 * between `url(` and its quoted string, or between `@import` and its string, is
 * honoured and no pattern spans one. It is a SEPARATE copy rather than this one
 * with a step added, because a comment opener the stripper misreads (inside a
 * string it failed to track) could then swallow a URL the decoded copy shows.
 */
function decoded(html: string): string {
  return cssUnescaped(entities(html))
}

/** Character references decoded, except to `<` and `>`. */
function entities(html: string): string {
  return html
    .replace(/&#x([0-9a-f]+);?/gi, (whole, hex: string) => safeChar(parseInt(hex, 16), whole))
    .replace(/&#(\d+);?/g, (whole, dec: string) => safeChar(parseInt(dec, 10), whole))
    .replace(/&([a-z]+);/gi, (whole, name: string) => NAMED[name.toLowerCase()] ?? whole)
    .replace(/&(quot|amp|apos)(?![;a-z0-9=])/gi, (whole, name: string) => NAMED[name.toLowerCase()] ?? whole)
}

/** CSS escapes decoded, except to `<` and `>`. */
function cssUnescaped(text: string): string {
  return text
    .replace(/\\([0-9a-f]{1,6})[ \t\r\n\f]?/gi, (whole, hex: string) => safeChar(parseInt(hex, 16), whole))
    .replace(/\\([^\r\n\f0-9a-f])/gi, (_whole, ch: string) => (ch === '"' || ch === "'" ? ' ' : ch))
}

// An unclosed comment runs to the end, as the CSS tokeniser reads it — and as
// `$` lets the lazy body stop there in one pass instead of rescanning the rest
// of the document from every later `/*`.
const uncommented = (css: string): string =>
  css.replace(
    /("(?:[^"\\\n]|\\[\s\S])*"|'(?:[^'\\\n]|\\[\s\S])*')|\/\*[\s\S]*?(?:\*\/|$)/g,
    (_w, kept?: string) => kept ?? ' ',
  )

/** Merged-range count of every pattern over one spelling of the document. */
function spansIn(html: string): number {
  const spans: [number, number][] = []
  for (const pattern of PATTERNS) {
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

/** Escaped identifiers that spell a fetching CSS function. Read off the entity-decoded text. */
function escapedIdents(html: string): number {
  if (!html.includes('\\')) return 0
  let count = 0
  for (const match of html.matchAll(CSS_IDENT_RUN)) {
    const run = match[0]
    if (!run.includes('\\')) continue
    // Only where it is used as a function or an at-rule: followed by `(` or a
    // string, as `url(`, `image-set(` and `@import "…"` are.
    if (!/^\s*[("']/.test(html.slice(match.index + run.length, match.index + run.length + 8))) continue
    if (FETCHING_IDENTS.has(cssUnescaped(run).toLowerCase())) count += 1
  }
  return count
}

/** How many remote references survived. Zero is the only acceptable answer. */
export function remoteRefCount(html: string): number {
  /*
   * Counted as MERGED RANGES, not as tallies added together.
   *
   * The patterns overlap on purpose — `@import url("https://…")` is both an
   * import and a `url()` — and they do not start at the same offset, so neither
   * summing them nor de-duplicating by start position gives the right answer.
   * Summing reported two leaks where there is one.
   *
   * Then the LARGEST count across the three spellings (as written, decoded,
   * decoded without comments), not their sum: they are one document read three
   * ways, and offsets do not line up between them. Zero means zero in all three.
   *
   * The invariant only cares whether this is zero. The count is what the user
   * is told, and a count that says two about one thing is one nobody can act on.
   */
  const plain = decoded(html)
  return (
    Math.max(spansIn(html), spansIn(plain), spansIn(uncommented(plain))) +
    escapedIdents(entities(html))
  )
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
 * The policy a captured page is VIEWED under: nothing but `data:`.
 *
 * `default-src 'none'` refuses every fetch, then images, fonts, media and
 * stylesheets are let back in from `data:` alone — which is everything inlining
 * produces. `'unsafe-inline'` for styles because a capture IS inline styles;
 * there is no script to abuse it, and `default-src 'none'` covers `script-src`.
 * `base-uri` and `form-action` do not fall back to `default-src`, so they are
 * named.
 */
export const CAPTURE_VIEW_CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline' data:; font-src data:; media-src data:; base-uri 'none'; form-action 'none'"

/**
 * A stored capture with the viewer's policy written in as the FIRST thing in
 * its head — the second lock that the header of this file describes.
 *
 * `sandbox=""` on the frame stops scripts, forms and navigation and stops no
 * fetch at all, so before this every hole in `remoteRefCount` was a live beacon.
 * A `<meta http-equiv>` CSP inside a `srcdoc` document is honoured, and it
 * applies to everything parsed after it, so where it goes is the whole design:
 *
 *   - after a leading doctype (and any comments before it), never before — a
 *     `<meta>` ahead of the doctype makes the doctype a parse error and the page
 *     renders in quirks mode;
 *   - and before EVERYTHING else, including the document's own `<html>` and
 *     `<head>`. A `<meta>` there opens an implied `<html>` and `<head>` and lands
 *     in it; the page's own `<html lang>` then merges its attributes into that
 *     element and its `<head>` is ignored, which is the tokeniser's ordinary
 *     recovery. So it works the same with a head, without one, and ahead of a
 *     hostile early `<meta>` or `<link>` the page put first — nothing in the
 *     stored text can come before it.
 *
 * Policies combine by intersection, so a page that carried a looser CSP of its
 * own (both walks strip those anyway) cannot widen this one.
 */
export function lockedCaptureHtml(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${CAPTURE_VIEW_CSP}">`
  const lead = /^﻿?(?:\s|<!--[\s\S]*?-->)*(?:<!doctype[^>]*>)?/i.exec(html)
  // Only past the comments when a doctype follows them: a meta between a
  // comment and the first tag is in the same place as one at the very start.
  const at = lead !== null && /<!doctype/i.test(lead[0]) ? lead[0].length : 0
  return `${html.slice(0, at)}${meta}${html.slice(at)}`
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
  /*
   * NFKC and the marks KEPT. This was NFKD with `\p{M}` stripped, which is how
   * to fold `é` to `e` and is wrong for every script whose marks are letters'
   * vowels: 'हिन्दी' came out 'हनद'. Composed form keeps Latin accents as one
   * character and leaves Devanagari, Thai or Arabic exactly as written.
   *
   * Cut by CODE POINT rather than `.slice`: a UTF-16 slice through an emoji or
   * a supplementary-plane character leaves a lone surrogate, which is not a
   * character at all and which some filesystems refuse.
   */
  const safe = [
    ...stem
      .normalize('NFKC')
      .replace(/[^\p{L}\p{M}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-'),
  ]
    .slice(0, 60)
    .join('')
    .replace(/-+$/, '')
  return `${safe.length > 0 ? safe : 'posting'}-${day}.html`
}

/**
 * Whether a host IS a board's domain, or sits under it.
 *
 * A bare `endsWith` is not that test, and the difference is a real
 * host rather than a hypothetical one: `careers.unilever.co` ends with
 * `lever.co`, `jobs.clever.co` does too, and `evergreenhouse.io` ends with
 * `greenhouse.io`. Any of them with a path shaped like the board's was read as
 * that board — canonicalised onto the board's own URL shape, deduplicated
 * against real postings there, and filed under the wrong employer.
 *
 * The dot is the whole fix: a domain matches itself, or something one label
 * below it, and nothing that merely ends with the same letters.
 */
export const onBoard = (host: string, domain: string): boolean =>
  host === domain || host.endsWith(`.${domain}`)

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

    if (onBoard(host, 'linkedin.com')) return linkedIn(parsed)
    if (onBoard(host, 'greenhouse.io')) return greenhouse(parsed)
    if (onBoard(host, 'lever.co')) return lever(parsed)
    if (onBoard(host, 'ashbyhq.com')) return ashby(parsed)
    if (onBoard(host, 'myworkdayjobs.com')) return workday(parsed, host)
    if (onBoard(host, 'academicjobsonline.org')) return academicJobsOnline(parsed)
    if (onBoard(host, 'higheredjobs.com')) return higherEdJobs(parsed, host)
    if (onBoard(host, 'indeed.com')) return indeed(parsed, host)

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
  /*
   * The embed form, `/embed/job_app?for=<board>&token=<job>`. Its identity is in
   * the QUERY, and this used to test `?for=` against the pathname — which never
   * contains a `?` — so the embed spelling never folded onto the job it is.
   */
  if (/^\/embed\/job_app\/?$/.test(parsed.pathname)) {
    const board = parsed.searchParams.get('for')
    const token = parsed.searchParams.get('token')
    if (board !== null && /^[\w-]+$/.test(board) && token !== null && /^\d+$/.test(token)) {
      return `https://job-boards.greenhouse.io/${board}/jobs/${token}`
    }
    return parsed.href
  }
  const match = /^\/([^/?#]+)\/jobs\/(\d+)/.exec(parsed.pathname)
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
 * AcademicJobsOnline lists an "Apply" link beside every posting —
 * `/ajo/jobs/32236/apply` — and the scout reads both off one results page. The
 * number is the job; anything after it is the same job with a form open.
 */
function academicJobsOnline(parsed: URL): string {
  const match = /^\/ajo\/jobs\/(\d+)/.exec(parsed.pathname)
  if (match === null) return parsed.href
  return `https://academicjobsonline.org/ajo/jobs/${match[1]!}`
}

/**
 * HigherEdJobs names a job by `JobCode` and repeats its title in a `Title`
 * parameter that changes whenever the employer edits the advert. The code is
 * the identity; the section in the path (`/faculty/`, `/admin/`) is kept, since
 * that is the address the board itself serves.
 */
function higherEdJobs(parsed: URL, host: string): string {
  const code = parsed.searchParams.get('JobCode')
  if (code === null || !/^\d+$/.test(code) || !/details\.cfm$/i.test(parsed.pathname)) return parsed.href
  return `https://${host}${parsed.pathname}?JobCode=${code}`
}

/**
 * Indeed names a job by `jk` on `/viewjob`, and by `vjk` on a search page —
 * `/jobs?q=…&vjk=<id>` is the results list with that job open beside it. Both
 * fold to the `/viewjob` address, which is the one that opens the job alone.
 * The regional host (`ca.indeed.com`) is kept: it is the board that served it.
 */
function indeed(parsed: URL, host: string): string {
  const viewing = /^\/viewjob\/?$/i.test(parsed.pathname) ? parsed.searchParams.get('jk') : null
  const id = viewing ?? parsed.searchParams.get('vjk')
  if (id === null || !/^[0-9a-f]{8,32}$/i.test(id)) return parsed.href
  return `https://${host}/viewjob?jk=${id.toLowerCase()}`
}

/**
 * Query parameters put there by whatever the link was copied FROM, never by the
 * posting.
 *
 * Which way to be wrong decides this list. Drop a parameter that IDENTIFIES a
 * posting and every job on that board becomes the same job — the bug this list
 * replaced. Keep a tracking parameter by mistake and one warning is missed,
 * which is the direction a warning nobody asked for should fail in. So a name
 * goes in only when it identifies nothing anywhere: `utm_*` and the click ids,
 * the referral fields, and `gh_src`, which is the one a Greenhouse search
 * result adds to a link the ad itself does not have.
 *
 * NOT `vjk`, which was here and merged jobs: on Indeed's `/jobs?q=…&vjk=<id>`
 * search page `vjk` is the job open in the side pane — the posting's own key —
 * so every job viewed from one search folded to one identity. `indeed` below
 * rewrites that shape to `/viewjob?jk=<id>` instead.
 */
const TRACKING = new Set([
  'gh_src',
  'src',
  'source',
  'ref',
  'referer',
  'referrer',
  'from',
  'trk',
  'trackingid',
  'refid',
  'tk',
  'gclid',
  'fbclid',
  'msclkid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'mkt_tok',
  '_hsenc',
  '_hsmi',
])

const isTracking = (name: string): boolean => {
  const key = name.toLowerCase()
  return key.startsWith('utm_') || TRACKING.has(key)
}

/**
 * A URL reduced to what identifies the posting: host without `www.`, path
 * without its trailing slash, and the query minus its tracking. The scheme
 * goes, and the fragment too unless it is a route (see `addressKey`).
 * `undefined` for anything that is not a usable address.
 *
 * THE ONE ANSWER to "are these the same posting", and it lives here because
 * three places were answering it differently. The duplicate warning compared
 * host and path; the capture filing (`web/src/lib/file-capture.ts`) compared
 * origin and path; the posting lookup (`core/posting-source.ts`) compared the
 * whole query, tracking included. So one board could warn about a job you had
 * never saved, file its page under a different application, and then fail to
 * find that page from the application it did belong to.
 *
 * THE QUERY IS KEPT, and that is the whole of this function's history. It used
 * to be dropped, on the reasoning that a query is what a copied link picks up —
 * true of `?utm_campaign=`, and false of the boards that put the job id there.
 * Measured 2026-09-11: every HigherEdJobs posting is
 * `/faculty/details.cfm?JobCode=…`, so all of them reduced to one key and the
 * form warned "you already saved this posting" about every job on the site.
 * Indeed (`/viewjob?jk=`), Taleo (`jobdetail.ftl?job=`) and a Greenhouse board
 * embedded in a company's own page (`/jobs/search?gh_jid=`) all failed the same
 * way. `core/posting-source.ts` had already learned this and says so.
 *
 * `canonicalPostingUrl` above runs first, so the boards with a known shape —
 * LinkedIn, Greenhouse, Lever, Ashby, Workday — fold to one spelling before
 * anything here compares them, and this is left with the boards nobody has
 * taught it. A scheme is added to a bare `board.test/jobs/1`, because the field
 * an application carries is one somebody typed.
 */
export function postingIdentity(raw: string): string | undefined {
  return addressKey(raw, true)
}

/** Analytics parameters, which never name a page of a listing either. */
const ANALYTICS = new Set(['gclid', 'fbclid', 'msclkid', 'igshid', 'mc_cid', 'mc_eid', '_hsenc', '_hsmi'])

/**
 * The same reduction for a page of a board's LISTING (`core/board.ts`'s
 * `pageKey`), which is a different question in two ways.
 *
 * No posting canonicalisation: a LinkedIn search page carrying `currentJobId`
 * is a list, and folding it to that one job would make every page of the search
 * the same page. And only analytics parameters go, not `TRACKING`: `from`,
 * `src` and `ref` identify nothing on a posting, but `?from=20` is how some
 * boards say "page two", and dropping it ended a read after page one.
 */
export function pageIdentity(raw: string): string | undefined {
  return addressKey(raw, false)
}

function addressKey(raw: string, posting: boolean): string | undefined {
  const text = raw.trim()
  if (!text) return undefined
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`
  try {
    const canonical = posting ? canonicalPostingUrl(withScheme) : withScheme
    const url = new URL(canonical)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    const path = url.pathname.replace(/\/+$/, '')
    // Read off `search` rather than `searchParams`: this layer compiles for
    // React Native, where its `URL` carries only `get` and `has` (D26's
    // platform floor), and a key needs every parameter rather than named ones.
    //
    // Sorted, so the same posting reached with its parameters in another order
    // is the same key. Names are folded and values are not: `JobCode` and
    // `jobcode` are one parameter, and two different ids are two postings.
    const identifying = url.search
      .replace(/^\?/, '')
      .split('&')
      .filter((pair) => pair !== '')
      .map((pair) => {
        const at = pair.indexOf('=')
        return at === -1
          ? ([pair, ''] as const)
          : ([pair.slice(0, at), pair.slice(at + 1)] as const)
      })
      .filter(([name]) =>
        posting
          ? !isTracking(name)
          : !name.toLowerCase().startsWith('utm_') && !ANALYTICS.has(name.toLowerCase()),
      )
      .map(([name, value]) => `${name.toLowerCase()}=${value}`)
      .sort()
    /*
     * The fragment, kept only where it is the ADDRESS. On most sites `#apply`
     * is a scroll position and two links differing by it are one posting; on a
     * hash-routed board `#/job/123` and `#/job/456` are two jobs that used to
     * collapse into one key, so the second was reported as already saved.
     * `#/` and `#!` are the router spellings; a fragment on an empty path is
     * the only thing telling two addresses apart at all. Read from the TEXT,
     * because `hash` is not among the URL members this layer may use.
     */
    const hashAt = canonical.indexOf('#')
    const fragment = hashAt === -1 ? '' : canonical.slice(hashAt)
    const routed = /^#[/!]./.test(fragment) || (path === '' && fragment.length > 1) ? fragment : ''
    const base = identifying.length === 0 ? `${host}${path}` : `${host}${path}?${identifying.join('&')}`
    return `${base}${routed}`
  } catch {
    return undefined
  }
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
