/**
 * The built page's script policy (R35e).
 *
 * The policy is added by the build, so these cases pin the transform; the
 * browser check — the app, the mascot, the PDF editor and the graph loading
 * with no violation — was made against a production build and is recorded in
 * `scripts/csp.mjs`. That check was made with the old third-party mascot,
 * whose runtime needed blob: workers and an eval-probe rewrite at build time;
 * the robot that replaced it is plain three.js, and both are gone.
 */
import { describe, expect, it } from 'vitest'
import { GTM, inlineScriptHashes, withScriptPolicy } from '../../scripts/csp.mjs'
import indexHtml from '../../index.html?raw'

const PAGE =
  `<meta http-equiv="Content-Security-Policy" content="object-src 'none'; base-uri 'self'" />` +
  `<script>\n  theme()\n</script><script type="module" src="/assets/index-A.js"></script>`

const policyOf = (html: string) => /content="([^"]*)"/.exec(html)?.[1] ?? ''

describe('the build-time script policy', () => {
  it('allows this origin, the inline script by hash, and wasm — and no eval', () => {
    const policy = policyOf(withScriptPolicy(PAGE))
    const [hash] = inlineScriptHashes(PAGE)
    expect(hash).toMatch(/^'sha256-[A-Za-z0-9+/]+=*'$/)
    expect(policy).toContain(`script-src 'self' ${String(hash)} 'wasm-unsafe-eval'`)
    expect(policy).toContain("worker-src 'self'")
    expect(policy).not.toContain("'unsafe-eval'")
    expect(policy).not.toContain("'unsafe-inline'")
    expect(policy).toContain("object-src 'none'; base-uri 'self'")
  })

  it('hashes the script exactly as written, so an edit changes the hash', () => {
    const edited = PAGE.replace('theme()', 'theme(1)')
    expect(inlineScriptHashes(edited)).not.toEqual(inlineScriptHashes(PAGE))
    // External scripts are allowed by 'self', not hashed.
    expect(inlineScriptHashes(PAGE)).toHaveLength(1)
  })

  it('allows gtag only in a build with analytics', () => {
    expect(policyOf(withScriptPolicy(PAGE))).not.toContain(GTM)
    expect(policyOf(withScriptPolicy(PAGE, { analytics: true }))).toContain(GTM)
  })

  it('allows gtag’s one file, not the host that serves every tag container', () => {
    const script = /script-src ([^;]*)/.exec(policyOf(withScriptPolicy(PAGE, { analytics: true })))?.[1] ?? ''
    const google = script.split(/\s+/).filter((source) => source.includes('googletagmanager'))
    expect(google).toEqual(['https://www.googletagmanager.com/gtag/js'])
  })

  it('refuses a page with no policy to extend, rather than shipping none', () => {
    expect(() => withScriptPolicy('<script>x</script>')).toThrow(/no Content-Security-Policy/)
  })

  it('fits the real index.html: one inline script, and no script-src written by hand', () => {
    expect(inlineScriptHashes(indexHtml)).toHaveLength(1)
    expect(() => withScriptPolicy(indexHtml)).not.toThrow()
  })
})

describe('workers', () => {
  /*
   * pdf.js's module worker and the service worker are both served from this
   * origin. blob: was allowed only for the old mascot runtime, which built its
   * workers from blob: URLs; with it gone, a worker from a blob: (or data:)
   * URL — the shape an injected script would use to run code off the page —
   * is refused.
   */
  it('allows workers from this origin and nowhere else', () => {
    const worker = /worker-src ([^;]*)/.exec(policyOf(withScriptPolicy(PAGE)))?.[1] ?? ''
    expect(worker.trim().split(/\s+/)).toEqual(["'self'"])
  })
})
