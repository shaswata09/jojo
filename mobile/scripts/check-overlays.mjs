/**
 * Fails when something drawn beside the navigator reaches for `useNavigation`.
 *
 * ## The bug this is a mechanism for
 *
 * Four things are mounted as SIBLINGS of `RootNavigator` rather than inside it,
 * each for a reason that still holds: a sheet is not a route and would be torn
 * down by the navigation that opened it, an approval has to outlive the screen
 * whose run raised it, and the first-run steps have to draw before there is a
 * screen to draw them on.
 *
 * The price is that `useNavigation` throws in all of them — "Couldn't find a
 * navigation object. Is your component inside NavigationContainer?" — and it
 * throws at render, so the error boundary replaces the app with "Something
 * broke. A screen failed to draw." On a fresh install, choosing the demo
 * records swapped `FirstRunChoice` for `Onboarding`, `Onboarding` called the
 * hook in its first three lines, and the app died on the first button anybody
 * pressed. `ApplicationSheet` had the same defect waiting behind the duplicate
 * check.
 *
 * ## Why prose failed
 *
 * `SheetHost` already stated the rule: "nothing reachable from here may call
 * `useNavigation`. None of the three does today." That sentence was true when
 * written and nobody re-read it while adding a jump to a duplicate record. The
 * hook is correct code — every screen in the app uses it — so neither `tsc` nor
 * `oxlint` has anything to object to. Only the POSITION is wrong, and position
 * is what this file checks.
 *
 * ## What it does
 *
 * Walks the local import graph out of each overlay root and fails if any module
 * it reaches imports `useNavigation`. Transitive on purpose: the crash does not
 * care whether the hook is called by the sheet or by a component three levels
 * inside it. A component shared with a screen that trips this is not a false
 * positive — it renders in both places and crashes in one.
 *
 * The fix is always the same: `navigation/ref.ts`, which navigates through the
 * container ref instead of the context.
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src')

/**
 * Everything `App.tsx` and `StoreProvider` draw outside the navigator.
 *
 * Listed rather than detected: "is this JSX a sibling of `RootNavigator`" is a
 * question about a render tree, and a script that tried to answer it from the
 * source would be guessing. Four entries, changing about once a year, is a list
 * worth maintaining by hand — and the day somebody adds a fifth overlay is a
 * day they should be reading this file anyway.
 */
const ROOTS = [
  'sheets/SheetHost.tsx',
  'components/assistant/ApprovalSheet.tsx',
  'components/common/FirstRunChoice.tsx',
  'components/common/Onboarding.tsx',
]

/** `@/x` and `./x` to a real file, or null for a package import. */
function resolveImport(spec, fromFile) {
  const base = spec.startsWith('@/')
    ? join(SRC, spec.slice(2))
    : spec.startsWith('.')
      ? resolve(dirname(fromFile), spec)
      : null
  if (base === null) return null
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && !candidate.endsWith('/')) {
      try {
        if (readFileSync(candidate).length >= 0) return candidate
      } catch {
        /* a directory, or unreadable — keep looking */
      }
    }
  }
  return null
}

const IMPORT = /^\s*import\s+(?:type\s+)?[^'"]*from\s+['"]([^'"]+)['"]/gm

/**
 * The IMPORT, not the word.
 *
 * The first version of this matched `\buseNavigation\b` anywhere in the file
 * and immediately reported two modules whose only mention of the hook is a
 * comment explaining why they must not use it — including this rule's own
 * documentation. A guard that fires on the prose describing it is a guard
 * somebody switches off. You cannot call the hook without importing it, so the
 * import is the honest signal.
 */
const IMPORTS_NAVIGATION =
  /import\s*\{[^}]*\buseNavigation\b[^}]*\}\s*from\s*['"]@react-navigation\/native['"]/

const seen = new Set()
const offenders = []
/** Where each offender was reached from, so the message names a path. */
const via = new Map()

function walk(file, trail) {
  if (seen.has(file)) return
  seen.add(file)

  const text = readFileSync(file, 'utf8')
  if (IMPORTS_NAVIGATION.test(text)) {
    offenders.push(file)
    via.set(file, trail)
    // Keep walking: one offender should not hide the next.
  }

  for (const match of text.matchAll(IMPORT)) {
    const next = resolveImport(match[1], file)
    if (next !== null) walk(next, [...trail, file])
  }
}

for (const root of ROOTS) {
  const file = join(SRC, root)
  if (!existsSync(file)) {
    console.error(`check-overlays: ${root} is listed as an overlay root but does not exist.`)
    console.error('  Update ROOTS in this file, or restore the module.')
    process.exit(1)
  }
  walk(file, [])
}

if (offenders.length > 0) {
  const rel = (f) => f.slice(SRC.length + 1)
  console.error('check-overlays: `useNavigation` is reachable from an overlay.\n')
  console.error('These render BESIDE the navigator, so the hook throws at render and the')
  console.error('error boundary replaces the app with "Something broke".\n')
  for (const file of offenders) {
    const trail = via.get(file) ?? []
    const from = trail.length > 0 ? rel(trail[0]) : rel(file)
    console.error(`  ${rel(file)}`)
    console.error(`    reached from the overlay ${from}`)
  }
  console.error('\nNavigate through `navigation/ref.ts` instead:')
  console.error("  fromOverlay((nav) => nav.navigate('Settings'))")
  process.exit(1)
}

console.log('check-overlays: nothing drawn beside the navigator calls useNavigation')
