/**
 * Two owner requests about what `StoreProvider` (`store.tsx`) mounts.
 *
 * Q074 — the phone app runs on the SHARED service layer. `mobile/src/kg` was
 * once a `cp -R` of the web's graph layer and drifted 813 lines; the owner asked
 * for the service code, React hooks included, to be reused instead. So the
 * phone's store is the shared `KgProvider` over the shared `boot`, and the only
 * platform code left under `mobile/src/kg` is the AsyncStorage driver and its
 * contract test (`rn-conformance.test.ts` runs the shared Driver contract on it).
 *
 * Q229 — choosing the first-use demo records crashed with "Couldn't find a
 * navigation object". `StoreProvider` draws `FirstRunChoice` and `Onboarding`
 * BESIDE the navigator, so `useNavigation` throws in them and in anything they
 * import; `Onboarding` called it, and the error boundary replaced the app. The
 * fix navigates through `navigation/ref.ts` instead. `scripts/check-overlays.mjs`
 * enforces this at lint time; this is the same walk as a test, rooted at the two
 * first-run overlays, so the regression also turns the test suite red.
 *
 * D20: nothing is mounted. Source reads only.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8')
const store = read('lib/store.tsx')

describe('Q074: the phone store is the shared service layer', () => {
  it('mounts the shared KgProvider over the shared boot and the AsyncStorage driver', () => {
    expect(store).toContain("import { KgProvider } from '@jojo/service/react/kg'")
    expect(store).toContain("import { boot } from '@jojo/service/repo/boot'")
    expect(store).toMatch(/boot\(\{[^}]*driver: createRnDriver\(\)/)
    expect(store).toMatch(/<KgProvider repo=\{state\.session\.repo\}/)
  })

  it('keeps no copy of the graph layer under mobile/src/kg', () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.(ts|tsx)$/.test(entry.name)) files.push(path.relative(SRC, full))
      }
    }
    walk(path.join(SRC, 'kg'))
    expect(files.sort()).toEqual(['kg/storage/rn-conformance.test.ts', 'kg/storage/rn-driver.ts'])
    expect(existsSync(path.join(SRC, 'data'))).toBe(false)
  })

  it('depends on the @jojo/service workspace', () => {
    // The name is read from the workspace rather than spelled here, because
    // `check-no-copies.mjs` reads any quoted bare package name, or a quoted
    // relative path into it, as an import.
    const service = (
      JSON.parse(readFileSync(path.join(SRC, '..', '..', 'service', 'package.json'), 'utf8')) as {
        name: string
      }
    ).name
    const pkg = JSON.parse(read('../package.json')) as { dependencies: Record<string, string> }
    expect(pkg.dependencies[service]).toBeDefined()
  })
})

describe('Q229: the first-run overlays never reach for useNavigation', () => {
  const IMPORT = /^\s*import\s+(?:type\s+)?[^'"]*from\s+['"]([^'"]+)['"]/gm
  const USES_NAV =
    /import\s*\{[^}]*\buseNavigation\b[^}]*\}\s*from\s*['"]@react-navigation\/native['"]/

  /** `@/x` or `./x` to a real file under src, or null for a package. */
  const resolve = (spec: string, from: string): string | null => {
    const base = spec.startsWith('@/')
      ? path.join(SRC, spec.slice(2))
      : spec.startsWith('.')
        ? path.resolve(path.dirname(from), spec)
        : null
    if (base === null) return null
    for (const c of [
      `${base}.ts`,
      `${base}.tsx`,
      path.join(base, 'index.ts'),
      path.join(base, 'index.tsx'),
      base,
    ]) {
      if (existsSync(c) && /\.(ts|tsx)$/.test(c)) return c
    }
    return null
  }

  /** Every module reachable from `root` that imports the hook. */
  const offenders = (root: string) => {
    const seen = new Set<string>()
    const found: string[] = []
    const walk = (file: string) => {
      if (seen.has(file)) return
      seen.add(file)
      const text = readFileSync(file, 'utf8')
      if (USES_NAV.test(text)) found.push(path.relative(SRC, file))
      for (const m of text.matchAll(IMPORT)) {
        const next = resolve(m[1], file)
        if (next !== null) walk(next)
      }
    }
    walk(path.join(SRC, root))
    return { found, reached: seen.size }
  }

  it('draws FirstRunChoice and Onboarding from StoreProvider, outside the navigator', () => {
    // If these move inside a screen the walk below stops mattering; if they
    // stay here it is the whole defence.
    expect(store).toContain('<FirstRunChoice')
    expect(store).toContain('<Onboarding fresh={fresh} />')
  })

  it.each(['components/common/FirstRunChoice.tsx', 'components/common/Onboarding.tsx'])(
    'reaches no useNavigation from %s',
    (root) => {
      const { found, reached } = offenders(root)
      // A walk that resolved nothing would pass while checking nothing.
      expect(reached).toBeGreaterThan(3)
      expect(found).toEqual([])
    },
  )
})
