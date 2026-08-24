/**
 * Fails when the one hand-written half of the tool graph falls behind the code.
 *
 * `kg/agent/tool-graph.ts` derives almost everything it knows from the registry:
 * which tools consume an id of which type, and which produce one. That
 * derivation cannot drift, because it reads the same schemas the tools run on.
 *
 * One thing cannot be derived. A tool that calls another tool inside its own
 * `run` — `application.create` minting an organisation, `application.stage.advance`
 * minting a timeline item — declares that nowhere a type can see. It is a
 * function body. So `COMPOSES` lists them by hand, and a hand-written list of
 * facts about code is exactly the shape of thing this repo has been bitten by
 * before.
 *
 * This is what stops it being one. Every `ctx.call('…')` literal in the tool
 * sources must appear in `COMPOSES`. Add a composing call and forget the table,
 * and lint goes red on the first run rather than the retriever quietly offering
 * a model a tool whose helper it never mentioned.
 *
 * ## Why here rather than in a vitest test
 *
 * It was written as one first, and `check-platform` refused it — correctly.
 * Reading source files needs `node:fs`, and `kg/` is mounted unchanged inside
 * React Native and a browser, neither of which can resolve it. A guard that
 * reads the repo belongs beside the other guards that read the repo, which is
 * here.
 *
 * ## What it deliberately does NOT check
 *
 * That every entry in `COMPOSES` has a matching call site. The table is allowed
 * to name a composition that a refactor has since inlined — that costs the
 * retriever a slightly wider set, which is the safe direction. The unsafe
 * direction is a call site with no entry, and that is the only thing failed on.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const toolsDir = join(root, 'kg', 'tools')
const graphFile = join(root, 'kg', 'agent', 'tool-graph.ts')

const sources = readdirSync(toolsDir)
  .filter((f) => f.endsWith('.ts') && !f.includes('.test.'))
  .map((f) => ({ file: f, text: readFileSync(join(toolsDir, f), 'utf8') }))

/** Every `ctx.call('name'` literal, with the file it sits in. */
const called = []
for (const { file, text } of sources) {
  for (const match of text.matchAll(/ctx\.call\(\s*'([^']+)'/g)) {
    called.push({ file, name: match[1] })
  }
}

/*
 * Guards the guard. A regex that stopped matching — because `ctx.call` was
 * renamed, or the calls moved behind a helper — would make every check below
 * vacuously pass, which is the failure mode a lint rule can least afford.
 */
if (called.length < 5) {
  console.error(
    `check-compositions: found only ${called.length} ctx.call sites, which means the pattern has rotted rather than that the compositions are gone.`,
  )
  process.exit(1)
}

const graph = readFileSync(graphFile, 'utf8')
/** Names listed anywhere inside the COMPOSES table. */
const declared = new Set(
  [...graph.slice(graph.indexOf('COMPOSES')).matchAll(/'([a-z]+\.[a-z.]+)'/gi)].map((m) => m[1]),
)

const missing = called.filter((c) => !declared.has(c.name))
if (missing.length > 0) {
  console.error('check-compositions: these ctx.call targets are not in COMPOSES.\n')
  for (const { file, name } of missing) console.error(`  kg/tools/${file} calls '${name}'`)
  console.error(
    '\nAdd them to COMPOSES in kg/agent/tool-graph.ts, under the tool whose run reaches them.',
  )
  console.error(
    'The retriever uses that table to know a tool already covers work in another domain; a missing entry makes it offer a narrower set than the tool actually needs.',
  )
  process.exit(1)
}

console.log('check-compositions: every ctx.call target is declared in the tool graph')
