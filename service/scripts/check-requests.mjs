// Keeps docs/REQUESTS.md honest: every request the owner made that still holds
// names the tests that would fail if it broke, and those tests still exist.
//
// The ledger is only worth having while it is true. A test renamed or deleted
// in a refactor would leave a line saying "guarded by" something that no longer
// guards anything, and the regression it was written for could come back with
// the ledger still reading green. So each cited test is checked here: the file
// must exist and must still hold a test whose TITLE contains the quoted text —
// the first argument of it/test/describe (with .each/.only/.concurrent/… in
// between), read past comments, not any string anywhere in the file. A header
// comment saying "the glance stats are four small tiles" used to keep Q006's
// "are four" green with its test deleted. A test marked .skip, .todo or
// .skipIf guards nothing and does not count.
//
// Format, per request (see the head of docs/REQUESTS.md):
//   ### Q001 — what was asked
//   `fix` · 2026-08-07 · web · active
//   Must stay true: …
//   Guarded by:
//   - `web/src/lib/x.test.ts` › "a verbatim piece of the it() title"
// or, for an active request no test can pin:
//   Guarded by: not testable — the reason
// or, for one asked for that does not hold yet (status `open`):
//   Not yet true: what is missing

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { testTitles } from './test-titles.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ledgerPath = join(root, 'docs', 'REQUESTS.md')
const STATUSES = new Set(['active', 'open', 'superseded', 'reverted', 'process'])

const problems = []
const text = readFileSync(ledgerPath, 'utf8')
const blocks = text.split(/^### (?=Q\d{3} )/m).slice(1)
const seen = new Set()
const fileText = new Map()
const read = (rel) => {
  if (!fileText.has(rel)) fileText.set(rel, readFileSync(join(root, rel), 'utf8'))
  return fileText.get(rel)
}

const titlesOf = new Map()
const titles = (rel) => {
  if (!titlesOf.has(rel)) titlesOf.set(rel, testTitles(read(rel)))
  return titlesOf.get(rel)
}

let guarded = 0
let untestable = 0
let open = 0
for (const block of blocks) {
  const id = block.slice(0, 4)
  if (seen.has(id)) problems.push(`${id}: listed twice`)
  seen.add(id)

  const meta = block.match(/^`(\w+)` · (\d{4}-\d{2}-\d{2}) · ([\w-]+) · (\w+)/m)
  if (!meta) {
    problems.push(`${id}: no "\`kind\` · date · platform · status" line`)
    continue
  }
  const status = meta[4]
  if (!STATUSES.has(status)) problems.push(`${id}: unknown status "${status}"`)
  if (status === 'open') {
    // Asked for and not true yet: it has to say what is missing, so the
    // ledger cannot quietly carry a request nobody is looking at.
    if (!/^Not yet true: \S/m.test(block)) problems.push(`${id}: open, but no "Not yet true:" line`)
    open += 1
    continue
  }
  if (status !== 'active') continue

  if (/^Guarded by: not testable — \S/m.test(block)) {
    untestable += 1
    continue
  }
  const guards = [...block.matchAll(/^- `([^`]+)` › "(.+)"$/gm)]
  if (guards.length === 0) {
    problems.push(`${id}: active, but names no test and gives no reason it cannot have one`)
    continue
  }
  guarded += 1
  for (const [, file, title] of guards) {
    if (!existsSync(join(root, file))) {
      problems.push(`${id}: ${file} does not exist`)
      continue
    }
    if (!titles(file).some((t) => t.includes(title))) problems.push(`${id}: ${file} has no test titled "${title}"`)
  }
}

if (blocks.length === 0) problems.push('docs/REQUESTS.md lists no requests')

if (problems.length > 0) {
  console.error(`check-requests: ${problems.length} problem(s) in docs/REQUESTS.md\n`)
  for (const p of problems) console.error(`  ${p}`)
  console.error('\nA cited test was renamed, moved or deleted: point the line at the test that guards it now.')
  process.exit(1)
}
console.log(
  `check-requests: ${blocks.length} requests; ${guarded} guarded by tests, ${untestable} untestable, ${open} open`,
)
