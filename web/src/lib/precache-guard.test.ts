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
import {
  auditPrecache,
  belongsToBuild,
  bootMarks,
  entryAssets,
  indexIsBuild,
  isFingerprinted,
  localPath,
  olderCaches,
  precachedAsset,
  precachedStatic,
} from '../../scripts/precache-guard.mjs'
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

describe('which lazy chunks are installed with the worker', () => {
  /*
   * R32(b). A chunk reached only by a lazy import was cached on first use, and
   * the next deploy's worker deleted that cache on activate — so the graph and
   * the PDF editor failed offline after every deploy until opened online.
   */
  it('precaches the lazy routes, their worker and the fonts', () => {
    for (const url of [
      'assets/Graph-BQk3qKyV.js',
      'assets/PdfEditor-Bh2orkEx.js',
      'assets/pdf.worker.min-CDpS5KSo.js',
      'assets/WorkflowFlow-C2DX8v4A.js',
      'assets/WorkflowFlow-DLioOiRN.css',
      'assets/inter-latin-wght-normal-Dx4kXJAl.woff2',
    ])
      expect(precachedAsset(url), url).toBe(true)
  })

  it('leaves the Transfer scene to first use, and nothing outside assets/', () => {
    expect(precachedAsset('assets/DataTransferScene-Dj5ps2Oj.js')).toBe(false)
    expect(precachedAsset('mascot.splinecode')).toBe(false)
    expect(precachedAsset('jojo-extension.zip')).toBe(false)
  })

  it('carries fingerprinted files over on activate instead of deleting them', () => {
    // The worker is generated text; this pins that activate copies before it deletes.
    const activate = makeSw.slice(makeSw.indexOf("addEventListener('activate'"))
    expect(activate.indexOf('carry(')).toBeGreaterThan(-1)
    expect(activate.indexOf('carry(')).toBeLessThan(activate.indexOf('caches.delete'))
    expect(isFingerprinted('assets/x-ABC.js')).toBe(true)
    expect(isFingerprinted('mascot.splinecode')).toBe(false)
  })
})

describe('what the mascot needs offline', () => {
  /*
   * R3. The scene and its wasm keep one URL across builds, so they were left
   * to first use — in the worker's own cache, which the next deploy deleted.
   */
  it('installs the scene and the wasm with the worker', () => {
    expect(precachedStatic('mascot.splinecode')).toBe(true)
    expect(precachedStatic('spline/process.wasm')).toBe(true)
  })

  it('is what make-sw adds to the install', () => {
    expect(makeSw).toMatch(/if \(precachedStatic\(f\.url\)\) boot\.add\(f\.url\)/)
  })

  it('and nothing else outside assets/ that is large and not needed offline', () => {
    expect(precachedStatic('jojo-extension.zip')).toBe(false)
    expect(precachedStatic('transfer/scene.png')).toBe(false)
    expect(precachedStatic('jojo-bridge.mjs')).toBe(false)
  })
})

describe('the document the worker installs', () => {
  /*
   * R3. Install fetched index.html through the HTTP cache, and the host sends
   * max-age=600: within ten minutes of a deploy the new worker cached the OLD
   * document, which names an entry chunk neither cache holds. Offline was a
   * blank page.
   */
  const marks = bootMarks(SHELL, '/')

  it('is recognised by the URLs it names', () => {
    expect(marks).toEqual(['/assets/index-AAA.js', '/assets/index-CCC.css'])
    expect(indexIsBuild(SHELL, marks)).toBe(true)
  })

  it('is refused when it is the previous build’s', () => {
    expect(indexIsBuild(SHELL.replace('index-AAA.js', 'index-OLD.js'), marks)).toBe(false)
    expect(indexIsBuild('', marks)).toBe(false)
  })

  it('is never accepted on no evidence', () => {
    expect(indexIsBuild(SHELL, [])).toBe(false)
  })

  it('is fetched past the HTTP cache, checked, and put in last', () => {
    const install = makeSw.slice(makeSw.indexOf("addEventListener('install'"))
    const body = install.slice(0, install.indexOf('addEventListener(', 10))
    expect(body).toMatch(/fetch\(new Request\(INDEX, \{ cache: 'reload' \}\)\)/)
    const check = body.indexOf('indexIsBuild(')
    const put = body.indexOf('cache.put(INDEX')
    const rest = body.indexOf('Promise.all(PRECACHE')
    expect(check).toBeGreaterThan(-1)
    expect(put).toBeGreaterThan(check)
    expect(rest).toBeGreaterThan(-1)
    expect(put).toBeGreaterThan(rest)
    // And a file outside assets/ is fetched past the HTTP cache as well.
    expect(makeSw).toMatch(/fetch\(new Request\(url, \{ cache: 'reload' \}\)\)/)
  })
})

