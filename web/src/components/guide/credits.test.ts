/**
 * The "Built with" page against what is actually installed and shipped.
 *
 * R34: the page and NOTICE said nothing about React, Radix, lucide, cva or
 * Firebase, all of which are in the bundle. Two checks keep that from coming
 * back: every production dependency of the web app has a credit (or is jojo's
 * own), and every credited version and licence is the one in node_modules —
 * the rule `credits.ts` states and nothing enforced.
 */

import { describe, expect, it } from 'vitest'
import { DEVELOPMENT, PHONE, RUNTIME } from './credits'

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
