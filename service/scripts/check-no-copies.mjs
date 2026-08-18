/**
 * Fails when the fork starts coming back.
 *
 * The other two guards check the code that is here. This one checks that there
 * is only one of it, and it exists because of a measurement rather than a
 * principle: `mobile/src/kg` was a `cp -R` of `web/src/kg` with the specifiers
 * rewritten, it drifted 813 lines over four months, and nothing in either app's
 * lint could see it. The copy was not a mistake anybody made carelessly — it was
 * the cheapest way to share code at the time, because Metro could not resolve a
 * package outside the project root and a workspace had not been set up. The
 * workspace exists now, so the copy is no longer the cheap option, and this file
 * is what makes it the expensive one: a paste that used to cost nothing and be
 * discovered months later now costs a red lint on the first run.
 *
 * Four rules, in the order a recurrence trips them:
 *
 *   (a) CONTENT     no file under web/src or mobile/src may share a normalised
 *                   hash with a file under service/. A `cp -R` is caught by
 *                   identity, in the window before it has had time to drift.
 *   (b) SPECIFIER   the package is reached as `@jojo/service/<layer>/<name>` or
 *                   not at all — never by a relative path, never through a
 *                   subpath the exports map does not declare.
 *   (c) SHAPE       `mobile/src/kg` holds the adapter and its contract test, and
 *                   `mobile/src/data` does not exist.
 *   (d) TWINS       the two apps do not quietly grow a third copy of the same
 *                   file between themselves.
 *
 * Rule (a) is the one with a subtlety. Comparing raw bytes would have missed the
 * copy that actually happened: the fork differed from its origin in the import
 * lines alone on the day it was made, because rewriting `@/kg/…` to a relative
 * path is exactly what a paste into a second app requires. So specifiers are
 * canonicalised to a spelling-independent form before hashing, which is what
 * makes the rule catch the copy on day one rather than on the day someone
 * happens to diff two directories.
 *
 * Deliberately NOT a similarity metric. A near-duplicate detector is a tuning
 * parameter and an argument; identity is neither. Something 90% copied and 10%
 * edited is a fork this file will not catch, and the honest answer is that the
 * layer guards, the conformance contract and the shared test suite are what
 * cover that case — this one covers the paste.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SERVICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = path.resolve(SERVICE, '..')
const APPS = [path.join(ROOT, 'web', 'src'), path.join(ROOT, 'mobile', 'src')]

/**
 * What `mobile/src/kg` is allowed to contain, exhaustively.
 *
 * An allowlist rather than a size limit, because the failure this prevents is a
 * directory that grows one plausible file at a time. Every entry here was
 * argued for in `docs/SERVICE-LAYER.md`: the driver is genuinely
 * platform-specific, and its contract test names a driver so it cannot live in
 * the package that owns the contract.
 */
const MOBILE_KG_ALLOWED = new Set(['storage/rn-driver.ts', 'storage/rn-conformance.test.ts'])

/** Directories that must not come back at all. */
const FORBIDDEN_DIRS = [
  {
    dir: path.join(ROOT, 'mobile', 'src', 'data'),
    why:
      'The demo fixtures are `service/data`, read through `@jojo/service/data/…`. Mobile shipped a ' +
      'second copy of them with six names web did not have, and one of those — a `buildMonth` that ' +
      'closed over its own `TODAY` — differed from web\'s by an ARITY, so every call site compiled ' +
      'clean while silently losing the today marker.',
  },
]

/**
 * Pairs of app files that are knowingly the same, with the reason each is.
 *
 * The idiom differs from `PENDING` in `check-platform.mjs` on purpose. A stale
 * PENDING entry is a failure, because it means a violation was fixed and its
 * exemption outlived it. An entry here that stops matching means the two files
 * DIVERGED, which is the normal and permitted end state for a pair of app files
 * — so it is not reported. What is reported is a FIFTH pair appearing, which is
 * the signal that "we'll revisit it" has quietly become "we always do it".
 *
 * All four are UI filter selection: which label chips and which role tabs are
 * active. They are not graph state — the test that decides what belongs in the
 * package is "does a platform event have to act on it", and a filter chip does
 * not pass it. They were left in the apps as an open question rather than as a
 * decision, and this list is where the question is recorded so it is asked
 * again by the guard rather than by nobody.
 *
 * `lib/today.ts` was expected to be the fifth and is not. It reads
 * `partsOf` — from `@/data/timeline` on web and `@jojo/service/data/timeline`
 * on mobile, which canonicalise to the same specifier — but its header comment
 * names the tree it is talking about, and the two trees now have different
 * names. It is a near-twin, not a twin. D26 says the clock is the app shell's
 * decision, so its duplication is intended anyway; the guard simply has nothing
 * to say about it.
 */
