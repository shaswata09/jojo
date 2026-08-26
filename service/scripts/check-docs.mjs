/**
 * Every repository path a document names, checked against the repository.
 *
 * ## Why
 *
 * An audit of these files found roughly twenty stale claims, and the ones that
 * cost a reader most are the concrete ones: a path that moved. `EXPO-REMOVAL.md`
 * said the `FileStore` port lived at `web/src/kg/storage/file-store.ts` long
 * after the extraction put it in `service/`, and a reader who went looking found
 * nothing and had no way to tell whether the file or the sentence was wrong.
 *
 * Prose rots; a path either resolves or it does not. So the paths are checked
 * and the prose is left to people.
 *
 * ## What is NOT a failure
 *
 * Plenty of documented paths are deliberately not files. A hypothetical
 * (`SERVICE-LAYER.md` explains what `@/data/timeline` WOULD bind to on each
 * platform, which is the argument for not using `@/` at all), a proposal, a
 * build output, an ellipsis. Those go in ALLOWED with the reason, which is the
 * same bargain `check-no-copies`'s KNOWN_TWINS makes: an exception is fine and
 * an unexamined one is not.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Paths a document names on purpose that are not, and need not be, files. */
const ALLOWED = new Map([
  ['web/dist/', 'a build output, named in the deploy instructions'],
  ['mobile/src/data', 'a hypothetical: what `@/data/…` WOULD bind to under Metro, which is the argument for not using `@/` inside the package'],
  ['web/src/data/timeline', 'the same hypothetical, on the other platform'],
  ['mobile/react-native.config.js', 'a proposal in a migration note, written before the approach changed'],
  ['scripts/check-tokens.mjs', 'proposed in KG-ARCHITECTURE as an option, and explicitly "optionally"'],
  // Named in order to say it is WRONG. Both sentences are about a tool looking
  // in a place that does not exist, so the path resolving would mean the
  // sentence had stopped being true.
  ['mobile/android/ios', 'the path a broken `cd android && cd ios` looked for — named as the bug'],
  ['mobile/package.json/android/settings.gradle', 'the same: the document says "That cannot exist" in the next sentence'],
  /*
   * Deliberately gitignored, and named in order to say WHERE THEY GO.
   *
   * These are the one case the rule cannot decide for itself: the sentence is
   * correct, the reader is meant to create the file, and the file must not be
   * committed. `RELEASE.md` gives each one a column that reads "no — gitignored",
   * so a reader who follows the path and finds nothing has already been told why.
   *
   * They are also the reason this guard is worth having: all three resolve on the
   * machine of anybody who has set Firebase up, so the failure only ever appears
   * on a clean checkout — which is CI, and which is every new contributor.
   */
  ['mobile/android/app/google-services.json', "Firebase's Android config: gitignored so a fork does not report into this project's console, and RELEASE.md names it to say where to put it"],
  ['mobile/ios/jojo/GoogleService-Info.plist', 'the same file on the other platform, on the same terms'],
  ['mobile/android/local.properties', 'written by the Android SDK tools and gitignored because it holds one machine\'s SDK path; the README names it to say what to put in it'],
])

const docs = [
  'README.md',
  ...readdirSync(path.join(ROOT, 'docs'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => `docs/${f}`),
]

/*
 * Backticked, and rooted at a workspace we can check. Anything else in backticks
 * is a symbol, a command or a fragment, and guessing which would make this
 * guard's failures untrustworthy — which is worse than not having it.
 */
const PATH_IN_TICKS = /`((?:web|mobile|service|docs)\/[A-Za-z0-9_.@/-]+)`/g

const failures = []
for (const doc of docs) {
  const text = readFileSync(path.join(ROOT, doc), 'utf8')
  for (const [i, line] of text.split('\n').entries()) {
    for (const match of line.matchAll(PATH_IN_TICKS)) {
      const named = match[1]
      // An ellipsis is prose about a family of files, not a claim about one.
      if (named.includes('...') || named.includes('…')) continue
      if (ALLOWED.has(named)) continue
      const full = path.join(ROOT, named)
      // A bare name may be missing its extension — `kg/core/model` for
      // `model.ts` — which is how these are written and is not a mistake.
      const found =
        existsSync(full) || ['.ts', '.tsx', '.mjs', '.js', '.md', '.json'].some((e) => existsSync(full + e))
      if (!found) failures.push(`${doc}:${i + 1}  names \`${named}\`, which is not in the repository`)
    }
  }
}

if (failures.length > 0) {
  console.error(`\ncheck-docs: ${failures.length} finding(s)\n`)
  for (const f of failures) console.error(`  ${f}`)
  console.error(
    '\nThe rule: a path in a document either resolves or is listed in ALLOWED with the reason it\n' +
      'is not a file. A reader who follows a path and finds nothing cannot tell whether the file\n' +
      'moved or the sentence was always wrong.\n',
  )
  process.exit(1)
}

console.log('check-docs: every path named in README and docs/ resolves')
