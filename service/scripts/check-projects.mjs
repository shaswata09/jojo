/**
 * Every directory under `kg/` belongs to a TypeScript project.
 *
 * ## What this missed, for how long
 *
 * `kg/agent` — the loop, the catalog, the tool retriever, the readers, the
 * benchmark rubric — was in no `tsconfig.*.json`'s `include`. Its SOURCE was
 * still checked, transitively, because `kg/react` imports it. Its TESTS were
 * not, because nothing imports a test file.
 *
 * So `kg/agent/*.test.ts` had never been compiled. When the directory was
 * finally added, 73 errors came out of eighteen files: a `GraphSnapshot`
 * imported from the wrong module, four fixtures missing a `handoverAt` and a
 * `today` that had become required, a helper reading a property no fixture has
 * and that nothing called, and — in `flow.ts`, which nothing imports at all —
 * a genuine narrowing bug on the line the file's own comment called the
 * important one.
 *
 * None of that is exotic. All of it was invisible for the same boring reason:
 * a directory that is in no project is not checked, and nothing says so.
 *
 * ## What this checks
 *
 * Not that the include list is *correct* — a project can include a directory
 * and still compile it under the wrong lib. Only that no directory is in NONE
 * of them, which is the failure that is silent.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SERVICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** JSON with comments — every tsconfig here is written with them. */
const readConfig = (file) => {
  const raw = readFileSync(path.join(SERVICE, file), 'utf8')
  const withoutBlocks = raw.replace(/\/\*[\s\S]*?\*\//g, '')
  const withoutLines = withoutBlocks.replace(/^\s*\/\/.*$/gm, '')
  return JSON.parse(withoutLines)
}

const configs = readdirSync(SERVICE).filter((f) => /^tsconfig\..*\.json$/.test(f))
const included = new Set()
for (const file of configs) {
  for (const entry of readConfig(file).include ?? []) {
    // `kg/core` and `kg/log.ts` both count as covering what they name.
    included.add(entry.replace(/\/$/, ''))
  }
}

const roots = ['kg', 'data']
const failures = []
for (const root of roots) {
  const full = path.join(SERVICE, root)
  const entries = statSync(full).isDirectory() ? readdirSync(full) : []
  for (const entry of entries) {
    const rel = `${root}/${entry}`
    const isDir = statSync(path.join(SERVICE, rel)).isDirectory()
    if (!isDir && !/\.tsx?$/.test(entry)) continue
    // Covered directly, by its parent, or (for a file) by name.
    if (included.has(rel) || included.has(root)) continue
    failures.push(rel)
  }
}

if (failures.length > 0) {
  console.error(`\ncheck-projects: ${failures.length} path(s) in no TypeScript project\n`)
  for (const f of failures) console.error(`  ${f}`)
  console.error(
    `\nAdd each to the \`include\` of whichever of ${configs.join(', ')} compiles it under the\n` +
      'right lib. Source in an unlisted directory is still checked when something imports it;\n' +
      'its TESTS are not, because nothing imports a test file — which is how kg/agent went\n' +
      'unchecked long enough to accumulate 73 errors.\n',
  )
  process.exit(1)
}

console.log('check-projects: every directory under kg/ and data/ is in a TypeScript project')