const KNOWN_TWINS = [
  { file: 'lib/labels.tsx', why: 'label filter selection — UI state, not graph state (⊙7)' },
  { file: 'lib/labels-context.ts', why: 'the context object for the above' },
  { file: 'lib/roles.tsx', why: 'role filter selection — same argument' },
  { file: 'lib/roles-context.ts', why: 'the context object for the above' },
]

/* -------------------------------------------------------------------------- */

function walk(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(full)) out.push(full)
  }
  return out
}

const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/')

/**
 * A module specifier reduced to what it POINTS AT, not how it is spelled.
 *
 * `@/kg/core/model`, `@jojo/service/core/model`, `../core/model` and `./model`
 * are four spellings of one module, and rewriting exactly this is what turned
 * `web/src/kg` into `mobile/src/kg`. Reducing them to a common form is what lets
 * rule (a) compare a copy against its original on the day the copy is made
 * rather than months later.
 *
 * The reduction is to the FINAL SEGMENT — `model` — and the first attempt was
 * cleverer than that. It resolved relative paths against the file and expressed
 * them relative to the tree root, which is exact and which made the rule depth
 * sensitive: pasting `service/kg/core/dates.ts` to `mobile/src/lib/dates.ts`
 * turned its `./model` into `lib/model` where the original read `kg/core/model`,
 * and the copy went unreported. The same paste landing at the same depth WAS
 * caught, so the rule was passing or failing on where the copy happened to
 * land. A basename throws away the layer and keeps the shape, which is what a
 * whole-file fingerprint needs. Two different modules with the same basename
 * would have to be identical in every other byte to collide, and if they are,
 * one of them is a copy.
 */
const canonicalSpecifier = (spec) => spec.split('/').pop()

