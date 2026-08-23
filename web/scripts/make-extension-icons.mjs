/**
 * Draws the extension's toolbar icons.
 *
 * They were missing, and the consequence was not cosmetic: a Chromium extension
 * with no `icons` gets a grey placeholder bearing the first letter of its name.
 * In a pinned row of extensions that is genuinely hard to pick out — and looking
 * for the button is the first thing anyone does after installing.
 *
 * Rasterised here in plain Node rather than rendered by a browser or committed
 * as base64 blobs. A browser step needs a browser on whatever machine builds
 * this and was measurably flaky; committed binaries would be four opaque files
 * nobody can review or adjust. The artwork is the `paint` function below, which
 * is readable and editable, and the PNG encoder under it is thirty lines of
 * zlib.
 *
 * The mark is a document with a folded corner and a bookmark, on jojo's own
 * near-black. Deliberately blunt shapes: 16px is the size that actually matters
 * and the one most icons fail, because anything finer than a two-pixel stroke
 * becomes a smudge in a toolbar.
 */

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT = join(WEB, 'extension', 'icons')
const SIZES = [16, 32, 48, 128]

/** jojo's palette — `--page`, `--text-1` and `--series-1` from web/src/index.css. */
const INK = [10, 10, 10]
const PAPER = [250, 250, 250]
const FOLD = [200, 200, 200]
const MARK = [62, 150, 198]
const RULE = [120, 120, 120]

/**
 * Colour at one point of a 48-unit-square design, or null for transparent.
 *
 * Written against a fixed 48-unit grid so the artwork is size-independent; the
 * caller samples it. Supersampled 4x by `paint`, which is what keeps the rounded
 * corner from stair-stepping at 16px.
 */
function at(x, y) {
  // Rounded-square tile.
  const r = 11
  const inside =
    x >= 0 &&
    y >= 0 &&
    x <= 48 &&
    y <= 48 &&
    (() => {
      const cx = Math.min(Math.max(x, r), 48 - r)
      const cy = Math.min(Math.max(y, r), 48 - r)
      return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
    })()
  if (!inside) return null

  // The bookmark sits proud of the page, so it is tested first.
  if (x >= 31 && x <= 38 && y >= 24 && y <= 38) {
    // Notch at the foot: two diagonals meeting in the middle.
    const notch = y > 34 && Math.abs(x - 34.5) < y - 34
    if (!notch) return MARK
  }

  // The page.
  if (x >= 11 && x <= 35 && y >= 11 && y <= 39) {
    // Folded corner: the triangle above the diagonal from (27,11) to (35,19).
    if (x >= 27 && y <= 19 && x - 27 >= y - 11) return FOLD
    // Two ruled lines.
    if (x >= 15 && x <= 27 && y >= 23 && y <= 25.6) return RULE
    if (x >= 15 && x <= 31 && y >= 28 && y <= 30.6) return RULE
    return PAPER
  }

  return INK
}

/** RGBA bytes for one square icon, 4x supersampled. */
function paint(size) {
  const px = Buffer.alloc(size * size * 4)
  const S = 4
  for (let iy = 0; iy < size; iy += 1) {
    for (let ix = 0; ix < size; ix += 1) {
      let r = 0
      let g = 0
      let b = 0
      let hits = 0
      for (let sy = 0; sy < S; sy += 1) {
        for (let sx = 0; sx < S; sx += 1) {
          const c = at(((ix + (sx + 0.5) / S) * 48) / size, ((iy + (sy + 0.5) / S) * 48) / size)
          if (c === null) continue
          r += c[0]
          g += c[1]
          b += c[2]
          hits += 1
        }
      }
      const i = (iy * size + ix) * 4
      const total = S * S
      if (hits === 0) continue
      px[i] = Math.round(r / hits)
      px[i + 1] = Math.round(g / hits)
      px[i + 2] = Math.round(b / hits)
      // Coverage becomes alpha, which is what antialiases the rounded corner.
      px[i + 3] = Math.round((hits / total) * 255)
    }
  }
  return px
}

/** A minimal PNG: signature, IHDR, IDAT, IEND. */
function png(size, rgba) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf) => {
    let c = 0xffffffff
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // truecolour with alpha
  // Each scanline is prefixed with its filter type; 0 is "none", which costs a
  // little size and removes every way to get the filtering wrong.
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(OUT, { recursive: true })
for (const size of SIZES) {
  const file = join(OUT, `icon-${String(size)}.png`)
  writeFileSync(file, png(size, paint(size)))
  console.log(`  icon-${String(size)}.png`)
}
console.log(`make-extension-icons: ${String(SIZES.length)} icons -> web/extension/icons/`)
