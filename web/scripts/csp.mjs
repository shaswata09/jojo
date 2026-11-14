/**
 * Adds `script-src` and `worker-src` to the built page's Content-Security-Policy.
 *
 * At BUILD time, by `vite.config.ts`, and not written into `index.html` by hand:
 *
 *  - The one inline script — the theme resolver, which must run before first
 *    paint — is allowed by its sha256. Computed here from the HTML the build
 *    actually emits, so editing the script cannot leave a stale hash behind
 *    that blocks it (and a blocked theme script fails silently: a flash of the
 *    wrong theme, nothing in the console a person would read).
 *  - The dev server injects inline scripts of its own (React's refresh
 *    preamble), with no stable hash. A policy in the source file would break
 *    `npm run dev`; one added at build time never meets them.
 *
 * What the policy allows, and why each is needed:
 *
 *   'self'                every chunk is served from jojo's own origin.
 *   'sha256-…'            the theme resolver, as above.
 *   'wasm-unsafe-eval'    WebAssembly compilation. The mascot's runtime
 *                         (Spline: physics, navmesh, boolean ops) and pdf.js
 *                         instantiate wasm; without this they throw on load.
 *                         It allows wasm only — not `eval`, not `new Function`.
 *   googletagmanager.com  only in a build with analytics configured:
 *                         `firebase/analytics` loads gtag.js from there. A
 *                         build without analytics does not allow it.
 *   worker-src 'self' blob:
 *                         pdf.js runs its worker from this origin; Spline
 *                         starts its workers from blob: URLs it creates.
 */

import { createHash } from 'node:crypto'

const META = /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")/i
const INLINE = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi

export const GTM = 'https://www.googletagmanager.com'

/** sha256 CSP sources for every inline <script> in `html`, in document order. */
export function inlineScriptHashes(html) {
  const out = []
  for (const [, body] of html.matchAll(INLINE)) {
    if (body.trim() === '') continue
    out.push(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`)
  }
  return out
}

/**
 * `html` with script-src and worker-src added to its CSP meta tag.
 * Throws when there is no such tag: a build that silently shipped without its
 * policy is the failure this exists to prevent.
 */
export function withScriptPolicy(html, { analytics = false } = {}) {
  if (!META.test(html)) throw new Error('csp: index.html has no Content-Security-Policy meta tag')
  const script = ["'self'", ...inlineScriptHashes(html), "'wasm-unsafe-eval'", ...(analytics ? [GTM] : [])]
  return html.replace(META, (_, open, policy, close) => {
    if (/(^|;)\s*(script|worker)-src\b/.test(policy)) {
      throw new Error('csp: the policy already names script-src or worker-src; it is added at build time')
    }
    const base = policy.trim().replace(/;\s*$/, '')
    return `${open}${base}; script-src ${script.join(' ')}; worker-src 'self' blob:${close}`
  })
}

/**
 * The one string-eval the bundle attempts, removed at build time.
 *
 * `@splinetool/runtime` bundles msgpackr, which probes for `new Function` at
 * load — `try{new Function("")}catch{X=1/0}` — and, refused, sets X to
 * Infinity so it never compiles a decoder and reads every record the slow,
 * safe way. Under the policy above the probe is refused, the mascot works, and
 * the browser logs a CSP violation on every page load. This writes the
 * probe's refused outcome in directly: the same behaviour, with no attempt to
 * report.
 *
 * Returns null when the probe is not there, which the build turns into an
 * error: a Spline upgrade that moved it would otherwise bring the violation
 * back with nothing to say why.
 */
export const EVAL_PROBE = /try\{new Function\(""\)\}catch\{([A-Za-z_$][\w$]*)=1\/0\}/

export function withoutEvalProbe(code) {
  return EVAL_PROBE.test(code) ? code.replace(EVAL_PROBE, '$1=1/0;') : null
}