const SPECIFIER_LITERAL = /(['"])((?:@jojo\/service|@\/|\.{1,2}\/)[^'"]*)\1/g

/**
 * The hash rule (a) compares.
 *
 * Line endings and trailing whitespace are normalised because a copy that
 * crossed an editor should still be a copy, and specifiers are canonicalised
 * because a copy that crossed a package boundary always rewrites them.
 * Everything else — comments included — is left alone: the doc comments in this
 * codebase carry the reasoning, and a paste that keeps them is the paste most
 * worth catching, because it arrives claiming to be the original.
 */
function fingerprint(file) {
  const text = readFileSync(file, 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(SPECIFIER_LITERAL, (_m, q, spec) => `${q}${canonicalSpecifier(spec)}${q}`)
    .replace(/[ \t]+\n/g, '\n')
    .trim()
  return createHash('sha256').update(text).digest('hex')
}

const failures = []
const fail = (text) => failures.push(text)

/* --- (a) content ---------------------------------------------------------- */

const service = new Map()
for (const file of walk(SERVICE)) {
  if (rel(file).startsWith('service/scripts/')) continue
  service.set(fingerprint(file), file)
}

for (const app of APPS) {
  for (const file of walk(app)) {
    const twin = service.get(fingerprint(file))
    if (twin === undefined) continue
    fail(
      `${rel(file)} is a copy of ${rel(twin)}.\n` +
        `      Import it — '@jojo/service/…' — rather than pasting it. This is exactly how ` +
        `mobile/src/kg happened,\n      and it drifted 813 lines before anybody looked. If the ` +
        `shared file is nearly right, change the shared file:\n      both suites run against it, ` +
        `which is the point.`,
    )
  }
}

/* --- (b) specifier -------------------------------------------------------- */

/**
 * Where each declared subpath of the exports map lands on disk.
 *
 * Checked against the filesystem rather than trusted, because the failure mode
 * is Metro's: an undeclared or misspelled subpath was measured falling back to
 * file-based resolution with a WARNING rather than an error, so a typo reaches a
 * device as a second module instance instead of as a red build.
 */
const EXPORTED = {
  core: 'kg/core',
  storage: 'kg/storage',
  repo: 'kg/repo',
  tools: 'kg/tools',
  react: 'kg/react',
  data: 'data',
}

const SERVICE_IMPORT = /(['"])(@jojo\/service[^'"]*)\1/g
const RELATIVE_REACH = /(['"])((?:\.\.\/)+service\/[^'"]*)\1/g

for (const app of APPS) {
  for (const file of walk(app)) {
    const text = readFileSync(file, 'utf8')

    for (const [, , spec] of text.matchAll(RELATIVE_REACH)) {
      fail(
        `${rel(file)} reaches into the package with a relative path ('${spec}').\n` +
          `      Write '@jojo/service/<layer>/<name>'. A relative path bypasses the exports map ` +
          `entirely,\n      and Metro does not consult 'exports' for one — so the module arrives ` +
          `as a SECOND copy of\n      something the graph holds as a singleton, with no error ` +
          `anywhere.`,
      )
    }

    for (const [, , spec] of text.matchAll(SERVICE_IMPORT)) {
      if (spec === '@jojo/service/log') continue
      const parts = spec.slice('@jojo/service/'.length).split('/')
      const dir = EXPORTED[parts[0]]
      const name = parts.slice(1).join('/')
      if (spec === '@jojo/service' || dir === undefined || parts.length !== 2) {
        fail(
          `${rel(file)} imports '${spec}', which the exports map does not declare.\n` +
            `      The map is '@jojo/service/<layer>/<name>' for ${Object.keys(EXPORTED).join(', ')} ` +
            `plus '@jojo/service/log'.\n      There is no root export and no barrel, deliberately: ` +
            `a barrel blinds layerOf() in check-layers.mjs,\n      and Metro's minifier tree-shakes ` +
            `less than Rollup's, so a core barrel drags statistics.ts into every screen.`,
        )
        continue
      }
      const suffix = ['.ts', '.tsx'].find((ext) => existsSync(path.join(SERVICE, dir, name + ext)))
      if (suffix === undefined) {
        fail(
          `${rel(file)} imports '${spec}', and ${dir}/${name}.ts does not exist.\n` +
            `      Metro was measured resolving an undeclared subpath by falling back to the ` +
            `filesystem with a\n      warning rather than an error, so this class of typo reaches a ` +
            `device rather than a build log.`,
        )
      }
    }
  }
}

/* --- (c) shape ------------------------------------------------------------ */

const mobileKg = path.join(ROOT, 'mobile', 'src', 'kg')
for (const file of walk(mobileKg)) {
  const inside = path.relative(mobileKg, file).split(path.sep).join('/')
  if (MOBILE_KG_ALLOWED.has(inside)) continue
  fail(
    `mobile/src/kg/${inside} is not one of the two files that belong there.\n` +
      `      mobile/src/kg holds ${[...MOBILE_KG_ALLOWED].join(' and ')} — the driver that is ` +
      `genuinely\n      platform-specific, and the contract test that names it. Everything else ` +
      `under kg is\n      @jojo/service, shared, and covered by one suite instead of two.`,
  )
}

for (const { dir, why } of FORBIDDEN_DIRS) {
  if (!existsSync(dir)) continue
  fail(`${rel(dir)} exists again.\n      ${why}`)
}

/* --- (d) twins ------------------------------------------------------------ */

const known = new Set(KNOWN_TWINS.map((t) => t.file))
const webSrc = path.join(ROOT, 'web', 'src')
const mobileSrc = path.join(ROOT, 'mobile', 'src')
const web = new Map()
for (const file of walk(webSrc)) web.set(fingerprint(file), file)

for (const file of walk(mobileSrc)) {
  const twin = web.get(fingerprint(file))
  if (twin === undefined) continue
  const inside = path.relative(mobileSrc, file).split(path.sep).join('/')
  if (known.has(inside) && rel(twin) === `web/src/${inside}`) continue
  fail(
    `${rel(file)} and ${rel(twin)} are the same file.\n` +
      `      Two apps holding one file is how the last fork started. Either it belongs in ` +
      `@jojo/service —\n      the test is whether a platform event has to act on it — or the ` +
      `duplication is deliberate, in which\n      case add it to KNOWN_TWINS in this script with ` +
      `the reason, so the next one is a decision too.`,
  )
}

/* -------------------------------------------------------------------------- */

if (failures.length > 0) {
  console.error(`\ncheck-no-copies: ${failures.length} finding(s)\n`)
  for (const f of failures) console.error(`  ${f}\n`)
  console.error(
    'The rule: one copy, imported. `cp -R` was the cheapest way to share this code before the\n' +
      'workspace existed. It is not any more, and this guard is what makes that true rather than\n' +
      'aspirational. See docs/SERVICE-LAYER.md §8.\n',
  )
  process.exit(1)
}

console.log('check-no-copies: one copy of the service layer, reached through the exports map')
