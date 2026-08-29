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
 * This is what stops it being one. Every `ctx.call` on a string literal in the
 * tool sources must appear in `COMPOSES`. Add a composing call and forget the
 * table, and lint goes red on the first run rather than the retriever quietly
 * offering a model a tool whose helper it never mentioned.
 *
 * ## All three spellings of a string, because the guard is only as wide as it reads
 *
 * This scanned `'…'` alone. An audit copied the tool tree, added
 * `ctx.call("organisation.not.declared")` to it and ran this script: it printed
 * success. The same call in single quotes failed it. So one keystroke was the
 * difference between a guarded composition and an unguarded one, and the only
 * thing holding the line was Prettier's `singleQuote` — which `npm run lint`
 * does not run, and `gate.sh` does not run either. A guard whose soundness
 * rests on a formatter nobody executes is not a guard.
 *
 * Backticks are read for the same reason. A template literal with a `${}` in it
 * is deliberately NOT matched: there is no name to read, so half-reading one
 * would invent a target rather than report a real call.
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

/**
 * `ctx.call` on a plain string literal, in any of the three ways JS spells one.
 *
 * `[^`$]` on the template arm is what keeps `ctx.call(`${x}.create`)` from
 * matching: an interpolated name is not a literal, and the one dynamic dispatch
 * in the registry — `pipeline.proposal.approve` — is recorded in `COMPOSES` as
 * a deliberately empty entry precisely because its callees are data.
 */
const CALL_SITE = /ctx\.call\(\s*(?:'([^']+)'|"([^"]+)"|`([^`$]+)`)/g

/**
 * The target name out of a match, from whichever arm of `CALL_SITE` caught it.
 *
 * Shared with the self-test below rather than written out twice. It was written
 * twice, and a mutation test found the copies could disagree without anything
 * noticing: dropping `?? match[3]` from the scan alone left the self-test green
 * while a backtick call read as the literal name `undefined`. That direction
 * fails loudly rather than silently — an undeclared `undefined` is still a
 * failure — but it fails with the wrong reason attached, and a scanner nothing
 * exercises is the thing this file exists to not be.
 */
const nameOf = (match) => match[1] ?? match[2] ?? match[3]

/*
 * Guards the guard, first half: the pattern above is the whole soundness of
 * this check, so it is run against a call written each of the three ways before
 * it is trusted on real files. The double-quoted case is here because it was
 * missing for real — see the header — and a fix to a scanner that nothing
 * exercises is a fix that the next regex edit silently removes.
 */
for (const spelling of [
  "ctx.call('probe.name', {})",
  'ctx.call("probe.name", {})',
  'ctx.call(`probe.name`, {})',
]) {
  const found = [...spelling.matchAll(CALL_SITE)].map(nameOf)
  if (found.length !== 1 || found[0] !== 'probe.name') {
    console.error(
      `check-compositions: the call-site pattern no longer reads ${spelling} — it found ${JSON.stringify(found)}. Every quote style has to be read, or a composition hides behind the one that is not.`,
    )
    process.exit(1)
  }
}
// …and an interpolated target must stay unread rather than half-read.
if ([...'ctx.call(`${x}.create`, {})'.matchAll(CALL_SITE)].length !== 0) {
  console.error('check-compositions: the pattern is inventing a name out of a template literal.')
  process.exit(1)
}

/** Every `ctx.call` on a literal, with the file it sits in. */
const called = []
for (const { file, text } of sources) {
  for (const match of text.matchAll(CALL_SITE)) {
    called.push({ file, name: nameOf(match) })
  }
}

/*
 * Guards the guard, second half. The pattern is known to read a call by now;
 * this catches the calls having MOVED — `ctx.call` renamed, or the composing
 * hops pulled behind a helper — which would make every check below vacuously
 * pass, the failure mode a lint rule can least afford.
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
