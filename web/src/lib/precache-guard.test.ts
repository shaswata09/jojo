/**
 * The service worker's precache has to contain the code the page loads.
 *
 * This is the half of `scripts/make-sw.mjs` that can be tested without a build.
 * The failure it exists for is silent in both directions: the build succeeds and
 * the worker installs, and the only symptom is that a reload with the network
 * down paints nothing — the shell arrives from the cache and the script it asks
 * for does not. It was reproduced against a copy of the real `dist` whose
 * index.html still named `assets/index-STALEHASH.js` while the emitted chunk was
 * `index-Ca9MU_wN.js`: `make-sw` exited 0 and wrote a worker precaching 9 files
 * and 35KB — the shell, the manifest, the icons, the favicon and the three
 * modulepreloaded chunks — where the same dist repaired precaches 11 files and
 * 2117KB. Everything it cached was real and the 2MB entry chunk and the
 * stylesheet were not in it, which is the shape of the failure: not an empty
 * precache anyone would notice, a plausible one that boots to a blank page.
 *
 * So each case below is a way that can happen. `boot` is the set the worker
 * would install, which is why every assertion is about membership of it rather
 * than about the document.
 */
import { describe, expect, it } from 'vitest'
import { auditPrecache, entryAssets, localPath } from '../../scripts/precache-guard.mjs'
import makeSw from '../../scripts/make-sw.mjs?raw'

/**
 * What Vite writes into the shell: one module script, one stylesheet.
 *
 * The icon is a made-up hashed name rather than the real `/favicon.svg`.
 * `public-assets.test.ts` fails any source quoting a root-absolute path to a
 * file that exists in `public/` — it ships verbatim and 404s under a subpath —
 * and a fixture is not an exception worth carving out of that guard.
 */
const SHELL =
  '<link rel="icon" href="/assets/icon-DDD.svg" />' +
  '<script type="module" crossorigin src="/assets/index-AAA.js"></script>' +
  '<link rel="modulepreload" crossorigin href="/assets/react-dom-BBB.js">' +
  '<link rel="stylesheet" crossorigin href="/assets/index-CCC.css">'

const audit = (html: string, boot: readonly string[], emittedCss = true) =>
  auditPrecache({ html, base: '/', boot: new Set(boot), emittedCss })

const COMPLETE = ['index.html', 'favicon.svg', 'assets/index-AAA.js', 'assets/index-CCC.css']

describe('auditPrecache', () => {
  it('passes a precache that holds the entry script and the stylesheet', () => {
    expect(audit(SHELL, COMPLETE)).toEqual([])
  })

  it('fails when the document names a chunk this build did not emit', () => {
    // The stale-hash case, which is the one that was measured: the reference
    // scan finds nothing on disk under that name and silently caches neither.
    const problems = audit(SHELL, ['index.html', 'favicon.svg'])
    expect(problems).toHaveLength(2)
    expect(problems.join('\n')).toContain('assets/index-AAA.js')
    expect(problems.join('\n')).toContain('assets/index-CCC.css')
  })

  it('fails when the script is precached but the stylesheet is not', () => {
    // Half a shell is still a broken shell, and it looks worse than a blank
    // page: the app renders unstyled and appears to have lost the user's data.
    expect(audit(SHELL, ['index.html', 'assets/index-AAA.js'])).toEqual([
      'assets/index-CCC.css is named by index.html but is not in dist/',
    ])
  })

  it('fails when the tag scan matches no script at all', () => {
    // A document that changed shape — different quoting, an importmap, a
    // bundler that inlines the entry — must fail loudly rather than produce a
    // precache of three small files that all resolve.
    expect(
      audit('<link rel="icon" href="/assets/icon-DDD.svg" />', ['index.html', 'favicon.svg']),
    ).toContain('the document names no script of this build')
  })

  it('fails when the build emitted CSS the document does not link', () => {
    const html = '<script type="module" src="/assets/index-AAA.js"></script>'
    expect(audit(html, ['index.html', 'assets/index-AAA.js'])).toEqual([
      'the build emitted CSS but the document links no stylesheet of this build',
    ])
  })

  it('does not ask for a stylesheet when the build emitted none', () => {
    // Inlined CSS is a legitimate build, and a guard that failed it would be
    // weakened by whoever hit it next.
    const html = '<script type="module" src="/assets/index-AAA.js"></script>'
    expect(audit(html, ['index.html', 'assets/index-AAA.js'], false)).toEqual([])
  })

  it('counts nothing from another origin as this build’s entry', () => {
    // A CDN script cannot stand in for the entry chunk: the worker will never
    // precache it, so offline it is missing however the document names it.
    const html = '<script type="module" src="https://cdn.example.com/index.js"></script>'
    expect(audit(html, ['index.html'], false)).toEqual([
      'the document names no script of this build',
    ])
  })

  it('counts nothing inline as this build’s entry', () => {
    // index.html carries an inline theme resolver that must run before first
    // paint. It has no URL, so it cannot be the thing the precache is missing.
    const html = '<script>document.documentElement.dataset.theme = "dark"</script>'
    expect(audit(html, ['index.html'], false)).toEqual([
      'the document names no script of this build',
    ])
  })

  it('reads the base the build actually used', () => {
    // '/jojo/' on Pages. A guard that assumed '/' would pass every Pages build
    // by finding no assets of its own to check.
    const html = '<script type="module" src="/jojo/assets/index-AAA.js"></script>'
    expect(
      auditPrecache({
        html,
        base: '/jojo/',
        boot: new Set(['assets/index-AAA.js']),
        emittedCss: false,
      }),
    ).toEqual([])
    expect(auditPrecache({ html, base: '/jojo/', boot: new Set(), emittedCss: false })).toEqual([
      'assets/index-AAA.js is named by index.html but is not in dist/',
    ])
  })
})