describe('which build a window is running', () => {
  const ASSETS = 'https://x.test/jojo/assets/'
  const own = new Set([`${ASSETS}index-NEW.js`, `${ASSETS}index-NEW.css`, `${ASSETS}Graph-NEW.js`])

  it('is this one when every hashed file it holds is this build’s', () => {
    expect(
      belongsToBuild(
        [`${ASSETS}index-NEW.js`, `${ASSETS}index-NEW.css`, 'https://x.test/jojo/favicon.svg'],
        own,
        ASSETS,
      ),
    ).toBe(true)
  })

  it('is another when any hashed file is not', () => {
    expect(belongsToBuild([`${ASSETS}index-NEW.js`, `${ASSETS}Graph-OLD.js`], own, ASSETS)).toBe(false)
    expect(belongsToBuild([`${ASSETS}index-OLD.js`], own, ASSETS)).toBe(false)
  })

  it('is unknown — so not this one — for silence or a window with nothing hashed', () => {
    expect(belongsToBuild(null, own, ASSETS)).toBe(false)
    expect(belongsToBuild(undefined, own, ASSETS)).toBe(false)
    expect(belongsToBuild([], own, ASSETS)).toBe(false)
    expect(belongsToBuild(['https://x.test/jojo/favicon.svg'], own, ASSETS)).toBe(false)
  })

  it('is not fooled by another origin’s assets/', () => {
    expect(belongsToBuild(['https://evil.test/jojo/assets/index-NEW.js'], own, ASSETS)).toBe(false)
  })
})

describe('the caches an update touches', () => {
  it('are the ones made before this worker’s, oldest first', () => {
    expect(olderCaches(['jojo-a', 'other', 'jojo-b', 'jojo-c', 'jojo-d'], 'jojo-c')).toEqual([
      'jojo-a',
      'jojo-b',
    ])
  })

  it('never include a newer worker’s cache, which may be mid-install', () => {
    expect(olderCaches(['jojo-mine', 'jojo-newer'], 'jojo-mine')).toEqual([])
  })

  it('are every other jojo cache when this worker’s own is missing', () => {
    expect(olderCaches(['jojo-a', 'x', 'jojo-b'], 'jojo-c')).toEqual(['jojo-a', 'jojo-b'])
  })
})

describe('when a waiting worker takes over', () => {
  /*
   * R3. No skipWaiting and no handshake: the waiting worker never activated,
   * and offline the old one booted the old build against a database the new
   * one had upgraded. It must take over — but only when no open window still
   * runs the old build, whose lazy chunks live in the cache activate deletes.
   */
  const listener = makeSw.slice(makeSw.indexOf("addEventListener('message'"))
  const body = listener.slice(0, listener.indexOf("addEventListener('activate'"))

  it('ships the tested helpers as they are', () => {
    for (const fn of [belongsToBuild, olderCaches, indexIsBuild])
      expect(makeSw).toContain('${' + fn.name + '.toString()}')
  })

  it('checks the sender, asks every window, and only then skips waiting', () => {
    const sender = body.indexOf('belongsToBuild(data.assets')
    const census = body.indexOf("matchAll({ type: 'window', includeUncontrolled: true })")
    const verdict = body.indexOf('answers.every((assets) => belongsToBuild(assets')
    const skip = body.indexOf('self.skipWaiting()')
    expect(sender).toBeGreaterThan(-1)
    expect(census).toBeGreaterThan(sender)
    expect(verdict).toBeGreaterThan(census)
    expect(skip).toBeGreaterThan(verdict)
    // Exactly one call, and it is the guarded one.
    expect(makeSw.split('skipWaiting()').length - 1).toBe(1)
  })

  it('deletes only older caches on activate', () => {
    const activate = makeSw.slice(makeSw.indexOf("addEventListener('activate'"))
    expect(activate.slice(0, activate.indexOf('caches.delete'))).toContain('olderCaches(')
  })
})
