/**
 * The Vault calculator's arithmetic, which its own header asked for.
 *
 * That header says the rules live here rather than in the component because
 * "it is the part that can be wrong… they belong somewhere a test can reach
 * without mounting a screen". Nothing had ever reached it, and the file went
 * out with the app unexercised.
 *
 * ONE CORRECTION, MEASURED, because it changes what these cases are for. The
 * audit that asked for this file said removing the divide-by-zero guard makes
 * the Vault print `Infinity`. It does not: `format` rejects anything not
 * finite, `CalculatorTool` puts every number it shows or records through
 * `format`, and `Infinity` reads 'Error' there exactly as `NaN` does. The two
 * zero guards — `÷` and `1/x` — are belt to that braces and are display-
 * equivalent to having none. So they are asserted at the function boundary
 * rather than through the display: what is pinned is that this file answers a
 * division by zero with a number that is not a number, which is what its own
 * comment says it does, and not a screen difference that does not exist.
 *
 * Everything else here IS a screen difference, and each case says which.
 */

import { describe, expect, it } from 'vitest'
import { UNARY, apply, format } from './calculator'
import type { Op } from './calculator'

/** The one key by name, so a case reads as the button that was pressed. */
const unary = (key: string) => {
  const fn = UNARY.find((u) => u.key === key)
  if (!fn) throw new Error(`no such key: ${key}`)
  return fn
}

describe('apply', () => {
  it('does the four operations and the power', () => {
    const cases: [number, number, Op, number][] = [
      [2, 3, '+', 5],
      [2, 3, '−', -1],
      [2, 3, '×', 6],
      [6, 3, '÷', 2],
      [2, 10, '^', 1024],
    ]
    for (const [a, b, op, want] of cases) expect(apply(a, b, op)).toBe(want)
  })

  /**
   * The guard `apply`'s own comment describes, at the boundary it lives on.
   *
   * `format` would say 'Error' either way — see the header. What this pins is
   * that division by zero leaves this module as NaN in all three of its
   * spellings, so a future caller that does arithmetic with the answer before
   * formatting it inherits NaN's poisoning rather than Infinity's silence.
   */
  it('answers a division by zero with a number that is not a number', () => {
    expect(apply(1, 0, '÷')).toBeNaN()
    expect(apply(-1, 0, '÷')).toBeNaN()
    expect(apply(0, 0, '÷')).toBeNaN()
    // And the display, which is the half the user meets.
    expect(format(apply(1, 0, '÷'))).toBe('Error')
  })

  it('reciprocal of zero is the same guard, spelled again on the key', () => {
    expect(unary('inv').run(0)).toBeNaN()
    expect(format(unary('inv').run(0))).toBe('Error')
    expect(unary('inv').run(4)).toBe(0.25)
  })
})

describe('format', () => {
  /**
   * The float-noise trim. 0.1 + 0.2 is 0.30000000000000004 in a double, and a
   * calculator that prints that is one nobody trusts.
   */
  it('trims the binary floating-point tail', () => {
    expect(format(apply(0.1, 0.2, '+'))).toBe('0.3')
    expect(format(apply(0.3, 0.1, '−'))).toBe('0.2')
  })

  it('keeps precision that is really there', () => {
    expect(format(1 / 3)).toBe('0.333333333333')
    expect(format(2)).toBe('2')
    expect(format(-0.5)).toBe('-0.5')
  })

  it('falls back to exponent form once the digits run out', () => {
    // 2^100 rounds to twelve significant figures and still spells out 31 of
    // them, which is wider than the display.
    expect(format(apply(2, 100, '^'))).toBe('1.267651e+30')
    // `String` reaches for the exponent on its own well before this does, and
    // a short exponent is left alone rather than re-formatted to a longer one.
    expect(format(1e21)).toBe('1e+21')
  })

  it('says Error for anything not finite', () => {
    expect(format(Number.NaN)).toBe('Error')
    expect(format(Number.POSITIVE_INFINITY)).toBe('Error')
    expect(format(Number.NEGATIVE_INFINITY)).toBe('Error')
    // √ of a negative is the route a user actually reaches NaN by.
    expect(format(unary('sqrt').run(-4))).toBe('Error')
    // ln of a negative is the other one.
    expect(format(unary('ln').run(-1))).toBe('Error')
  })
})

describe('the scientific keys take degrees', () => {
  /**
   * The comment says silently using radians would make sin(90) come out as
   * 0.894 — correct, and not what anyone pressing a calculator button meant.
   * That is the assertion.
   */
  it('sin(90°) is 1, not sin(90 radians)', () => {
    expect(format(unary('sin').run(90))).toBe('1')
    expect(format(unary('cos').run(0))).toBe('1')
    expect(format(unary('tan').run(45))).toBe('1')
  })

  /**
   * cos(90°) is 6.12e-17 rather than 0, and this app prints it.
   *
   * Pinned as it is rather than as a wish: the precision trim is about the
   * TAIL of a number, not about how near zero it is, so it cannot round this
   * away — 6.12e-17 is exactly representable and twelve significant figures of
   * it is still 6.12e-17. Every hand calculator shows this same residue.
   */
  it('does not pretend cos(90°) is zero', () => {
    expect(format(unary('cos').run(90))).toBe('6.123234e-17')
  })

  it('records the degree symbol in the expression it writes down', () => {
    expect(unary('sin').expr('90')).toBe('sin(90°)')
    expect(unary('sqrt').expr('9')).toBe('√(9)')
    expect(unary('pct').expr('50')).toBe('50%')
  })

  it('does the rest of the keys', () => {
    expect(format(unary('log').run(1000))).toBe('3')
    expect(format(unary('sqrt').run(9))).toBe('3')
    expect(format(unary('sq').run(7))).toBe('49')
    expect(format(unary('pct').run(50))).toBe('0.5')
    expect(format(unary('neg').run(5))).toBe('-5')
    expect(format(unary('ln').run(1))).toBe('0')
  })
})
