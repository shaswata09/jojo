/**
 * The "Built with" page against what is actually installed and shipped.
 *
 * R34: the page and NOTICE said nothing about React, Radix, lucide, cva or
 * Firebase, all of which are in the bundle. Two checks keep that from coming
 * back: every production dependency of the web app has a credit (or is jojo's
 * own), and every credited version and licence is the one in node_modules —
 * the rule `credits.ts` states and nothing enforced.
 *
 * Direct dependencies are not the whole bundle: the d3 modules, pako and tslib
 * shipped three levels down and uncredited. What the bundle contains is only
 * known to the build, so the build checks it (`jojo:credited-bundle` in
 * `vite.config.ts`); the rules it applies are tested here.
 */

import { describe, expect, it } from 'vitest'
import { BSD_3_TEXT, BUNDLED, DEVELOPMENT, PHONE, RUNTIME, ZLIB_TEXT, creditProblems, packageOfModule } from './credits'
import type { Credit } from './credits'

// @ts-expect-error TS2307 — node:fs has no types under tsconfig.app.json; reading node_modules is the point.
const fs = (await import('node:fs')) as {
  existsSync: (p: string) => boolean
  readFileSync: (p: string, enc: 'utf8') => string
}

/** Repo-relative from this file's directory (web/src/components/guide). */
const ROOT = new URL('../../../../', import.meta.url).pathname

type Manifest = { version?: string; license?: string; dependencies?: Record<string, string> }
const readJson = (path: string) => JSON.parse(fs.readFileSync(path, 'utf8')) as Manifest

/** The copy node would load from `fromDir`, walking up as resolution does. */
function installed(name: string, fromDir: string): Manifest | null {
  for (let dir = fromDir; dir.startsWith(ROOT); dir = dir.replace(/[^/]+\/$/, '')) {
    const path = `${dir}node_modules/${name}/package.json`
    if (fs.existsSync(path)) return readJson(path)
  }
  return null
}

/**
 * jojo's own workspace packages: nothing to credit. Read from the workspaces'
 * manifests rather than spelled out, so no import-shaped string of the shared
 * layer appears here for `check-no-copies` to read.
 */
const OWN = new Set(
  ['service', 'web', 'mobile'].map((w) => {
    try {
      return (JSON.parse(fs.readFileSync(`${ROOT}${w}/package.json`, 'utf8')) as { name?: string }).name ?? ''
    } catch {
      return ''
    }
  }),
)

