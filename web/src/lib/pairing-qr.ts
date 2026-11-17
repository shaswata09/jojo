import { encode } from 'uqr'

/**
 * The pairing offer as a QR code: a square of modules, true where one is dark.
 *
 * The owner's decision of 2026-11-16 (Q329), replacing jojo's own animated code
 * (Q124). A standard symbol is read by a decoder that has had a decade of real
 * cameras thrown at it, and both libraries are small, permissively licensed and
 * do one thing: `uqr` (MIT) draws it here, `jsqr` (Apache-2.0) reads it on the
 * phone (`mobile/src/lib/pairing-qr.ts`).
 *
 * ## What goes in it
 *
 * The 83 bytes of `encodeOffer`, in byte mode, as they are. Not a URL and not
 * base64: the offer carries a secret, so a code that a phone's own camera app
 * would happily open as a link is a code that hands the secret to whatever app
 * claims the link. Raw bytes mean nothing to anything but jojo, and they make
 * the smallest symbol — version 5 at level M, 37 modules across.
 *
 * Level M, not L: it costs nothing in size at this payload (both land on
 * version 5) and buys back a smudge, a glare spot or a corner a thumb is over.
 *
 * `border: 0` because the quiet zone is the renderer's job — it is drawn as
 * padding on a light card, so the symbol stays a pure grid of data.
 */
export type PairingQr = {
  /** Modules across. */
  size: number
  /** Row-major, top row first; true is a dark module. */
  modules: readonly (readonly boolean[])[]
}

export function pairingQr(offer: Uint8Array): PairingQr {
  const { size, data } = encode(Array.from(offer), { ecc: 'M', border: 0 })
  return { size, modules: data }
}

/**
 * The dark modules as one SVG path, a unit per module.
 *
 * One path rather than a rect per module: a version-5 code has about seven
 * hundred dark modules, and seven hundred DOM nodes re-created on every offer
 * refresh is work for nothing. Runs of dark modules in a row merge into one
 * rectangle, so the path stays short.
 */
export function qrPath(qr: PairingQr): string {
  const parts: string[] = []
  qr.modules.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      if (!row[x]) {
        x += 1
        continue
      }
      const start = x
      while (x < row.length && row[x]) x += 1
      parts.push(`M${start} ${y}h${x - start}v1h${start - x}z`)
    }
  })
  return parts.join('')
}