describe('localPath', () => {
  it('strips the base, the query and the fragment', () => {
    // The precache is keyed by path, so a URL that survives with '?v=2' on it
    // is a URL the audit would report missing from a set that contains it.
    expect(localPath('/assets/index-AAA.js?v=2#x', '/')).toBe('assets/index-AAA.js')
  })

  it('returns null for anything not under the base', () => {
    expect(localPath('https://cdn.example.com/x.js', '/')).toBeNull()
    expect(localPath('/assets/x.js', '/jojo/')).toBeNull()
  })
})

describe('entryAssets', () => {
  it('separates scripts from stylesheets and ignores preloads and icons', () => {
    // modulepreload is a hint, not a requirement: the entry chunk imports those
    // files itself, so they are reached through the runtime rule. Demanding
    // them here would make the guard fail builds that boot perfectly well.
    expect(entryAssets(SHELL, '/')).toEqual({
      script: ['assets/index-AAA.js'],
      stylesheet: ['assets/index-CCC.css'],
    })
  })
})

/**
 * The half above is pure, and a guard nothing calls is not a guard.
 *
 * Measured, and it is why this block exists: with `auditPrecache` left intact
 * and `if (broken.length > 0)` in `make-sw.mjs` replaced by `if (false)`, the
 * whole web suite still passed. Ten mutants of the audit itself all die against
 * the cases above; the one mutant that unwires it from the build survived every
 * one of them. So what is pinned here is the JOIN — the audit is what the build
 * branches on, and that branch leaves before anything is written. Source-level
 * rather than a spawned build, for the reason `dialog-mount.test.ts` gives: the
 * alternative needs the thing that cannot run inside a test.
 */
describe('make-sw wiring', () => {
  /** Whatever the script binds the audit's reasons to. */
  const bound = /const (\w+) = auditPrecache\(/.exec(makeSw)?.[1]
  const branch = new RegExp(`if \\([^)]*\\b${bound ?? '\\u0000'}\\b[^)]*\\)`)

  it('branches on the audit’s reasons and not on a constant', () => {
    expect(bound, 'make-sw should call auditPrecache and keep the reasons').toBeDefined()
    expect(branch.test(makeSw), 'the reasons have to be what the build tests').toBe(true)
  })

  it('leaves before it writes the worker', () => {
    // Order is the whole point. A check that runs after `writeFileSync` has
    // already shipped the worker it was meant to stop.
    const exit = makeSw.indexOf('process.exit(1)', branch.exec(makeSw)?.index ?? 0)
    const write = makeSw.indexOf("writeFileSync(join(DIST, 'sw.js')")
    expect(exit, 'the branch has to exit').toBeGreaterThan(-1)
    expect(write, 'make-sw should still write the worker').toBeGreaterThan(-1)
    expect(write).toBeGreaterThan(exit)
  })
})
