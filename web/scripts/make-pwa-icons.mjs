/**
 * Draws the icons the web app manifest needs.
 *
 * Installing jojo puts it in a dock, a taskbar or a home screen, and what lands
 * there is one of these. They are the same robot head as the browser tab, the
 * extension button and both native launchers — `scripts/jojo-mark.mjs` at the
 * root of the repo is the single drawing all four come from, so the four places
 * jojo has a mark cannot drift apart.
 *
 * TWO PURPOSES, TWO DRAWINGS, and the difference is not size.
 *
 *   `any`      — the favicon exactly: the robot on its own rounded plate, edge
 *                to edge. What a desktop dock and a browser's own install UI
 *                show, neither of which crops.
 *   `maskable` — the same robot, smaller, on a plate that fills the whole
 *                square. Android crops an installed icon to whatever shape the
 *                launcher uses, and it crops the FILE, not the artwork: a
 *                rounded plate handed to a circular mask loses its corners and
 *                gains a ragged edge. So the plate goes square and the mark
 *                shrinks into the safe zone.
 *
 * `ADAPTIVE_SPAN` is reused rather than re-derived for that second one. It was
 * worked out for Android's adaptive launcher icon, which asks the same question
 * — how much of the canvas survives an unknown mask — and answers it more
 * strictly than the web's 80% safe zone does. One constant, and the phone and
 * the browser cannot disagree about how big the robot is.
 *
 * Run before every build, like the extension's icons, so the committed PNGs
 * cannot fall behind the drawing they come from.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ADAPTIVE_SPAN, paint, png } from '../../scripts/jojo-mark.mjs'

const WEB = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT = join(WEB, 'public', 'icons')

/**
 * 192 and 512 are the two the spec's own guidance names, and between them they
 * cover every launcher: 192 is what Android uses for the home screen, 512 is
 * what a splash screen and every desktop install dialog scale from.
 */
const ICONS = [
  { file: 'icon-192.png', size: 192, opts: { plate: 'rounded' } },
  { file: 'icon-512.png', size: 512, opts: { plate: 'rounded' } },
  { file: 'icon-maskable-512.png', size: 512, opts: { plate: 'square', span: ADAPTIVE_SPAN } },
]

mkdirSync(OUT, { recursive: true })
for (const icon of ICONS) {
  writeFileSync(join(OUT, icon.file), png(icon.size, paint(icon.size, icon.opts)))
  console.log(`  ${icon.file}`)
}
console.log(`make-pwa-icons: ${String(ICONS.length)} icons -> web/public/icons/`)
