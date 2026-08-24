/**
 * The evaluator the agent computes with.
 *
 * These matter more than most tests in this package, because this is code whose
 * output goes into a sentence a person will believe. A wrong precedence rule
 * here does not crash anything — it produces a plausible number, the model
 * writes it into an answer about somebody's salary, and nothing anywhere
 * signals doubt. So the cases below pin the arithmetic itself, not the plumbing.
 *
 * The refusals get as much room as the results, deliberately. Every one of them
 * is a case where the evaluator could have returned a number instead, and the
 * number would have been wrong.
 */

import { describe, expect, it } from 'vitest'
import { CONSTANT_NAMES, FUNCTION_NAMES, evaluate } from './expression'

/** The value, or the error text — so a case reads as one line. */
const value = (source: string) => {
  const r = evaluate(source)
  return r.ok ? r.value : `ERROR: ${r.error}`
}
const errorOf = (source: string) => {
  const r = evaluate(source)
  if (r.ok) throw new Error(`expected "${source}" to fail; it returned ${String(r.value)}`)
  return r.error
}

describe('arithmetic', () => {
  it('does the four operations', () => {
    expect(value('2 + 3')).toBe(5)
    expect(value('7 - 12')).toBe(-5)
    expect(value('6 * 7')).toBe(42)
    expect(value('9 / 4')).toBe(2.25)
  })

  it('respects precedence rather than reading left to right', () => {
    // The single most consequential line in this file: 2+3*4 is 14, and an
    // evaluator that returns 20 is wrong in a way nobody reading the answer
    // would catch.
    expect(value('2 + 3 * 4')).toBe(14)
    expect(value('(2 + 3) * 4')).toBe(20)
    expect(value('10 - 2 - 3')).toBe(5)
    expect(value('100 / 10 / 2')).toBe(5)
  })

  it('binds unary minus looser than the power, so -2^2 is -4', () => {
    // Ordinary mathematical writing, and the convention Python and Ruby use.
    // Worth pinning because spreadsheets disagree — Excel returns 4 — and this
    // is the one place someone might check it against the wrong reference.
    expect(value('-2^2')).toBe(-4)
    expect(value('(-2)^2')).toBe(4)
  })

  it('makes the power right-associative', () => {
    expect(value('2^3^2')).toBe(512)
    expect(value('2^-1')).toBe(0.5)
  })

  it('stacks unary signs', () => {
    /*
     * Not a curiosity: this is the only case that distinguishes `'-' factor`
     * from `'-' power` in the grammar, and mutation testing found the suite
     * could not tell them apart without it. Both spellings give −4 for `-2^2`.
     */
    expect(value('--2')).toBe(2)
    expect(value('- -2')).toBe(2)
    expect(value('2^--1')).toBe(2)
    expect(value('-+-2')).toBe(2)
  })

  it('takes a remainder with %', () => {
    expect(value('17 % 5')).toBe(2)
    expect(value('17 % 5 + 1')).toBe(3)
  })

  it('reads decimals, exponents and the constants', () => {
    expect(value('0.5 + 0.25')).toBe(0.75)
    expect(value('2e3')).toBe(2000)
    expect(value('1.5e-2')).toBe(0.015)
    expect(value('pi')).toBeCloseTo(Math.PI, 12)
    expect(value('e')).toBeCloseTo(Math.E, 12)
  })

  it('accepts the keypad’s own glyphs, so a history line can be pasted back', () => {
    // `calculator.ts` records '48000 × 0.8'. Refusing the app's own output
    // would be a small betrayal for no reason.
    expect(value('48000 × 0.8')).toBe(38400)
    expect(value('10 ÷ 4')).toBe(2.5)
    expect(value('10 − 4')).toBe(6)
  })
})

