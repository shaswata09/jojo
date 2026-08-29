/**
 * Every module specifier in a source file, found without a parser.
 *
 * Split out of `check-layers.mjs` rather than living in it, and the reason is
 * that these four patterns ARE the guard: everything else in that file is
 * bookkeeping over the strings they hand back, so a pattern that fails to match
 * is a rule that silently does not exist. `check-layers.mjs` runs a walk of the
 * whole package at import time and calls `process.exit(1)`, which makes it
 * untestable from vitest without either faking the tree or letting an unrelated
 * layer violation kill the test worker. Here there is nothing to run, so
 * `test/import-specifiers.test.ts` can hand these functions a string and assert
 * on what comes back — which is the only way the hole below could have been
 * caught before it was exploited.
 *
 * Deliberately regex-based rather than AST-based, for the reason `check-layers.
 * mjs`'s header gives at length: the thing being matched is a module specifier,
 * which is a string literal at a fixed position in a statement, and a parser
 * dependency to read it would be a layer violation of its own kind.
 */

/*
 * The clause between `import`/`export` and `from` — everything these patterns
 * are NOT trying to read, skipped over to reach the specifier that they are.
 *
 * It used to be `[^\n;]*?`, and the newline in that class was a hole rather than
 * a narrowing. Measured: appending
 *
 *     import {
 *       createRepository,
 *     } from '../repo/repository'
 *
 * to `kg/core/blob-path.ts` — L1 core reaching into L2 repo, the exact edge the
 * layer guard exists to forbid — left `node scripts/check-layers.mjs` printing
 * "kg, data and the platform adapters import in one direction" and exiting 0.
 * The same import written on one line failed immediately. So the guard was
 * enforcing a formatting convention rather than a layer: any violation Prettier
 * decided to wrap became invisible, and it wraps at 100 columns, which a named
 * import of two or three symbols from a nested path reaches easily. The same
 * hole was in the `@/kg/…` rule, the fixtures allowlist, the self-import rule
 * and D26's TODAY ban, because all five read their specifier through here.
 *
 * Quotes and backticks are excluded INSTEAD of the newline, and that is what
 * keeps the pattern narrow while it spans lines. A real import clause contains
 * identifiers, braces, commas, `*`, `as` and `type` — never a string. So the
 * first quote the scan can reach is the specifier's own opening quote, which
 * means a match can only ever capture a genuine `from '…'` target: it cannot run
 * out of one statement and misattribute a string from somewhere else, because
 * any intervening statement that contains a string stops the scan dead. `;`
 * stays excluded for the reason it always was — it ends the statement.
 *
 * A match may still begin at an earlier `export`/`import` line and swallow the
 * lines between (`export type X = …` sitting above an import, say). That is
 * harmless and was checked both ways: the swallowed span holds no quote, so it
 * holds no other specifier, and the one it captures is the real one. Nothing is
 * dropped, and nothing is invented.
 *
 * `\bfrom` rather than `from`, so an identifier ending in the word cannot stand
 * in for the keyword. There is no valid syntax where one precedes the
 * specifier, so this can only remove false positives.
 */
const CLAUSE = /[^;'"`]*?/.source

/** `import … from '…'` and `export … from '…'`, wrapped across lines or not. */
export const IMPORT = new RegExp(
  `(?:^|\\n)\\s*(?:import|export)\\b${CLAUSE}\\bfrom\\s*['"]([^'"]+)['"]`,
  'g',
)

/**
 * `import '…'` for side effects, which has no clause to wrap.
 *
 * `\s*` already crosses newlines, so this one never had the hole above.
 */
export const BARE_IMPORT = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g

/** `import('…')`. `\s*` crosses newlines here too. */
export const DYNAMIC = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g

/**
 * D26: no module under kg may import TODAY. Time enters through ctx.now.
 *
 * Same clause, same fix, same reason — `import {\n  TODAY,\n} from '…'` is the
 * spelling Prettier produces as soon as a second symbol joins TODAY on the line,
 * and it was the spelling this pattern could not see.
 */
export const TODAY_IMPORT = new RegExp(
  `(?:^|\\n)\\s*import\\b${CLAUSE}\\bTODAY\\b${CLAUSE}\\bfrom\\s*['"]([^'"]+)['"]`,
  'g',
)

/**
 * Every specifier in `source`, in no particular order and possibly with repeats.
 *
 * Callers deduplicate by acting on each one, not by uniqueness: a file that
 * imports the same illegal target twice should be reported twice, because the
 * fix is two edits.
 */
export const specsIn = (source) =>
  [IMPORT, BARE_IMPORT, DYNAMIC].flatMap((re) => [...source.matchAll(re)].map((m) => m[1]))

/** The specifiers TODAY is imported from, for the D26 check. */
export const todayImportsIn = (source) => [...source.matchAll(TODAY_IMPORT)].map((m) => m[1])
