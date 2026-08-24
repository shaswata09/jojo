/**
 * The capture policy, as the extension can read it.
 *
 * A hand-written mirror of `service/kg/core/capture.ts`, and the duplication is
 * deliberate rather than lazy. The extension is not part of Vite's build — it is
 * loaded by the browser as plain files from disk — so it cannot import from
 * `@jojo/service`, and a build step that generated this would put a compile
 * between "edit the extension" and "reload it in the browser", which is the loop
 * this whole artifact lives in.
 *
 * What makes the copy safe is that it is CHECKED: `web/src/lib/capture-policy.test.ts`
 * imports both this file and the package's constants and fails if any list
 * differs. So the rule still has one owner — `core/capture.ts` — and this is a
 * transcription the gate refuses to let drift.
 *
 * Keep the shapes plain arrays and strings. The test compares them structurally,
 * and anything cleverer here becomes something the test has to model.
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
]

export const CAPTURE_STRIP_ATTRS = [
  'ping',
  'target',
  'srcset',
  'imagesrcset',
  'integrity',
  'crossorigin',
  'nonce',
]

export const CAPTURE_URL_ATTRS = ['src', 'href', 'poster', 'data', 'action', 'formaction']

export const CAPTURE_HREF_ATTR = 'data-jojo-href'

export const CAPTURE_LAZY_ATTRS = [
  'data-src',
  'data-delayed-url',
  'data-original',
  'data-lazy-src',
  'data-ghost-url',
]

export const CAPTURE_UNCLAMP_ATTR = 'data-jojo-unclamp'

export const CAPTURE_MAX_BYTES = 8 * 1024 * 1024
export const CAPTURE_MAX_ASSET_BYTES = 2 * 1024 * 1024

export const CAPTURE_SCHEMES = ['http:', 'https:']

/**
 * The hosts the worker will relay a MODEL request to.
 *
 * A transcription of the `endpoint` hosts in `service/kg/core/provider.ts`,
 * checked by `web/src/lib/capture-policy.test.ts` the same way everything else
 * here is — so the rule still has one owner and this cannot drift from it.
 *
 * WHY THERE IS A LIST AT ALL. Several of these providers send no CORS headers:
 * measured against `integrate.api.nvidia.com`, the preflight answers 200 with
 * `vary: Origin` and no `access-control-allow-origin` at all, so a browser
 * blocks the real request and the page reports a bare "Failed to fetch". The
 * extension is not a page and is not subject to that — which is why it can carry
 * the request, and exactly why it must not carry an arbitrary one. Its own
 * permissions are `http://*` and `https://*`; relaying whatever URL a page hands
 * it would turn it into an open proxy wearing jojo's privileges.
 *
 * Loopback is allowed separately and in code, because a local model server is on
 * a port the user chose and no list can name it.
 */
export const MODEL_HOSTS = [
  'api.anthropic.com',
  'api.openai.com',
  'openrouter.ai',
  'api.groq.com',
  'integrate.api.nvidia.com',
]
