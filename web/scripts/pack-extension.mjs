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
 * Uses the system `zip`, which is present on macOS and Linux, rather than adding
 * an archiver dependency to an app that has none. On a machine without it the
 * script says so and exits non-zero rather than writing a corrupt file.
 *
 * Output goes to `web/public/`, which Vite copies to the build root verbatim —
 * so the download works in `npm run dev` and in a built `dist/` with no server
 * route and no bundler involvement.
 */

import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = dirname(dirname(fileURLToPath(import.meta.url)))
const SOURCE = join(WEB, 'extension')
const PUBLIC = join(WEB, 'public')
const OUT = join(PUBLIC, 'jojo-extension.zip')

if (!existsSync(SOURCE)) {
  console.error(`pack-extension: ${SOURCE} does not exist`)
  process.exit(1)
}

/*
 * `--optional` — asked for by `npm run dev`, and not by `npm run build`.
 *
 * A missing `zip` used to stop both, and the reasoning for stopping the BUILD
 * still holds: shipping a Settings page whose Download button hands somebody
 * Vite's index.html renamed to .zip fails three steps later at the unzip and
 * reads as a corrupt download.
 *
 * Stopping `dev` was a different thing wearing the same argument. `zip` is on
 * macOS and on most Linux images and is not on a plain Windows box, so the
 * first thing a Windows contributor met was a dev server that would not start,
 * over a download button they were not working on. Skipping it there costs one
 * 404 on a page nobody is testing; failing there costs the contributor.
 */
const optional = process.argv.includes('--optional')

try {
  execFileSync('zip', ['--version'], { stdio: 'ignore' })
} catch {
  const where = optional
    ? '  Skipping it: `npm run dev` runs anyway, and the extension download in\n' +
      '  Settings will 404 until `zip` is available. `npm run build` still fails\n' +
      '  on this, because a published build with a broken download is worse than\n' +
      '  no build.\n'
    : '  `npm run build` stops here: the alternative is a Settings page whose\n' +
      "  Download button hands the user Vite's index.html renamed to .zip, which\n" +
      '  fails three steps later at the unzip and reads as a corrupt download.\n'
  console.error(
    `pack-extension: no \`zip\` on PATH.\n${where}` +
      '  macOS and most Linux images ship `zip`; on Debian it is `apt install zip`,\n' +
      '  and on Windows it comes with Git Bash or `winget install 7zip.7zip`.',
  )
  process.exit(optional ? 0 : 1)
}

/**
 * Staged under its own directory name so the archive contains
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
for (const file of readdirSync(SOURCE).filter((f) => f.endsWith('.js'))) {
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

const stage = mkdtempSync(join(tmpdir(), 'jojo-ext-'))
const folder = join(stage, 'jojo-extension')
cpSync(SOURCE, folder, { recursive: true })

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
  const path = join(folder, 'manifest.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
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
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`pack-extension: added ${pattern} to content_scripts.matches`)
}

mkdirSync(PUBLIC, { recursive: true })
rmSync(OUT, { force: true })

// -X drops the extra file attributes (uid/gid, and on macOS the AppleDouble
// entries) so the archive is the same bytes wherever it is built. It does NOT
// exclude `.DS_Store`, which is a real file rather than an attribute — hence the
// explicit exclusion below, because Chrome refuses to load an unpacked
// extension whose directory contains files it cannot account for.
execFileSync('zip', ['-r', '-X', '-q', OUT, 'jojo-extension', '-x', '*.DS_Store', '__MACOSX/*'], {
  cwd: stage,
})
rmSync(stage, { recursive: true, force: true })

const { version } = JSON.parse(readFileSync(join(SOURCE, 'manifest.json'), 'utf8'))
const size = statSync(OUT).size
console.log(
  `pack-extension: jojo-extension.zip v${version}, ${(size / 1024).toFixed(1)} KB -> web/public/`,
)
