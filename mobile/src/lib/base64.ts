/**
 * base64 → bytes, with no dependencies at all.
 *
 * ## Why jojo carries its own
 *
 * Neither of the obvious answers is available. React Native ships no `Buffer`
 * unless something polyfills it, and `atob` — which Hermes does provide —
 * returns a BINARY STRING, so every byte above 0x7F comes back through a
 * `charCodeAt` that has already lost it. A zip is binary from its second byte,
 * so the round trip has to be exact rather than nearly right.
 *
 * ## Why the length arithmetic is the part with a test
 *
 * `(length * 3) >> 2` over-allocates whenever the input was padded, and a
 * trailing zero byte is not a cosmetic flaw in an archive: a zip is read from
 * its END — the central directory is the last structure in the file — so one
 * extra byte moves it, `unzipSync` reports "invalid distance", and a document
 * the phone could perfectly well open is reported as corrupt.
 *
 * ## Why it is its own file
 *
 * So it can be tested. Its only caller is `on-device-reader.ts`, which imports
 * `react-native-blob-util` — a Flow-typed package the test runner cannot parse,
 * which is why `vitest.config.ts` keeps the screens out of the suite. Anything
 * importing that module is untestable here; this has no imports, so it is not.
 */

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function bytesFromBase64(base64: string): Uint8Array {
  // Whitespace, newlines and `=` padding all go: the length is derived from the
  // significant characters, and padding is exactly what makes it lie.
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '')
  const out = new Uint8Array((clean.length * 3) >> 2)
  let bits = 0
  let acc = 0
  let at = 0
  for (const char of clean) {
    acc = (acc << 6) | CHARS.indexOf(char)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[at] = (acc >> bits) & 0xff
      at += 1
    }
  }
  return at === out.length ? out : out.subarray(0, at)
}
