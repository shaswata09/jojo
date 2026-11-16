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
 *   'wasm-unsafe-eval'    WebAssembly compilation, for pdf.js: its worker
 *                         compiles wasm for the image decoders and for the
 *                         PostScript functions it turns into wasm in memory.
 *                         It allows wasm only — not `eval`, not `new Function`.
 *                         Kept with care rather than proven needed: the worker
 *                         is loaded from this origin, and a worker from a
 *                         non-local URL takes its policy from its own response
 *                         rather than from this meta tag, so strictly it may
 *                         not reach the worker at all. Nothing on the page
 *                         itself compiles wasm any more — the third-party
 *                         mascot runtime that did (physics, navmesh, boolean
 *                         ops) is gone, and the robot that replaced it is
 *                         three.js through React Three Fiber, plain JS — but
 *                         dropping this has not been measured against a PDF
 *                         that exercises those paths in every browser, and
 *                         wasm compilation is not the string-eval this policy
 *                         exists to refuse.
 *   …/gtag/js             only in a build with analytics configured:
 *                         `firebase/analytics` loads gtag.js from there. A
 *                         build without analytics does not allow it. The
 *                         PATH, not the host: the host serves every Google
 *                         Tag Manager container (`gtm.js?id=GTM-<anyone>`),
 *                         and a container runs whatever its owner put in it,
 *                         so allowing the host would let one injected tag
 *                         run someone else's code (round-3 review). A path
 *                         without a trailing slash matches that one file;
 *                         the query string is not part of the match.
 *   worker-src 'self'     pdf.js runs its worker from this origin (a module
 *                         worker Vite emits as a hashed asset, handed over as
 *                         `workerPort`, so pdf.js never builds its blob:
 *                         wrapper), and the service worker, `sw.js`, is this
 *                         origin's too. `blob:` used to be here for the old
 *                         third-party mascot runtime, which started its
 *                         physics, navmesh and decoder workers from blob: URLs
 *                         it created; nothing else in the bundle does, so a
 *                         blob: worker is now refused.
 */

import { createHash } from 'node:crypto'

const META = /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")/i
const INLINE = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi

export const GTM = 'https://www.googletagmanager.com/gtag/js'

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
    return `${open}${base}; script-src ${script.join(' ')}; worker-src 'self'${close}`
  })
}

