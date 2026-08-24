/**
 * Nothing leaves the router to go somewhere the router owns.
 *
 * The sibling of `public-assets.test.ts`, and the same bug wearing different
 * clothes. `BrowserRouter` is given `basename={import.meta.env.BASE_URL}`, so
 * `<Link>` and `navigate()` prefix the app's base for free. A bare `<a href>`
 * or a `location.href =` does not: it addresses the domain root, which is
 * correct at base `/` and a 404 under a subpath.
 *
 * That is how "Start the tour" sent people to `github.io/guide` instead of
 * `github.io/jojo/guide`.
 *
 * There is a second cost that has nothing to do with paths, and it is now the
 * larger one: leaving the router reloads the document, and agent runs live in a
 * registry above the router (`agent-runs.ts`). A reload is the one thing that
 * genuinely kills a conversation that is still working.
 *
 * External links, `mailto:`, and `publicUrl()` assets are all fine — those
 * genuinely are not the router's.
 */

import { describe, expect, it } from 'vitest'

const sources = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** This file quotes the patterns it forbids. */
const SELF = '/src/lib/internal-links.test.ts'

/** The app's own top-level routes, as they appear in a path string. */
const ROUTES = [
  '/guide',
  '/vault',
  '/scout',
  '/applications',
  '/calendar',
  '/statistics',
  '/assistant',
  '/settings',
]

describe('navigating inside the app', () => {
  /*
   * A bare anchor whose href is an app route. Written as a regex over the raw
   * source because what is being checked is what somebody typed — the JSX has
   * to be read as text or the bug is compiled away before the test sees it.
   */
  it('never uses a bare <a href> for a route the router owns', () => {
    const offenders: string[] = []

    for (const [path, source] of Object.entries(sources)) {
      if (path === SELF) continue
      for (const match of source.matchAll(/<a\s[^>]*href=\{?["'{]?([^"'\s}>]+)/g)) {
        const href = match[1] ?? ''
        // Only in-app routes. Anything absolute, a mail link, or an asset
        // resolved through `publicUrl` is genuinely not the router's.
        if (/^(https?:|mailto:|data:|blob:|#)/.test(href)) continue
        if (href.includes('publicUrl') || href.includes('hrefOf')) continue
        /*
         * `hrefOutsideRouter` is the third sanctioned way out, and unlike the
         * other two it is a route the router DOES own.
         *
         * `DialogHost` mounts its content outside the router, where `<Link>`
         * throws on a null context and takes the page down. So an anchor is the
         * only option there, and the helper exists to put the basename back on
         * by hand — which is the half of this rule it satisfies.
         *
         * It does NOT satisfy the other half: following it reloads the
         * document, and a reload kills any agent run still working. That cost
         * is real and is accepted here because the alternative is a crash. If
         * a dialog ever gains a link somebody follows mid-run, the fix is to
         * move the dialog inside the router rather than to widen this.
         */
        if (href.includes('hrefOutsideRouter')) continue
        const route = ROUTES.find((r) => href === r || href.startsWith(`${r}/`))
        const looksInternal = route !== undefined || href.includes('Path(')
        if (looksInternal) offenders.push(`${path} → <a href={${href}}>`)
      }
    }

    expect(
      offenders,
      `Use <Link to={…}> from react-router. A bare anchor skips the router's basename, so it 404s wherever the app is served from a subpath — and it reloads the document, which kills any agent run still working.\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  /*
   * The other way out of the router. `location.href = '/guide'` has both
   * problems and no upside over `navigate()`.
   */
  it('never navigates by assigning to location', () => {
    const offenders: string[] = []
    for (const [path, source] of Object.entries(sources)) {
      if (path === SELF) continue
      if (/location\.(href\s*=|assign\(|replace\()/.test(source)) {
        offenders.push(path)
      }
    }
    expect(offenders, `Use navigate() from react-router.\n${offenders.join('\n')}`).toEqual([])
  })

  /** The router is actually given the base — everything above rests on it. */
  it('hands the router the app’s base as its basename', () => {
    const app = sources['/src/App.tsx']
    expect(app).toBeDefined()
    expect(app).toContain('import.meta.env.BASE_URL')
    expect(app).toContain('basename={BASENAME}')
  })
})
