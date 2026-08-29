/**
 * The patterns `check-layers.mjs` reads every import through.
 *
 * WHY THIS FILE EXISTS.
 *
 * `check-layers.mjs` is 800 lines of rules over the strings these four regexes
 * hand back, so a pattern that fails to match is not a weakened rule — it is a
 * rule that does not exist, reported as a pass. The clause between `import` and
 * `from` was `[^\n;]*?`, and the newline in that class meant a WRAPPED import
 * was invisible to every rule in the file at once. Measured before the fix, by
 * appending this to `kg/core/blob-path.ts`:
 *
 *     import {
 *       createRepository,
 *     } from '../repo/repository'
 *
 * L1 core reaching into L2 repo, the exact edge the whole guard exists to
 * forbid. `node scripts/check-layers.mjs` printed "kg, data and the platform
 * adapters import in one direction" and exited 0. The same import on one line
 * failed immediately, so what the guard was really enforcing was a formatting
 * convention: Prettier wraps at 100 columns, and a named import of two or three
 * symbols from a nested path reaches that easily.
 *
 * The tests below are the wrapped spellings of all five rules that read a
 * specifier through these patterns, plus the false-positive cases the fix had to
 * not introduce — because the clause now crosses newlines, and the argument that
 * this is safe (it stops at the first quote, so it can only ever capture a real
 * `from '…'` target) is exactly the kind of argument that deserves a test rather
 * than a comment.
 *
 * WHY IT IS IN `service/test/`.
 *
 * `check-layers.mjs` walks the package and calls `process.exit(1)` at import
 * time, so importing it from vitest would either kill the worker on an unrelated
 * layer violation or require faking the tree. The patterns therefore live in
 * `scripts/import-specifiers.mjs`, which has nothing to run. `service/test/` is
 * this package's one project with a Node host, which is what reaching a script
 * outside `kg/` needs.
 */
import { describe, expect, it } from 'vitest'

/*
 * Loaded by URL rather than by a literal specifier: `.mjs` has no declarations
 * and this project does not set `allowJs`, so a static import would be a
 * type error over a file that is deliberately plain Node. The dynamic form is
 * `any` to tsc and the exact same module to vitest.
 */
const patterns = (await import(
  new URL('../scripts/import-specifiers.mjs', import.meta.url).href
)) as {
  specsIn: (source: string) => string[]
  todayImportsIn: (source: string) => string[]
}
const { specsIn, todayImportsIn } = patterns