describe('credits', () => {
  it('names every production dependency of the web app', () => {
    const deps = Object.keys(readJson(`${ROOT}web/package.json`).dependencies ?? {})
    const credited = new Set([...RUNTIME, ...DEVELOPMENT].map((c) => c.name))
    const missing = deps.filter((d) => !OWN.has(d) && !credited.has(d))
    expect(missing, 'add these to RUNTIME in credits.ts, read from node_modules').toEqual([])
  })

  it('names every production dependency of the shared layer the web app bundles', () => {
    const deps = Object.keys(readJson(`${ROOT}service/package.json`).dependencies ?? {})
    const credited = new Set(RUNTIME.map((c) => c.name))
    expect(deps.filter((d) => !credited.has(d))).toEqual([])
  })

  it('states the installed version and licence for every web credit', () => {
    const wrong: string[] = []
    for (const credit of [...RUNTIME, ...DEVELOPMENT]) {
      const pkg = installed(credit.name, `${ROOT}web/`)
      if (pkg === null) continue // Not installed in this checkout (an optional tool); nothing to compare.
      if (pkg.version !== credit.version) wrong.push(`${credit.name}: ${credit.version} ≠ installed ${String(pkg.version)}`)
      // A null licence is the page saying "the manifest states none" — which
      // must then be true. Otherwise the two must agree.
      const declared = pkg.license ?? null
      if (credit.licence === null ? declared !== null : declared !== null && declared !== credit.licence) {
        wrong.push(`${credit.name}: licence ${String(credit.licence)} ≠ declared ${String(declared)}`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('lists each package once', () => {
    const names = [...RUNTIME, ...PHONE, ...DEVELOPMENT].map((c) => c.name)
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([])
  })
})

describe('what the build bundles, traced to its package', () => {
  it('names the package a module came from, and the folder its manifest is in', () => {
    expect(packageOfModule('/r/node_modules/d3-zoom/src/zoom.js')).toEqual({ name: 'd3-zoom', dir: '/r/node_modules/d3-zoom' })
    expect(packageOfModule('/r/web/node_modules/@radix-ui/react-dialog/dist/index.mjs')).toEqual({
      name: '@radix-ui/react-dialog',
      dir: '/r/web/node_modules/@radix-ui/react-dialog',
    })
  })

  it('takes the innermost copy when one package nests another', () => {
    expect(packageOfModule('/r/node_modules/@xyflow/react/node_modules/zustand/esm/index.mjs')?.dir).toBe(
      '/r/node_modules/@xyflow/react/node_modules/zustand',
    )
  })

  it('reads Windows paths, queries and virtual ids, and skips what is not a package', () => {
    expect(packageOfModule('C:\\r\\node_modules\\pako\\lib\\zlib\\deflate.js')?.name).toBe('pako')
    expect(packageOfModule('/r/node_modules/three/build/three.module.js?commonjs-es-import')?.name).toBe('three')
    expect(packageOfModule('\0/r/node_modules/tslib/tslib.es6.mjs')?.name).toBe('tslib')
    expect(packageOfModule('/r/web/src/main.tsx')).toBeNull()
    expect(packageOfModule('\0vite/preload-helper.js')).toBeNull()
    expect(packageOfModule('/r/node_modules/.vite/deps/chunk.js')).toBeNull()
    expect(packageOfModule('/r/node_modules/@scope')).toBeNull()
  })
})

describe('the build check', () => {
  const credits: readonly Credit[] = [
    { name: 'radix-ui', version: '1', licence: 'MIT', holder: null, what: '', covers: '@radix-ui/' },
    { name: 'd3-ease', version: '3', licence: 'BSD-3-Clause', holder: null, what: '' },
    { name: 'spline', version: '4', licence: 'MIT', holder: null, what: '' },
  ]

  it('passes a bundle whose every package is credited, by name or by its umbrella', () => {
    expect(
      creditProblems(
        [
          { name: 'd3-ease', version: '3', licence: 'BSD-3-Clause' },
          { name: '@radix-ui/react-popper', version: '1.3.7', licence: 'MIT' },
          // States nothing in its manifest; the credit read its LICENSE file.
          { name: 'spline', version: '4', licence: null },
        ],
        credits,
      ),
    ).toEqual([])
  })

  it('names a bundled package nobody credits, every copy of it', () => {
    const problems = creditProblems(
      [
        { name: 'tslib', version: '2.8.1', licence: '0BSD' },
        { name: 'tslib', version: '1.14.1', licence: '0BSD' },
      ],
      credits,
    )
    expect(problems).toHaveLength(2)
    expect(problems.every((p) => p.startsWith('tslib ') && p.includes('credited nowhere'))).toBe(true)
  })

  it('names a package credited under a licence it does not state, umbrella or not', () => {
    expect(creditProblems([{ name: 'd3-ease', version: '3', licence: 'ISC' }], credits)).toHaveLength(1)
    expect(creditProblems([{ name: '@radix-ui/x', version: '1', licence: 'Apache-2.0' }], credits)).toHaveLength(1)
  })

  it('credits every package the reviewed production build shipped', () => {
    // From the source maps of `vite build --sourcemap`, 2026-11-14 — the 35 the
    // first page left out. The build re-checks the real list every time.
    const shipped = [
      'd3-color', 'd3-dispatch', 'd3-drag', 'd3-ease', 'd3-interpolate', 'd3-selection', 'd3-timer', 'd3-transition',
      'd3-zoom', 'zustand', 'pako', 'tslib', '@floating-ui/core', '@floating-ui/dom', '@floating-ui/react-dom',
      '@floating-ui/utils', 'react-remove-scroll', 'react-remove-scroll-bar', 'aria-hidden', 'use-sidecar', 'its-fine',
      'suspend-react', 'lodash.debounce', 'classcat', '@xyflow/system', '@dnd-kit/accessibility', '@dnd-kit/utilities',
      '@pdf-lib/standard-fonts', '@pdf-lib/upng', 'get-nonce', 'react-merge-refs', 'react-style-singleton',
      'react-use-measure', 'use-callback-ref', 'use-sync-external-store',
    ]
    const credited = new Set(BUNDLED.map((c) => c.name))
    expect(shipped.filter((name) => !credited.has(name))).toEqual([])
  })
})

describe('the notices that travel with the bundle', () => {
  const notices = fs.readFileSync(`${ROOT}THIRD-PARTY-NOTICES.md`, 'utf8').replace(/\s+/g, ' ')
  const flat = (text: string) => text.replace(/\s+/g, ' ')

  it('quotes the BSD and zlib texts the page does not, word for word', () => {
    expect(notices).toContain(flat(BSD_3_TEXT))
    expect(notices).toContain(flat(ZLIB_TEXT))
  })

  it('names the holder of every bundled package with a notice to keep', () => {
    const missing = BUNDLED.filter((c) => c.licence !== '0BSD' && !notices.includes(c.name)).map((c) => c.name)
    expect(missing).toEqual([])
  })
})
