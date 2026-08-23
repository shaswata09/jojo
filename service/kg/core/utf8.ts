/**
 * UTF-8 bytes to a string, without `TextDecoder`. L1 core.
 *
 * ## Why this exists rather than a global
 *
 * `TextDecoder` is a browser global. `check-platform.mjs` is right to be
 * suspicious of those in core — `core/folder.ts` and `core/capture.ts` already
 * measure UTF-8 lengths by hand for exactly this reason — and the suspicion
 * turned out to be load-bearing rather than pedantic: React Native's Hermes
 * does not ship one, and `mobile/src/lib/polyfills.ts` does not install one
 * either. Expo used to, silently, and that went away with the ejection.
 *
 * Nothing catches that. It compiles, because the TypeScript DOM lib declares
 * the global whether or not the runtime has it, and no test sees it in either
 * direction because vitest runs on Node, where it exists and is correct. The
 * first sign would be a phone throwing `TextDecoder is not a constructor` at
 * the end of a transfer that had otherwise entirely worked.
 *
 * ## What it does with bytes that are not UTF-8
 *
 * Substitutes U+FFFD, which is what the standard requires and what a decoder in
 * non-fatal mode does. Refusing would be the wrong shape here: the one caller
 * hands the result to `JSON.parse`, which refuses anything malformed a moment
 * later and with a far better message than "byte 3 of a 4-byte sequence was
 * not a continuation".
 *
 * The substitution rules are the fiddly part and are the reason this has its
 * own tests rather than a spot check. Overlong encodings, surrogate code points
 * and anything above U+10FFFF are all rejected — an overlong encoding of `/` or
 * `"` that decoded to the real character would let a crafted backup smuggle
 * structure past a validator that had already looked at the string.
 */

export function decodeUtf8(bytes: Uint8Array): string {
  // Built in chunks rather than by `+=` on one string: appending to a string in
  // a loop is quadratic in some engines, and a backup is megabytes.
  const out: string[] = []
  let run: number[] = []

  const flush = () => {
    if (run.length === 0) return
    // Bounded, because `String.fromCharCode` applied to a whole backup's worth
    // of arguments overflows the stack.
    out.push(String.fromCharCode(...run))
    run = []
  }
  const emit = (code: number) => {
    if (code > 0xffff) {
      // Astral plane: JavaScript strings are UTF-16, so this is a surrogate pair.
      const n = code - 0x10000
      run.push(0xd800 + (n >> 10), 0xdc00 + (n & 0x3ff))
    } else {
      run.push(code)
    }
    if (run.length >= 4096) flush()
  }

  let i = 0
  while (i < bytes.length) {
    const b = bytes[i]!

    if (b < 0x80) {
      emit(b)
      i += 1
      continue
    }

    /*
     * How many continuation bytes this leading byte claims, and what the FIRST
     * of them is allowed to be.
     *
     * The narrowed range is the whole of the safety here, and it is why this
     * does not decode and then range-check afterwards. Four leading bytes admit
     * sequences that are arithmetically fine and are not characters: `0xE0`
     * with a low continuation is an overlong encoding, `0xED` with a high one
     * is a surrogate, `0xF0` with a low one is overlong again, and `0xF4` above
     * `0x8F` is past U+10FFFF. Rejecting them AT the byte — rather than after
     * assembling a code point — is what makes the replacement count match a
     * standard decoder, because the offending byte then gets reconsidered on
     * its own terms instead of being swallowed.
     *
     * The overlong case is the one with teeth: a two-byte spelling of `"` or
     * `/` that decoded to the real character would let a crafted backup smuggle
     * JSON structure past anything that inspected the string first.
     */
    let need: number
    let code: number
    let lower = 0x80
    let upper = 0xbf
    if (b >= 0xc2 && b <= 0xdf) {
      need = 1
      code = b & 0x1f
    } else if (b >= 0xe0 && b <= 0xef) {
      need = 2
      code = b & 0x0f
      if (b === 0xe0) lower = 0xa0
      else if (b === 0xed) upper = 0x9f
    } else if (b >= 0xf0 && b <= 0xf4) {
      need = 3
      code = b & 0x07
      if (b === 0xf0) lower = 0x90
      else if (b === 0xf4) upper = 0x8f
    } else {
      // 0x80–0xBF is a continuation with nothing to continue; 0xC0 and 0xC1 can
      // only ever be overlong; 0xF5 and up are above U+10FFFF however they end.
      emit(0xfffd)
      i += 1
      continue
    }

    /** Offset of the byte that broke the sequence; -1 if the buffer just ended. */
    let broke = 0
    let k = 1
    while (k <= need) {
      const c = bytes[i + k]
      if (c === undefined) {
        broke = -1
        break
      }
      if (c < lower || c > upper) {
        broke = k
        break
      }
      code = (code << 6) | (c & 0x3f)
      // Only the first continuation byte is ever narrowed.
      lower = 0x80
      upper = 0xbf
      k += 1
    }

    if (broke === -1) {
      // Truncated by the end of the buffer: one replacement for the incomplete
      // sequence, and there is nothing after it to reconsider.
      emit(0xfffd)
      break
    }
    if (broke > 0) {
      // A byte that is present and does not belong. One replacement for the
      // sequence, then resume AT that byte rather than past it — it may itself
      // be the start of a perfectly good character, and skipping it would turn
      // one corrupt character into two.
      emit(0xfffd)
      i += broke
      continue
    }

    emit(code)
    i += need + 1
  }

  flush()
  return out.join('')
}