describe('specsIn', () => {
  it('sees a specifier on one line', () => {
    expect(specsIn(`import { createRepository } from '../repo/repository'\n`)).toContain(
      '../repo/repository',
    )
  })

  /*
   * The regression. Every assertion in this block was passing an EMPTY array
   * before the clause stopped excluding `\n`, which is why they are spelled out
   * per rule rather than folded into one: the hole was in the shared clause, so
   * one failing case would have hidden four more.
   */
  it('sees a specifier when the import is wrapped across lines', () => {
    const source = `import {\n  createRepository,\n} from '../repo/repository'\n`
    expect(specsIn(source)).toContain('../repo/repository')
  })

  it('sees the @/ alias when the import is wrapped', () => {
    expect(specsIn(`import {\n  RELS,\n} from '@/kg/core/model'\n`)).toContain('@/kg/core/model')
  })

  it('sees a fixtures read when the import is wrapped', () => {
    expect(specsIn(`import {\n  seed,\n} from '../../data/seed'\n`)).toContain('../../data/seed')
  })

  it('sees a self-import by package name when the import is wrapped', () => {
    expect(specsIn(`import {\n  blobPath,\n} from '@jojo/service/core/blob-path'\n`)).toContain(
      '@jojo/service/core/blob-path',
    )
  })

  it('sees a wrapped re-export, which is an edge in the graph like any other', () => {
    expect(specsIn(`export {\n  blobPath,\n} from '../repo/repository'\n`)).toContain(
      '../repo/repository',
    )
  })

  it('sees a wrapped type-only import, which resolves the same at bundle time', () => {
    expect(specsIn(`import type {\n  Repository,\n} from '../repo/repository'\n`)).toContain(
      '../repo/repository',
    )
  })

  it('still sees side-effect and dynamic imports', () => {
    expect(specsIn(`import './polyfill'\n`)).toContain('./polyfill')
    expect(specsIn(`const m = await import(\n  './lazy'\n)\n`)).toContain('./lazy')
  })

  it('finds every import in a file, not just the first', () => {
    const source = [
      `import { a } from './a'`,
      `import './side-effect'`,
      `import {`,
      `  b,`,
      `} from './b'`,
      `export * from './c'`,
      ``,
    ].join('\n')
    expect(specsIn(source).sort()).toEqual(['./a', './b', './c', './side-effect'])
  })

  /*
   * The other half of the fix, and the reason the clause excludes quotes and
   * backticks instead of newlines.
   *
   * A clause that crosses lines could in principle run out of one statement and
   * grab a string from a later one. It cannot, because the first quote it can
   * reach is the specifier's own — but "cannot" is a claim about a regex, so
   * these are the shapes that would break it. `check-layers.mjs`'s header is
   * explicit that false positives are the expensive direction here: a guard that
   * reports an import nobody wrote is a guard people learn to override.
   */
  it('does not invent a specifier from a `from` property in an object literal', () => {
    expect(specsIn(`export const range = {\n  from: '@/components/x',\n}\n`)).toEqual([])
  })

  /*
   * These three are the ones that fail if the clause is widened to a plain
   * `[\s\S]*?`, which is the obvious way to "make it span lines" and is wrong.
   * Each puts the word `from` followed by a quoted string INSIDE a string
   * literal — prose that this repo's own guard scripts and error messages are
   * full of — and a clause that can cross a quote reports it as an import.
   */
  it('does not read a specifier out of a double-quoted string', () => {
    expect(specsIn(`export const NOTE = "the model is read from 'kg/core/model'"\n`)).toEqual([])
  })

  it('does not read a specifier out of a template literal', () => {
    const source = `export const HELP = \`\n  a specifier is read from 'kg/core/model'\n\`\n`
    expect(specsIn(source)).toEqual([])
  })

  it('does not reach past a statement whose own specifier already closed it', () => {
    const source = `import { a } from './a'\nexport const NOTE = 'copied from "./b"'\n`
    expect(specsIn(source)).toEqual(['./a'])
  })

  it('does not treat an identifier ending in "from" as the keyword', () => {
    expect(specsIn(`export const copiedFrom = ['x']\n`)).toEqual([])
  })

  /*
   * An `export`/`import` line may swallow the lines below it before reaching the
   * `from` of the NEXT statement. That is allowed, and this is the case that
   * says why it is harmless: what comes back is still the real specifier, and
   * the import underneath is not lost.
   */
  it('still reports the real specifier when a declaration sits above the import', () => {
    const source = `export type Row = { id: string }\nimport { a } from './a'\n`
    expect(specsIn(source)).toEqual(['./a'])
  })
})

describe('todayImportsIn (D26)', () => {
  it('sees TODAY imported on one line', () => {
    expect(todayImportsIn(`import { TODAY } from '../../data/today'\n`)).toContain(
      '../../data/today',
    )
  })

  /*
   * The spelling Prettier produces the moment a second symbol joins TODAY on the
   * line — which is to say, the spelling anyone would actually commit.
   */
  it('sees TODAY imported across lines', () => {
    const source = `import {\n  TODAY,\n  shortDate,\n} from '../../data/today'\n`
    expect(todayImportsIn(source)).toContain('../../data/today')
  })

  /*
   * The same discrimination on this side. With a plain `[\s\S]*?` clause the
   * line-start `import` below runs through its own specifier, into the sentence,
   * finds TODAY and then `from '…'`, and reports a D26 violation over a comment
   * about D26 — which is the flavour of false positive that gets a guard
   * disabled rather than fixed.
   */
  it('does not fire on prose about TODAY sitting under a real import', () => {
    const source =
      `import { shortDate } from '../../data/dates'\n` +
      `const NOTE = "TODAY is read from 'ctx.now'"\n`
    expect(todayImportsIn(source)).toEqual([])
  })

  it('does not fire on a symbol that merely contains TODAY', () => {
    expect(todayImportsIn(`import { TODAYS_DATE } from '../../data/today'\n`)).toEqual([])
  })
})
