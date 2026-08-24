/**
 * Nothing addresses a vendored asset by a bare root-absolute path.
 *
 * This is the regression guard for a bug that is invisible twice over. At
 * `base: '/'` — every dev server, every test — `'/mascot.splinecode'` is
 * correct. Under a subpath it 404s, and the 3D mascot quietly hands over to the
 * 2D fallback, which is a fallback doing exactly its job: nothing logged,
 * nothing obviously broken, just a different robot on a deployed site that
 * nobody runs locally.
 *
 * `SplineRobot.tsx` already carried a comment promising that a change of `base`
 * would "break both together rather than one quietly". It broke four things
 * quietly. A promise about coupling that only a comment enforces is not a
 * coupling, so this asserts it.
 *
 * `import.meta.glob` rather than `node:fs`, the same way
 * `guide/code-structure.test.ts` walks the tree: this app has no Node types on
 * purpose, and reading the sources as TEXT is the point — what is being checked
 * is what somebody typed, and importing the modules would evaluate `publicUrl`
 * and hide the very thing this is looking for.
 */

import { describe, expect, it } from 'vitest'

/** Every source file in the app, as raw text, keyed by path. */
const sources = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/**
 * Everything under `public/`, as the root-absolute path that would 404.
 *
 * Globbed rather than listed, so a newly vendored asset is covered the day it
 * lands rather than the day somebody remembers this file.
 */
const assets = Object.keys(
  import.meta.glob('/public/**/*', { query: '?url', import: 'default', eager: true }),
).map((p) => p.replace(/^\/public/, ''))

/*
 * The three files whose SUBJECT is the path, and which therefore quote it as an
 * example rather than using it: the helper's own docstring and the two tests —
 * this one included. Named individually rather than skipping `.test.ts`
 * wholesale, so a real reference added in any other test still fails here.
 */
const QUOTES_IT_ON_PURPOSE = new Set([
  '/src/lib/public-url.ts',
  '/src/lib/public-url.test.ts',
  '/src/lib/public-assets.test.ts',
])

describe('assets vendored into public/', () => {
  it('finds the files this is guarding', () => {
    expect(assets).toContain('/mascot.splinecode')
    expect(assets).toContain('/transfer/scene.png')
    expect(assets.length).toBeGreaterThan(3)
  })

  /*
   * The check itself. A quoted root-absolute path naming a real file in
   * `public/` is the bug — it ships verbatim, because Vite rewrites the asset
   * URLs it can SEE and a string in TypeScript is not one of them.
   */
  it('are never addressed by a bare root-absolute path', () => {
    const offenders: string[] = []

    for (const [path, source] of Object.entries(sources)) {
      if (QUOTES_IT_ON_PURPOSE.has(path)) continue
      for (const asset of assets) {
        // Quoted exactly, so `publicUrl('mascot.splinecode')` — which has no
        // leading slash — does not match, and neither does prose in a comment.
        for (const quoted of [`'${asset}'`, `"${asset}"`]) {
          if (source.includes(quoted)) offenders.push(`${path} → ${quoted}`)
        }
      }
    }

    expect(
      offenders,
      `Use publicUrl() from '@/lib/public-url'. A root-absolute path is correct at base '/' and 404s under a subpath, which is how the 3D mascot silently became the 2D one on GitHub Pages.\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  /**
   * The directory the Spline runtime is pointed at, which is not a file and so
   * is not covered by the sweep above.
   */
  it('include the wasm directory, which is addressed the same way', () => {
    const robot = sources['/src/components/brand/SplineRobot.tsx']
    expect(robot).toBeDefined()
    expect(robot).toContain("publicUrl('spline')")
    expect(robot).not.toContain("= '/spline'")
  })
})
