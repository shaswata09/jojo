/**
 * The short code a person reads off one screen and types into another.
 *
 * Eight characters from an alphabet with no I, L, O, U, 0 or 1 in it: this
 * string exists to be copied by hand across a room, and every one of those
 * lookalike pairs is a character someone will eventually mistype.
 */
const ALPHABET = '23456789ACDEFGHJKMNPQRTVWXYZ'

const GROUP = 4
const LENGTH = GROUP * 2

/** `4F2A-9K7M` — the display form. Storage is always the undashed string. */
export function formatCode(code: string) {
  return code.length > GROUP ? `${code.slice(0, GROUP)}-${code.slice(GROUP, LENGTH)}` : code
}

/**
 * Anything a person can type, reduced to the storage form: dashes and spaces
 * dropped, lowercase lifted, and characters outside the alphabet discarded
 * rather than kept as a silent failure the user only meets on submit.
 */
export function normaliseCode(raw: string) {
  return raw
    .toUpperCase()
    .split('')
    .filter((ch) => ALPHABET.includes(ch))
    .join('')
    .slice(0, LENGTH)
}

export function isWellFormed(code: string) {
  return normaliseCode(code).length === LENGTH
}

/**
 * A fresh code. `crypto.getRandomValues` rather than `Math.random` because it
 * is the right tool and it is already on the device — nothing here reaches for
 * a network, and a pairing code is exactly the kind of value that should not be
 * predictable from the previous one, even in a demonstration.
 *
 * The modulo is unbiased only because 256 divides evenly by neither 28 nor
 * anything useful, so bytes landing past the last whole multiple are redrawn.
 */
export function makePairingCode() {
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length
  let code = ''
  const buffer = new Uint8Array(1)
  while (code.length < LENGTH) {
    crypto.getRandomValues(buffer)
    if (buffer[0] >= limit) continue
    code += ALPHABET[buffer[0] % ALPHABET.length]
  }
  return code
}

export const CODE_LENGTH = LENGTH
