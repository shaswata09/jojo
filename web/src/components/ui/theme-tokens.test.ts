import { describe, expect, it } from 'vitest'
import indexCss from '@/index.css?raw'

/**
 * Every custom property a Tailwind arbitrary value names must be one
 * `src/index.css` actually declares.
 *
 * This is the class of bug that has no symptom. A `var(--typo)` inside `[...]`
 * is invalid at computed-value time, so the property silently falls back to its
 * initial value: no build warning, no console message, no missing class — the
 * declaration is simply not there. The `secondary` button variant carried
 * `hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]` for
 * long enough to ship, and neither name has ever existed anywhere in the
 * stylesheet: the theme spells them `--color-secondary` / `--color-foreground`
 * and the palette spells them `--well` / `--text-1`. Measured in Chrome, the
 * hover fill computed to `rgba(0, 0, 0, 0)` in both themes and nothing else in
 * the button's subtree moved, so the two guided-tour hand-off buttons simply
 * did not respond to the pointer.
 *
 * The sweep is over `src`, not over `button.tsx`, because the failure is a
 * spelling mistake and spelling mistakes are not local. Sources arrive through
 * `import.meta.glob` rather than `node:fs` so the test needs no Node types —
 * `tsconfig.app.json` grants `vite/client` and nothing else.
 */

const sources = import.meta.glob('../../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/**
 * References that do not resolve and are known not to.
 *
 * `--radius` comes from `shadcn/tailwind.css`, which `index.css` imports but
 * this test does not read; the 2026-08 audit examined `input-group` and refuted
 * it as a defect. Listed rather than filtered out silently, so that the number
 * of unresolved references in this codebase stays a number somebody chose.
 */
const KNOWN_UNRESOLVED = new Set(['--radius'])

/**
 * Every `--name:` declaration in the stylesheet, wherever it is declared.
 *
 * Comments are stripped first. The prose in `index.css` quotes token names
 * followed by a colon often enough that a sentence would otherwise register as
 * a declaration, and a token this test believes exists is a token it will never
 * report as missing.
 */
function declaredProperties(): Set<string> {
  const css = indexCss.replace(/\/\*[\s\S]*?\*\//g, '')
  return new Set([...css.matchAll(/(?:^|[{;\s])(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]!))
}

/**
 * Every `var(--name)` written inside a Tailwind arbitrary value.
 *
 * Scoped to `[...]` deliberately: that is where a reference has to resolve at
 * runtime. Utilities that name a theme colour (`ring-foreground/10`) are a
 * different mechanism — `@theme inline` substitutes those at build time — and
 * including them would flag working code.
 */
function arbitraryValueReferences(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>()
  for (const [file, source] of Object.entries(sources)) {
    if (file.endsWith('.test.ts')) continue
    for (const bracketed of source.matchAll(/\[[^\]\n]*?\]/g)) {
      for (const ref of bracketed[0].matchAll(/var\((--[a-zA-Z0-9-]+)/g)) {
        const name = ref[1]!
        const where = found.get(name) ?? new Set<string>()
        where.add(file)
        found.set(name, where)
      }
    }
  }
  return found
}

describe('custom properties named in class strings', () => {
  it('are all declared in index.css', () => {
    const declared = declaredProperties()
    const unresolved = [...arbitraryValueReferences()]
      .filter(([name]) => !declared.has(name) && !KNOWN_UNRESOLVED.has(name))
      .map(([name, where]) => `${name} (${[...where].join(', ')})`)

    expect(unresolved).toEqual([])
  })

  it('are read from a stylesheet and a source set that are really there', () => {
    // Guards the guard. If the declaration regex stopped matching, or the glob
    // resolved to nothing, the test above would pass by having nothing to
    // compare — which is exactly how a regression test comes to protect
    // nothing.
    const declared = declaredProperties()
    expect(declared.has('--radius-md')).toBe(true)
    expect(declared.has('--row-hover')).toBe(true)
    expect(declared.has('--secondary')).toBe(false)
    expect(declared.has('--foreground')).toBe(false)
    expect(arbitraryValueReferences().has('--shadow-raised')).toBe(true)
  })
})