describe('the functions a job search actually needs', () => {
  it('aggregates over any number of arguments', () => {
    expect(value('sum(58000, 72000, 65000)')).toBe(195000)
    expect(value('mean(58000, 72000, 65000)')).toBe(65000)
    expect(value('count(1, 2, 3, 4)')).toBe(4)
    expect(value('min(3, 1, 2)')).toBe(1)
    expect(value('max(3, 1, 2)')).toBe(3)
    expect(value('product(2, 3, 4)')).toBe(24)
  })

  it('takes the median, averaging the two middles on an even count', () => {
    expect(value('median(5, 1, 3)')).toBe(3)
    expect(value('median(1, 2, 3, 4)')).toBe(2.5)
    // Unsorted input must not change the answer — the sort is the whole job.
    expect(value('median(4, 1, 3, 2)')).toBe(2.5)
  })

  it('does the unary maths', () => {
    expect(value('abs(-4)')).toBe(4)
    expect(value('sqrt(144)')).toBe(12)
    expect(value('round(2.5)')).toBe(3)
    expect(value('floor(2.9)')).toBe(2)
    expect(value('ceil(2.1)')).toBe(3)
    expect(value('sign(-9)')).toBe(-1)
    expect(value('log(1000)')).toBeCloseTo(3, 12)
    expect(value('ln(e)')).toBeCloseTo(1, 12)
  })

  it('nests, which is the whole point of having an evaluator', () => {
    // The realistic shape: a nine-month salary annualised, against a twelve.
    expect(value('mean(58000 / 9 * 12, 72000)')).toBeCloseTo(74666.6667, 3)
    expect(value('round(sum(1000, 2000) / 3)')).toBe(1000)
  })

  it('has no trigonometry, on purpose', () => {
    // The keypad's sin takes degrees. Adding a radians sin here would put two
    // meanings of one name in the product. The refusal names what is known.
    expect(errorOf('sin(90)')).toMatch(/do not know/i)
    expect(FUNCTION_NAMES).not.toContain('sin')
  })

  it('has no stdev, on purpose', () => {
    expect(FUNCTION_NAMES).not.toContain('stdev')
  })

  it('publishes the names it knows, so the tool summary cannot drift from it', () => {
    expect(FUNCTION_NAMES).toContain('mean')
    expect(FUNCTION_NAMES).toContain('sqrt')
    expect(CONSTANT_NAMES).toEqual(['e', 'pi'])
    // Sorted, so the printed list is stable between runs.
    expect([...FUNCTION_NAMES].sort()).toEqual([...FUNCTION_NAMES])
  })
})

