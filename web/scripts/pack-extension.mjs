/**
 * Packs `web/extension/` into a zip the app can hand the user.
 *
 * jojo cannot install its own extension — no Chromium browser has allowed that
 * since `chrome.webstore.install()` was removed in Chrome 71, and a self-signed
 * `.crx` fails `CRX_REQUIRED_PROOF_MISSING` on every desktop OS including via
 * drag-drop, because Chromium checks for Google's publisher key however the file
 * arrived. So the best available flow is Developer mode → Load unpacked, and the
 * one thing the app CAN do is make the download a single click on a file that
 * unzips into exactly the folder that step wants.
 *
 * Hence the shape: one top-level directory named `jojo-extension`, so whatever
 * the user's unzipper does, "pick the folder" is unambiguous. A zip of loose
 * files would scatter into Downloads and the next step would fail on something
 * that is not the extension's fault.
 *
 * Zipped with fflate — already a dependency of the app, for "Download every
 * document" — rather than the system `zip`, for two reasons. The output is
 * byte-for-byte reproducible: every entry gets the same fixed timestamp and the
 * entries go in sorted order, so packing the same files twice gives the same
 * zip. With `zip` each pack stamped the staging copy's fresh mtimes, the zip
 * changed on every build, and since the service worker's VERSION hashes every
 * file in `dist/`, every build shipped a "new" worker and threw away every
 * visitor's cache (R32). And it needs nothing on PATH, so a Windows checkout
 * builds too.
 *
 * Output goes to `web/public/`, which Vite copies to the build root verbatim —
 * so the download works in `npm run dev` and in a built `dist/` with no server
 * route and no bundler involvement.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, posix, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'

const WEB = dirname(dirname(fileURLToPath(import.meta.url)))
const SOURCE = join(WEB, 'extension')
const PUBLIC = join(WEB, 'public')
const OUT = join(PUBLIC, 'jojo-extension.zip')

if (!existsSync(SOURCE)) {
  console.error(`pack-extension: ${SOURCE} does not exist`)
  process.exit(1)
}

/**
 * Every entry sits under one directory name, so the archive contains
 * `jojo-extension/manifest.json` rather than `manifest.json` at the root. The
 * whole point is that the user ends up with one folder to point Chrome at.
 */
/*
 * Every script in the extension has to PARSE before it is packed.
 *
 * Little else checks these files. They are plain `.js` outside the TypeScript
 * projects and no test loads them — so a syntax error here is invisible until a
 * browser silently declines to run the script.
 *
 * They ARE linted now, which they were not when this was written. `web`'s
 * oxlint config listed `extension` in `ignorePatterns` AND the lint script
 * passed only `src`, so two independent things had to change; measured with a
 * deliberate unused variable in `policy.js`, the whole gate went green with it
 * in place. Linting costs nothing — the directory was already clean under the
 * project's own rules — and the argument for adding it is that the 2026-08-26
 * audit found three exploitable bugs in exactly these 2,547 lines, and a parse
 * check cannot see any of that class. Typechecking and tests are still absent,
 * so the paragraph below still holds for everything a parser cannot reach.
 *
 * Chrome still creates the content script's isolated world, the extension still
 * reports itself installed and healthy, and the only symptom is that the page's
 * messages are never answered: "the jojo browser extension did not answer",
 * from an extension that is right there.
 *
 * This is not hypothetical. A `*` followed by a `/` inside a block comment ends
 * the comment early, and a URL pattern written into one turned the rest of
 * `bridge.js` into garbage that never registered its listener.
 *
 * Parsed, never executed — these files call `chrome.*` at their top level and
 * there is no `chrome` here. Both module kinds are tried because the directory
 * holds both: `background.js` is an ES module service worker, and the content
 * scripts are classic scripts. A file that parses as either is fine; a file
 * that parses as neither is the failure this exists to catch.
 */
