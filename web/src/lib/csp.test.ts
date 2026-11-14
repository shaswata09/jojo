/**
 * The built page's script policy (R35e).
 *
 * The policy is added by the build, so these cases pin the transform; the
 * browser check — the app, the mascot, the PDF editor and the graph loading
 * with no violation — was made against a production build and is recorded in
 * `scripts/csp.mjs`.
 */
import { describe, expect, it } from 'vitest'
import { GTM, inlineScriptHashes, withScriptPolicy, withoutEvalProbe } from '../../scripts/csp.mjs'
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
    expect(policy).toContain("worker-src 'self' blob:")
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

  it('allows gtag’s host only in a build with analytics', () => {
    expect(policyOf(withScriptPolicy(PAGE))).not.toContain(GTM)
    expect(policyOf(withScriptPolicy(PAGE, { analytics: true }))).toContain(GTM)
  })

  it('refuses a page with no policy to extend, rather than shipping none', () => {
    expect(() => withScriptPolicy('<script>x</script>')).toThrow(/no Content-Security-Policy/)
  })

  it('fits the real index.html: one inline script, and no script-src written by hand', () => {
    expect(inlineScriptHashes(indexHtml)).toHaveLength(1)
    expect(() => withScriptPolicy(indexHtml)).not.toThrow()
  })
})

describe('the Spline runtime’s eval probe', () => {
  it('is replaced by the outcome a refused probe has', () => {
    const code = 'var cd=!1,ZD=2;try{new Function("")}catch{ZD=1/0}var Lo=1'
    expect(withoutEvalProbe(code)).toBe('var cd=!1,ZD=2;ZD=1/0;var Lo=1')
  })

  it('reports a runtime where the probe has moved, rather than passing it through', () => {
    expect(withoutEvalProbe('try{new Function("x")}catch{}')).toBeNull()
  })
})
