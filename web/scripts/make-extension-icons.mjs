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
 * THE MARK IS THE FAVICON — jojo's robot head, the same one in the browser tab.
 * It used to be a document with a folded corner and a bookmark: a perfectly good
 * drawing of "save a page" that looked like a different product from the tab
 * beside it. An extension button and a tab favicon sit inches apart in the same
 * chrome, and a person should not have to learn that they are the same app.
 *
 * The geometry is converted from `web/public/favicon.svg` by dividing its
 * 512-unit viewBox down to the 48-unit grid this file draws on — see `u()`. That
 * keeps "the same icon" checkable rather than approximate: move an ear in the
 * SVG and the divisor says where it goes here.
 *
 * Deliberately blunt shapes: 16px is the size that actually matters and the one
 * most icons fail, because anything finer than a two-pixel stroke becomes a
 * smudge in a toolbar. The favicon's shading paths are dropped for that reason —
 * they are a few units wide at 512 and land inside one pixel at 16.
 */

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT = join(WEB, 'extension', 'icons')
const SIZES = [16, 32, 48, 128]

/**
 * The favicon's palette, and the favicon's geometry.
 *
 * Both are read off `web/public/favicon.svg` and converted from its 512-unit
 * viewBox to the 48-unit grid below by dividing by 512/48. Keeping the numbers
 * derived rather than eyeballed is what makes "the same icon" checkable: if the
 * favicon moves an ear, the divisor says where the ear goes here.
 */
const PLATE = [23, 23, 23] // #171717
const EAR = [174, 182, 191] // #aeb6bf
const HEAD = [230, 231, 232] // #e6e7e8
const VISOR = [87, 89, 107] // #57596b
const EYE = [113, 220, 239] // #71dcef

/** 512-unit viewBox to this file's 48-unit grid. */
const K = 48 / 512
const u = (n) => n * K

/** Inside a rounded rectangle, the same shape an SVG `rx` describes. */
function inRounded(x, y, rx, ry, w, h, r) {
  if (x < rx || y < ry || x > rx + w || y > ry + h) return false
  const cx = Math.min(Math.max(x, rx + r), rx + w - r)
  const cy = Math.min(Math.max(y, ry + r), ry + h - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r

/**
 * Colour at one point of a 48-unit-square design, or null for transparent.
 *
 * THE ROBOT HEAD, the same mark the browser tab shows. It used to be a document
 * with a folded corner and a bookmark — a perfectly good icon of "save a page"
 * that had nothing to do with jojo, so the tab and the toolbar button were two
 * different products as far as anyone glancing at them could tell.
 *
 * Cropped to the head for the reason the favicon gives: the full robot collapses
 * into a smudge at 16px, and the visor with two eyes is the part that survives.
 * The favicon's shading paths — the darker left edge on the head, visor and each
 * eye — are left out here. They are a few units wide at 512 and land inside a
 * single pixel at 16, where they only muddy the colour.
 *
 * Tested painter's-algorithm style, front to back: eyes, visor, head, ears,
 * plate. Supersampled 4x by `paint`, which is what keeps the plate's rounded
 * corner from stair-stepping.
 */
function at(x, y) {
  // The plate. Everything else is inside it, so it is also the clip.
  if (!inRounded(x, y, 0, 0, 48, 48, u(115))) return null

  // Ears, behind the head and poking out either side.
  if (inRounded(x, y, u(8), u(200), u(56), u(112), u(21))) return EAR
  if (inRounded(x, y, u(448), u(200), u(56), u(112), u(21))) return EAR

  // Eyes, then the visor they sit in, then the head around it.
  if (inCircle(x, y, u(196), u(256), u(41))) return EYE
  if (inCircle(x, y, u(316), u(256), u(41))) return EYE
  if (inRounded(x, y, u(106), u(153), u(300), u(206), u(99))) return VISOR
  if (inRounded(x, y, u(46), u(117), u(420), u(278), u(133))) return HEAD

  return PLATE
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
