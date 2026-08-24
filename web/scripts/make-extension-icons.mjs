/**
 * Draws the extension's toolbar icons.
 *
 * They were missing, and the consequence was not cosmetic: a Chromium extension
 * with no `icons` gets a grey placeholder bearing the first letter of its name.
 * In a pinned row of extensions that is genuinely hard to pick out — and looking
 * for the button is the first thing anyone does after installing.
 *
 * THE MARK IS THE FAVICON — jojo's robot head, the same one in the browser tab
 * and now the same one on both app launchers. It used to be a document with a
 * folded corner and a bookmark: a perfectly good drawing of "save a page" that
 * looked like a different product from the tab beside it. An extension button
 * and a tab favicon sit inches apart in the same chrome, and a person should not
 * have to learn that they are the same app.
 *
 * The drawing itself lives in `scripts/jojo-mark.mjs` at the root of the repo,
 * because the phone needs it too. This file is only the list of sizes and where
 * they go. Blunt shapes and no shading are deliberate and argued there: 16px is
 * the size that actually matters and the one most icons fail.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { paint, png } from '../../scripts/jojo-mark.mjs'

const WEB = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT = join(WEB, 'extension', 'icons')
const SIZES = [16, 32, 48, 128]

mkdirSync(OUT, { recursive: true })
for (const size of SIZES) {
  // The favicon's own squircle plate, edge to edge — a toolbar has no mask of
  // its own, so the icon has to bring its corners with it.
  writeFileSync(join(OUT, `icon-${String(size)}.png`), png(size, paint(size, { plate: 'rounded' })))
  console.log(`  icon-${String(size)}.png`)
}
console.log(`make-extension-icons: ${String(SIZES.length)} icons -> web/extension/icons/`)