// Recursive, so the service worker's modules under `worker/` are checked too —
// a top-level-only read zipped them without ever parsing them.
for (const file of readdirSync(SOURCE, { recursive: true }).filter((f) => String(f).endsWith('.js'))) {
  const source = readFileSync(join(SOURCE, file), 'utf8')
  const errors = []
  for (const type of ['module', 'commonjs']) {
    try {
      execFileSync(process.execPath, ['--input-type', type, '--check'], {
        input: source,
        stdio: ['pipe', 'ignore', 'pipe'],
      })
      errors.length = 0
      break
    } catch (error) {
      errors.push(String(error.stderr ?? error.message).split('\n').find((l) => /Error/.test(l)))
    }
  }
  if (errors.length > 0) {
    console.error(`pack-extension: ${file} does not parse — ${errors.join(' / ')}`)
    console.error('The extension would install and answer nothing. Refusing to pack it.')
    process.exit(1)
  }
}

/** Never packed: Finder's litter, which Chrome refuses to load beside an extension. */
const JUNK = /(^|\/)(\.DS_Store|__MACOSX)(\/|$)/

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

/** Every file to pack, by its path inside the extension, in a fixed order. */
const files = new Map(
  walk(SOURCE)
    .map((full) => [relative(SOURCE, full).split(sep).join(posix.sep), full])
    .filter(([rel]) => !JUNK.test(rel))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([rel, full]) => [rel, readFileSync(full)]),
)

/*
 * The origin this build of the app will be served from, added to the packed
 * manifest.
 *
 * `content_scripts.matches` is the only thing that decides whether the bridge
 * exists on a page, so an origin missing from it is an extension that installs,
 * reports itself healthy, and silently answers nothing — which is exactly how
 * the hosted app came to say "the extension did not answer" while the extension
 * was running.
 *
 * The checked-in manifest names this repository's own Pages URL, which covers
 * the published build and every developer. A FORK is served from somewhere else
 * and would otherwise have to hand-edit the manifest, so `JOJO_APP_ORIGIN` sets
 * it at pack time — the same shape as `BASE_PATH` in the workflow, and set from
 * the same place.
 *
 * Appended rather than replacing: the dev ports have to keep working in a fork
 * too, and dropping them would trade one silent failure for another.
 */
const extra = (process.env.JOJO_APP_ORIGIN ?? '').trim()
if (extra) {
  const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')))
  /*
   * `${origin}/*`, never a bare origin. A match pattern MUST carry a path
   * component: `https://example.com` is invalid, and Chrome's response to one
   * invalid entry is to drop the whole content_scripts block — so the extension
   * installs, reports itself healthy, and injects nothing anywhere. That failure
   * is silent in exactly the way that cost a day here.
   */
  const pattern = `${extra.replace(/\/+$/, '')}/*`
  if (!manifest.content_scripts[0].matches.includes(pattern)) {
    manifest.content_scripts[0].matches.push(pattern)
  }
  files.set('manifest.json', new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`))
  console.log(`pack-extension: added ${pattern} to content_scripts.matches`)
}

/*
 * One fixed timestamp for every entry, built from LOCAL date parts because a
 * zip's DOS time is local time and fflate encodes it from the local parts:
 * this way the bytes are the same in every time zone. 1980-01-01 is the DOS
 * epoch, the earliest a zip can say — and plainly not a real modification time.
 */
const FIXED = new Date(1980, 0, 1, 0, 0, 0)

const entries = {}
for (const [rel, bytes] of files) entries[`jojo-extension/${rel}`] = [bytes, { mtime: FIXED }]

mkdirSync(PUBLIC, { recursive: true })
writeFileSync(OUT, zipSync(entries, { level: 9 }))

const { version } = JSON.parse(readFileSync(join(SOURCE, 'manifest.json'), 'utf8'))
const size = statSync(OUT).size
console.log(
  `pack-extension: jojo-extension.zip v${version}, ${(size / 1024).toFixed(1)} KB -> web/public/`,
)
