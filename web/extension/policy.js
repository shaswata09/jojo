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
