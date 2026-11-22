/**
 * The Transfer scene's two textures are drawn by this repository, and are the
 * size the scene says they are.
 *
 * They used to be two images of unrecorded origin, vendored from a third-party
 * image host. They were replaced with the output of
 * `scripts/make-transfer-scene.py` so the shipped pixels have a source anyone
 * can read and re-run. This pins the two facts that replacement rests on:
 *
 * - The generator is in the tree and writes exactly the two files the scene
 *   loads. If the script is deleted, or renamed away from the files, the
 *   credit on the Built with page is pointing at nothing.
 * - Both files are MAP_WIDTH x MAP_HEIGHT. The plane's aspect comes from those
 *   constants, not from the image, so a regenerated texture at another size
 *   would be silently stretched. Read from the file headers, so no image
 *   decoder is needed.
 *
 * `import.meta.glob` with `?inline` rather than `node:fs`: this app has no
 * Node types on purpose (see lib/public-assets.test.ts), and `?inline` hands
 * back the bytes as a base64 data URL.
 */

import { describe, expect, it } from 'vitest'
import { MAP_HEIGHT, MAP_WIDTH } from './textures'
import texturesSource from './textures.ts?raw'

const files = import.meta.glob('/public/transfer/*', {
  query: '?inline',
  import: 'default',
  eager: true,
}) as Record<string, string>

const generator = import.meta.glob('/scripts/make-transfer-scene.py', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function bytes(path: string): Uint8Array {
  const url = files[path]
  expect(url, path).toBeTypeOf('string')
  const b64 = url.slice(url.indexOf(',') + 1)
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

function ascii(b: Uint8Array, from: number, length: number) {
  return String.fromCharCode(...b.subarray(from, from + length))
}

/** Width and height from a PNG's IHDR chunk, which the format puts first. */
function pngSize(b: Uint8Array) {
  expect(ascii(b, 1, 3)).toBe('PNG')
  expect(ascii(b, 12, 4)).toBe('IHDR')
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20), colourType: b[25] }
}

/**
 * Width and height from a lossless WebP (`VP8L`): after the signature byte,
 * 14 bits of width - 1 then 14 bits of height - 1, little-endian. Lossless is
 * what the generator writes, and why — a lossy encoder's block artefacts would
 * show up as ragged edges on the depth band — so a lossy file here means the
 * file did not come from it.
 */
function webpLosslessSize(b: Uint8Array) {
  expect(ascii(b, 0, 4)).toBe('RIFF')
  expect(ascii(b, 8, 4)).toBe('WEBP')
  expect(ascii(b, 12, 4)).toBe('VP8L')
  expect(b[20]).toBe(0x2f)
  const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)
  return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
}

describe('the transfer scene textures', () => {
  it('are drawn by a script in this repository, which writes exactly these two files', () => {
    const script = generator['/scripts/make-transfer-scene.py']
    expect(script).toBeTypeOf('string')
    expect(script).toContain("'scene.png'")
    expect(script).toContain("'scene-depth.webp'")
    expect(texturesSource).toContain("publicUrl('transfer/scene.png')")
    expect(texturesSource).toContain("publicUrl('transfer/scene-depth.webp')")
  })

  it('has a colour map the size the plane assumes, with alpha for the still fallback', () => {
    const { width, height, colourType } = pngSize(bytes('/public/transfer/scene.png'))
    expect({ width, height }).toEqual({ width: MAP_WIDTH, height: MAP_HEIGHT })
    expect(colourType).toBe(6) // RGBA
  })

  it('has a lossless depth map of the same size', () => {
    const size = webpLosslessSize(bytes('/public/transfer/scene-depth.webp'))
    expect(size).toEqual({ width: MAP_WIDTH, height: MAP_HEIGHT })
  })
})