describe('what it refuses, and why each refusal is a wrong number avoided', () => {
  it('refuses a separated group that begins with a zero', () => {
    /*
     * The common shape, and the reason this matters: `mean(50,000, 72,000)` is
     * four valid arguments and evaluates to 30.5 — no error anywhere, wrong
     * everywhere — and it is exactly what a model writes after reading
     * "$50,000" off a posting. The group `000` cannot be a number anybody meant,
     * so it is refused wherever it appears.
     */
    expect(errorOf('mean(50,000, 72,000)')).toMatch(/leading zero/i)
    expect(errorOf('50,000 + 1')).toMatch(/leading zero/i)
    expect(errorOf('sum(1,000,000)')).toMatch(/leading zero/i)
    // The spacing does not matter, which the regex this replaced could not say.
    expect(errorOf('sum(50, 000)')).toMatch(/leading zero/i)
    expect(errorOf('mean(50, 000, 72, 000)')).toMatch(/leading zero/i)
  })

  it('does NOT refuse an ordinary argument list that happens to have three digits', () => {
    /*
     * The regression this replaced a regex to fix, and the worst bug the review
     * of this file found. The old guard matched "digit, three digits", which is
     * also the shape of a perfectly ordinary second argument — so `sum(75000,500)`
     * was REFUSED, with a message telling the caller to remove the separator.
     * Following that advice gives `sum(75000500)`, which returns 75000500 and is
     * silently wrong. The guard was manufacturing the exact failure it existed
     * to prevent.
     */
    expect(value('sum(75000,500)')).toBe(75500)
    expect(value('max(1000,999)')).toBe(1000)
    expect(value('mean(1000,200)')).toBe(600)
    expect(value('min(120000,850)')).toBe(850)
    expect(value('mean(50000, 72000)')).toBe(61000)
    expect(value('sum(1, 20)')).toBe(21)
  })

  it('reports every number it read, so an unreadable separator is still visible', () => {
    /*
     * `72,500` has no leading zero, so nothing in the text distinguishes "one
     * number with a separator" from "two arguments". This stops guessing and
     * reports what it read: a caller that meant two numbers and is handed back
     * four has been told, in the same reply as the answer.
     */
    const r = evaluate('mean(72,500, 65,250)')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.numbers).toEqual([72, 500, 65, 250])

    const plain = evaluate('mean(72500, 65250)')
    expect(plain.ok).toBe(true)
    if (plain.ok) expect(plain.numbers).toEqual([72500, 65250])

    // The European spelling is the same problem wearing a dot, and the same
    // answer: it cannot be told apart from a decimal, so it is reported.
    const dotted = evaluate('mean(50.000, 72.000)')
    expect(dotted.ok).toBe(true)
    if (dotted.ok) expect(dotted.numbers).toEqual([50, 72])
  })

  it('still reads a leading zero before a decimal point', () => {
    // `0.5` must survive — the character after the zero is a dot, not a digit.
    expect(value('0.5 + 0.25')).toBe(0.75)
    expect(value('sum(0.5, 0.5)')).toBe(1)
  })

  it('refuses a currency symbol by name', () => {
    expect(errorOf('$50000')).toContain('$')
    expect(errorOf('£50000 + 1')).toContain('£')
  })

  it('refuses to divide by zero rather than returning Infinity', () => {
    // Infinity is a number the model would go on to use in its next sentence.
    expect(errorOf('1 / 0')).toMatch(/divides by zero/i)
    expect(errorOf('5 % 0')).toMatch(/modulo zero/i)
  })

  it('refuses results that are not numbers', () => {
    expect(errorOf('sqrt(-1)')).toMatch(/not work out to a number/i)
    expect(errorOf('ln(0)')).toMatch(/not work out to a number/i)
    expect(errorOf('9^9999')).toMatch(/not work out to a number/i)
  })

  it('reports unbalanced brackets as such', () => {
    expect(errorOf('(1 + 2')).toMatch(/never closed/i)
    expect(errorOf('1 + 2)')).toMatch(/nothing to close/i)
    expect(errorOf('sum(1, 2')).toMatch(/never closed/i)
  })

  it('blames the missing operator, not the bracket, when two numbers touch', () => {
    // `(1 2)` HAS its closing bracket. Calling that "never closed" sent the
    // reader to the wrong character.
    expect(errorOf('(1 2)')).toMatch(/no operator between two numbers/i)
    expect(errorOf('sum(1 2)')).toMatch(/side by side/i)
  })

  it('refuses a NaN inside median rather than sorting around it', () => {
    /*
     * The worst bug found in this file, and the only one that produced a
     * confident wrong number. `median` sorts, and `(a, b) => a - b` returns NaN
     * for every comparison involving one — an inconsistent comparator, so the
     * engine may leave the NaN anywhere. V8 left it in place, which meant
     * `median(58000, 72000, sqrt(-1))` returned 72000: finite, plausible, and
     * different depending on which position the NaN was in. Every other
     * aggregate propagates NaN arithmetically and was already refused.
     */
    expect(errorOf('median(58000, 72000, sqrt(0 - 1))')).toMatch(/not work out to a number/i)
    // Each position, because the middle one passed by accident of V8's sort.
    expect(errorOf('median(sqrt(0 - 1), 1, 2)')).toMatch(/not work out/i)
    expect(errorOf('median(1, sqrt(0 - 1), 2)')).toMatch(/not work out/i)
    expect(errorOf('median(1, 2, sqrt(0 - 1))')).toMatch(/not work out/i)
    // And a longer list, where no position refused at all before the fix.
    expect(errorOf('median(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, sqrt(0 - 1))')).toMatch(/not work out/i)
    // Overflow to Infinity is the same class and must go the same way.
    expect(errorOf('median(58000, 72000, 9^999 - 9^999)')).toMatch(/not work out/i)
    // Finite input is untouched.
    expect(value('median(1, 2, 3, 4)')).toBe(2.5)
  })

  it('checks the arity of a function rather than quietly using the first argument', () => {
    expect(errorOf('sqrt(4, 9)')).toMatch(/exactly one/i)
    expect(errorOf('mean()')).toMatch(/at least one/i)
  })

  it('names an unknown function instead of shrugging', () => {
    const message = errorOf('frobnicate(2)')
    expect(message).toContain('frobnicate')
    // The message lists what IS known, so the next attempt can succeed.
    expect(message).toContain('mean')
  })

  it('refuses an empty or oversized expression', () => {
    expect(errorOf('')).toMatch(/no expression/i)
    expect(errorOf('   ')).toMatch(/no expression/i)
    expect(errorOf(`1${' + 1'.repeat(200)}`)).toMatch(/longer than/i)
  })

  it('fails on deep nesting rather than overflowing the stack', () => {
    const deep = `${'('.repeat(200)}1${')'.repeat(200)}`
    // The contract under test is "returns an error", not which error: a stack
    // overflow here would be an uncatchable crash inside a chat turn.
    expect(evaluate(deep).ok).toBe(false)
  })

  it('does not reach a function through the prototype chain', () => {
    /*
     * A bug that was here, found by mutation testing and then by probing.
     *
     * The three lookup tables are object literals, so `UNARY_FNS['__proto__']`
     * is `Object.prototype` — truthy, and not callable. The call threw a
     * TypeError out of a READ TOOL, which reaches the user as a stack trace in
     * the middle of a chat rather than as an answer. `constructor` was worse in
     * a quieter way: it resolved to the Object constructor, returned a Number
     * object, and was rejected downstream by the finite check with the message
     * "that does not work out to a number" — a true sentence about the wrong
     * problem, which is the kind that costs an afternoon.
     */
    expect(() => evaluate('__proto__(1)')).not.toThrow()
    expect(errorOf('__proto__(1)')).toMatch(/do not know/i)
    expect(errorOf('constructor(4)')).toMatch(/do not know/i)
    expect(errorOf('constructor')).toMatch(/do not know/i)
    expect(errorOf('hasOwnProperty(1)')).toMatch(/do not know/i)
    // These two are spelled in a case the tokeniser lowers, so they never
    // reached the prototype — asserted so that stays true if it ever stops
    // lowercasing.
    expect(errorOf('valueOf(4)')).toMatch(/do not know/i)
    expect(errorOf('toString(4)')).toMatch(/do not know/i)
  })

  it('never throws, whatever it is given', () => {
    const nasty = [
      '((((',
      '))))',
      '+',
      '*3',
      '1 +',
      ',',
      'sum(,)',
      'sum(1,)',
      '1 2 3',
      '()',
      '__proto__',
      'constructor',
      '__proto__(1)',
      'constructor(4)',
      'toString(1)',
      'valueOf()',
      'e(1)',
      'pi(2)',
      '.',
      '1..2',
      ' ',
      '2e',
    ]
    for (const source of nasty) {
      expect(() => evaluate(source), source).not.toThrow()
      // Whatever comes back is a well-formed result, not undefined.
      expect(typeof evaluate(source).ok, source).toBe('boolean')
    }
  })

  it('gives an error a position, so a long expression can be pointed at', () => {
    const r = evaluate('1 + 2 + $')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.at).toBe(8)
  })
})
