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
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs'
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

try {
  execFileSync('zip', ['--version'], { stdio: 'ignore' })
} catch {
  console.error(
    'pack-extension: no `zip` on PATH.\n' +
      '  The extension is plain files — the app can still be built, but the\n' +
      '  download on the install page will 404 until this runs somewhere that\n' +
      '  has it. macOS and most Linux images ship it.',
  )
  process.exit(1)
}

/**
 * Staged under its own directory name so the archive contains
 * `jojo-extension/manifest.json` rather than `manifest.json` at the root. The
 * whole point is that the user ends up with one folder to point Chrome at.
 */
const stage = mkdtempSync(join(tmpdir(), 'jojo-ext-'))
const folder = join(stage, 'jojo-extension')
cpSync(SOURCE, folder, { recursive: true })

mkdirSync(PUBLIC, { recursive: true })
rmSync(OUT, { force: true })

// -X drops the extended attributes macOS otherwise embeds, which show up as
// `__MACOSX/` entries and a `.DS_Store` that Chrome then complains about.
execFileSync('zip', ['-r', '-X', '-q', OUT, 'jojo-extension'], { cwd: stage })
rmSync(stage, { recursive: true, force: true })

const { version } = JSON.parse(readFileSync(join(SOURCE, 'manifest.json'), 'utf8'))
const size = statSync(OUT).size
console.log(
  `pack-extension: jojo-extension.zip v${version}, ${(size / 1024).toFixed(1)} KB -> web/public/`,
)
