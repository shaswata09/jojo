import jsQR from 'jsqr'
import { OFFER_BYTES, decodeOffer } from '@jojo/service/core/pairing'

/**
 * Reading the pairing offer out of one camera frame's QR code.
 *
 * The other half of `web/src/lib/pairing-qr.ts` (Q329). The computer draws the
 * 83 bytes of `encodeOffer` as a standard QR code; this finds one in a
 * grayscale frame and hands back those bytes — or null, and the scanner simply
 * tries the next frame.
 *
 * `jsqr` (Apache-2.0) does the reading. It wants RGBA, and the scanner page
 * sends grey to keep the bridge light, so each grey byte is spread over three
 * channels into a buffer this module keeps and reuses: a frame arrives several
 * times a second, and a fresh allocation for each one is garbage for nothing.
 *
 * ## Only jojo's own code counts
 *
 * A camera pointed at a desk finds QR codes on boxes, posters and other
 * people's screens. Anything that is not a well-formed offer of exactly the
 * right length — `decodeOffer` checks the magic bytes, the version and the size
 * — is treated as no code at all, so a stray symbol can neither start a pairing
 * nor put an error on screen while somebody is still lining the phone up.
 */
let rgba: Uint8ClampedArray | null = null

export function readPairingQr(gray: Uint8Array, width: number, height: number): Uint8Array | null {
  if (width <= 0 || height <= 0 || gray.length !== width * height) return null
  const length = width * height * 4
  if (rgba === null || rgba.length !== length) rgba = new Uint8ClampedArray(length)
  for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
    const value = gray[i]!
    rgba[p] = value
    rgba[p + 1] = value
    rgba[p + 2] = value
    rgba[p + 3] = 255
  }

  // `dontInvert`: the computer always draws dark modules on a white card, so
  // trying the inverted image too would double the work for a code that is
  // never shown that way.
  const found = jsQR(rgba, width, height, { inversionAttempts: 'dontInvert' })
  if (found === null || found.binaryData.length !== OFFER_BYTES) return null

  const bytes = Uint8Array.from(found.binaryData)
  return decodeOffer(bytes).ok ? bytes : null
}
