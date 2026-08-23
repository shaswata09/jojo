/**
 * The decoder, against the one in Node.
 *
 * Node HAS a `TextDecoder` and it is correct, which makes it the right oracle
 * and the wrong implementation: the reason `decodeUtf8` exists is that Hermes
 * does not ship one, and no test running here can observe that. So every case
 * below asserts agreement with the platform decoder rather than a hand-written
 * expectation — a hand-written expectation would only ever prove that the same
 * person wrote the code and the test.
 *
 * The malformed cases matter as much as the valid ones. An overlong encoding of
 * `"` or `/` that decoded to the real character would let a crafted backup
 * smuggle JSON structure past a validator that had already read the string.
 */

import { describe, expect, it } from 'vitest'
import { decodeUtf8 } from './utf8'

/*
 * Declared rather than imported, because this package compiles with
 * `lib: ["ES2023"]` and no ambient DOM — the same rule that made `decodeUtf8`
 * necessary in the first place. Node supplies both at runtime; TypeScript is
 * not told they exist here, deliberately, so that a file under `kg/` cannot
 * reach for one by accident and compile.
 *
 * Narrowed to exactly what is used. A wider declaration would be a second,
 * unchecked copy of the DOM lib living in a test.
 */
declare const TextDecoder: new (label: string) => { decode: (input: Uint8Array) => string }
declare const TextEncoder: new () => { encode: (input: string) => Uint8Array }

/** Non-fatal, exactly like the one this replaces. */
const oracle = new TextDecoder('utf-8')
const agrees = (bytes: number[]) =>
  expect(decodeUtf8(new Uint8Array(bytes))).toBe(oracle.decode(new Uint8Array(bytes)))

describe('decodeUtf8', () => {
  it('reads the ASCII a backup is mostly made of', () => {
    const text = '{"format":"jojo.backup","nodes":[],"edges":[]}'
    agrees([...text].map((c) => c.charCodeAt(0)))
  })

  it('reads every sequence length', () => {
    // £ is two bytes, € three, 𝄞 four. A record's notes can hold all of them.
    for (const s of ['£', '€', '𝄞', 'naïve', 'Müller GmbH', '日本語', '🙂']) {
      const bytes = [...new TextEncoder().encode(s)]
      expect(decodeUtf8(new Uint8Array(bytes)), s).toBe(s)
      agrees(bytes)
    }
  })

  it('round-trips a realistic record', () => {
    const text = JSON.stringify({
      title: 'Ingénieur — Systèmes Embarqués',
      company: '株式会社テスト',
      note: 'Sent CV 🙂 — follow up Montag',
    })
    expect(decodeUtf8(new TextEncoder().encode(text))).toBe(text)
  })

  it('rejects an overlong encoding rather than decoding it', () => {
    // The two-byte spelling of '/', which is exactly the trick a validator that
    // ran before the decode would be fooled by.
    agrees([0xc0, 0xaf])
    // And the three-byte spelling of '"'.
    agrees([0xe0, 0x80, 0xa2])
    expect(decodeUtf8(new Uint8Array([0xc0, 0xaf]))).not.toContain('/')
  })

  it('rejects a surrogate code point', () => {
    // U+D800 spelled in UTF-8. Well-formed by arithmetic, not a character.
    agrees([0xed, 0xa0, 0x80])
  })

  it('rejects anything above U+10FFFF', () => {
    agrees([0xf5, 0x80, 0x80, 0x80])
    agrees([0xf4, 0x90, 0x80, 0x80])
  })

  it('handles a sequence truncated at the end of the buffer', () => {
    agrees([0x41, 0xe2, 0x82])
    agrees([0xf0, 0x9f])
  })

  it('does not swallow a good character after a bad byte', () => {
    // Advancing by the claimed length rather than by one would eat the 'A'.
    const out = decodeUtf8(new Uint8Array([0xe0, 0x41]))
    expect(out).toContain('A')
    agrees([0xe0, 0x41])
    agrees([0xc2, 0x41, 0x42])
  })

  it('rejects a continuation byte with nothing to continue', () => {
    agrees([0x80])
    agrees([0xbf, 0x41])
  })

  it('agrees on a long buffer, past every internal chunk boundary', () => {
    // The decoder flushes in 4096-unit runs and reads in 4096-byte chunks. A
    // character straddling either boundary is the failure this catches.
    const unit = 'aé€𝄞'
    const text = unit.repeat(3000)
    const bytes = new TextEncoder().encode(text)
    expect(bytes.byteLength).toBeGreaterThan(4096 * 4)
    expect(decodeUtf8(bytes)).toBe(text)
  })

  it('is empty for an empty buffer', () => {
    expect(decodeUtf8(new Uint8Array(0))).toBe('')
  })

  it('agrees with the platform on a fuzz of arbitrary bytes', () => {
    // Deterministic rather than random — a fuzz that cannot be re-run is a fuzz
    // that reports a failure nobody can reproduce.
    let x = 12345
    const next = () => {
      x = (x * 1103515245 + 12345) & 0x7fffffff
      return (x >>> 16) & 0xff
    }
    for (let trial = 0; trial < 400; trial += 1) {
      const bytes = Array.from({ length: 24 }, next)
      expect(decodeUtf8(new Uint8Array(bytes)), bytes.join(',')).toBe(
        oracle.decode(new Uint8Array(bytes)),
      )
    }
  })
})
