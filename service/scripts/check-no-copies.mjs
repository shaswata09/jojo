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

/**
 * Every app in the workspace, read from `package.json` rather than named here.
 *
 * This used to be the literal `[web/src, mobile/src]`, and so did the adapter
 * lists in `check-layers.mjs` and `check-platform.mjs`. That is the one shape
 * this guard cannot afford: a third app added to the workspace would have been
 * governed by NOTHING — not this file, not the layer rule, not the platform rule
 * — while all three still printed a reassuring green line. The fork this script
 * exists to prevent grew for four months under exactly that condition, and a
 * third platform is the point of `@jojo/service` existing at all, so the
 * condition was scheduled to recur on the day the reason for it arrived.
 *
 * Discovery rather than a third literal, because a literal has to be remembered
 * at precisely the moment nobody is thinking about lint. `service` is excluded —
 * it is what the apps are compared AGAINST — and a workspace with no `src/` is
 * skipped, so a future tooling or docs package is not a failure.
 */
function appRoots() {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const names = Array.isArray(manifest.workspaces) ? manifest.workspaces : []
  return names
    .filter((name) => name !== 'service')
    .map((name) => path.join(ROOT, ...name.split('/'), 'src'))
    .filter((dir) => existsSync(dir))
}

const APPS = appRoots()

/**
 * What each app's `src/kg` is allowed to contain, exhaustively.
 *
 * An allowlist rather than a size limit, because the failure this prevents is a
 * directory that grows one plausible file at a time. Every entry was argued for
 * in `docs/SERVICE-LAYER.md`: the driver is genuinely platform-specific, and its
 * contract test names a driver so it cannot live in the package that owns the
 * contract.
 *
 * Web has one too now. It did not, and the asymmetry was not a decision: the
 * mobile list was written when mobile's `src/kg` was an 81-file fork and web's
 * was where the layer had just left from, so nobody wrote the rule for the
 * directory that looked settled. Measured before adding it — a new `.tsx` under
 * `web/src/kg` passed all three guards and failed both under `mobile/src/kg`.
 * Web's list is longer because the IndexedDB driver is genuinely more than one
 * file: `idb` is wrapped, migrated, batched and channelled, and each of those
 * pieces is browser-only. That is a reason for the entries, not for the absence
 * of a list.
 */
const APP_KG_ALLOWED = {
  'mobile/src/kg': new Set(['storage/rn-driver.ts', 'storage/rn-conformance.test.ts']),
  'web/src/kg': new Set([
    'storage/idb-driver.ts',
    'storage/idb-driver.test.ts',
    'storage/idb-conformance.test.ts',
    'storage/idb-batch.ts',
    'storage/idb-events.ts',
    'storage/idb-handles.ts',
    'storage/idb-migrate.ts',
    'storage/channel.ts',
    'storage/probe.ts',
    // The folder half, and browser-only for the same reason the driver is: the
    // File System Access API exists in no other host. `fs-file-store.ts` is the
    // `FileStore` port over a `FileSystemDirectoryHandle`; `folder-connect.ts`
    // is the picker, the permission model and the remembered handle, which is
    // the part that needs a user gesture and a native dialog.
    //
    // The port, the folder layout and the 23-case contract suite all stayed in
    // the package, so the phone's adapter — deferred, see `FileProps.uri` — gets
    // the same contract rather than a second reading of it.
    'storage/fs-file-store.ts',
    'storage/folder-connect.ts',
  ]),
}

/** Directories that must not come back at all. */
const FORBIDDEN_DIRS = [
  {
    dir: path.join(ROOT, 'mobile', 'src', 'data'),
    why:
      'The demo fixtures are `service/data`, read through `@jojo/service/data/…`. Mobile shipped a ' +
      'second copy of them with six names web did not have, and one of those — a `buildMonth` that ' +
      "closed over its own `TODAY` — differed from web's by an ARITY, so every call site compiled " +
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
  {
    file: 'lib/labels.tsx',
    // Was 'UI state, not graph state'. That reason was wrong and the exemption
    // it bought cost a live bug: the two copies drifted 58 lines, web learned
    // to drop a selected keyword that had since been deleted, and mobile did
    // not — so resetting the demo left the phone's list reading "0 shown, 12
    // total" with no chip on screen to explain it. WHICH KEYWORDS ARE LIT is
    // app state; WHICH OF THEM STILL EXIST is a question about the graph, and
    // that half now lives in `kg/core/label-selection` and is shared. What is
    // left twinned is the provider wiring around it.
    why: 'the provider wiring; the rule itself is shared in kg/core/label-selection',
  },
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

/**
 * Modules the exports map reaches and no app may name.
 *
 * The map is seven stars, one per layer, and a star is a LAYER boundary rather
 * than an API boundary: `@jojo/service/tools/runtime-tx` resolves as readily as
 * `@jojo/service/tools/runtime`. The three transaction internals are the ones
 * that matter. `makeTx` and `stage` write into a buffer, and `repo.commit` being
 * the only path from a buffer to the durable op list is the whole of D12 — an
 * app holding `makeTx` can write to the graph with no journal entry and no
 * before-image, which is a write that cannot be undone and does not appear in
 * the audit log. `boot-live` and `boot-ready` are continuations of `boot`, not
 * entry points, and calling one directly skips the trust boundary in the other.
 *
 * Enforced HERE rather than by narrowing the map, deliberately. Replacing
 * `"./tools/*"` with explicit keys would restrict resolution itself, which is
 * stronger — but it is also a change to how four resolvers behave, on a package
 * whose own `//exports` note records that one character across those four cost
 * two probes to get right. Nothing imports any of these today (measured across
 * both apps), so what is needed is a rule that says so before the first one does,
 * and this file already reads every app specifier. The map stays the shape the
 * bundlers agreed on; the boundary is stated where it can be argued with.
 */
const APP_MAY_NOT_IMPORT = {
  'tools/runtime-tx': 'the transaction writer',
  'tools/runtime-buffer': 'the transaction buffer',
  'tools/runtime-overlay': 'the transaction read overlay',
  'repo/boot-live': 'a continuation of boot(), not an entry point',
  'repo/boot-ready': 'a continuation of boot(), not an entry point',
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
      const why = APP_MAY_NOT_IMPORT[`${parts[0]}/${name}`]
      if (why !== undefined) {
        fail(
          `${rel(file)} imports '${spec}' — ${why}.\n` +
            `      The exports map is one star per LAYER, so this resolves; that is a fact about ` +
            `the map rather\n      than permission. Go through the layer's entry point: the tool ` +
            `runtime for a write,\n      'repo/boot' for a boot. A transaction written outside ` +
            `repo.commit has no journal entry and\n      no before-image, which is a write with ` +
            `no undo and no audit row (D12).\n      See APP_MAY_NOT_IMPORT in this script.`,
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

/*
 * Driven by the discovered apps, not by the keys of APP_KG_ALLOWED.
 *
 * Keying the loop on the allowlist meant an app with no entry was not checked at
 * all — the absence of a rule read as permission, which is backwards. An
 * unlisted app now gets an EMPTY allowlist, so the first file under its `src/kg`
 * fails and says what to do about it. That is the safe direction: a genuinely
 * new adapter is a deliberate act and a one-line edit here, whereas a silent
 * second copy of the layer is the failure this whole file is about.
 */
for (const appSrc of APPS) {
  const appKg = `${rel(appSrc)}/kg`
  const allowed = APP_KG_ALLOWED[appKg] ?? new Set()
  const root = path.join(appSrc, 'kg')
  if (!existsSync(root)) continue
  for (const file of walk(root)) {
    const inside = path.relative(root, file).split(path.sep).join('/')
    if (allowed.has(inside)) continue
    fail(
      `${appKg}/${inside} is not one of the ${allowed.size} files that belong there.\n` +
        `      ${appKg} holds only what is genuinely platform-specific — the driver, the pieces it ` +
        `is built\n      from, and the contract test that names it. Everything else under kg is ` +
        `@jojo/service,\n      shared, and covered by one suite instead of two. If this file really ` +
        `is platform-only,\n      add it to APP_KG_ALLOWED in this script; if it is not, it belongs ` +
        `in the package.`,
    )
  }
}

for (const { dir, why } of FORBIDDEN_DIRS) {
  if (!existsSync(dir)) continue
  fail(`${rel(dir)} exists again.\n      ${why}`)
}

/* --- (d) twins ------------------------------------------------------------ */

const known = new Set(KNOWN_TWINS.map((t) => t.file))

/*
 * Every pair of apps, not web against mobile.
 *
 * The comparison was `web/src` on one side and `mobile/src` on the other, which
 * is exhaustive for two apps and silently partial for three: a file shared by
 * mobile and a desktop app, or by web and a desktop app, would never have been
 * looked at. Fingerprints are collected per app and compared across every pair,
 * so a third app costs a third column rather than leaving two thirds of the
 * surface unchecked.
 *
 * A KNOWN_TWINS entry names a path INSIDE an app, so it exempts that path in
 * whichever pair it turns up in — the honest reading of the list, whose four
 * entries say "this file is deliberately duplicated" and not "deliberately
 * duplicated between these two apps specifically".
 */
const printed = new Set()
const byApp = APPS.map((src) => {
  const seen = new Map()
  for (const file of walk(src)) seen.set(fingerprint(file), file)
  return { src, seen }
})

for (let i = 0; i < byApp.length; i += 1) {
  for (let j = i + 1; j < byApp.length; j += 1) {
    for (const [print, file] of byApp[j].seen) {
      const twin = byApp[i].seen.get(print)
      if (twin === undefined) continue
      const inside = path.relative(byApp[j].src, file).split(path.sep).join('/')
      const twinInside = path.relative(byApp[i].src, twin).split(path.sep).join('/')
      if (known.has(inside) && twinInside === inside) continue
      const key = `${rel(twin)}|${rel(file)}`
      if (printed.has(key)) continue
      printed.add(key)
      fail(
        `${rel(file)} and ${rel(twin)} are the same file.\n` +
          `      Two apps holding one file is how the last fork started. Either it belongs in ` +
          `@jojo/service —\n      the test is whether a platform event has to act on it — or the ` +
          `duplication is deliberate, in which\n      case add it to KNOWN_TWINS in this script with ` +
          `the reason, so the next one is a decision too.`,
      )
    }
  }
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
