/**
 * L1 — the arithmetic behind the Vault's calculator, with no React in it.
 *
 * Kept apart from the component for the reason every rule in this app is: it is
 * the part that can be wrong. Rounding, division by zero and degrees-vs-radians
 * are decisions, not rendering, and they belong somewhere a test can reach
 * without mounting a screen.
 *
 * WHY IT MOVED HERE, and it is the interesting part. This file existed as
 * `mobile/src/lib/calculator.ts`, extracted and tested, while `web`'s
 * `components/vault/Calculator.tsx` inlined its own copy of `format`, `apply`
 * and `UNARY` across 367 lines with no test file beside them. `check-no-copies`
 * could not see it: the two were never byte-identical, which is exactly the
 * state a copy reaches shortly before it starts lying.
 *
 * And it had. The two scientific pads had drifted apart in three ways by the
 * time this was written:
 *
 *   - web had no `log`, so base-10 was reachable on a phone and not on a laptop
 *   - web called x² `sqr` and mobile called it `sq`, so the same button had two
 *     names in one product
 *   - both had a `±`, and they did different things: web edited the display,
 *     mobile computed `-x` and wrote a history row. See `toggleSign`.
 *
 * None of those is a bug anybody would file, and all three are what a second
 * copy does when nothing forces the two to agree. One source now, in the layer
 * both apps already import, with the tests beside it.
 */

export type Op = '+' | '−' | '×' | '÷' | '^'

/** Longest result we will show before falling back to exponent form. */
export const MAX_DIGITS = 12

/**
 * Trims the float noise arithmetic leaves behind.
 *
 * 0.1 + 0.2 is 0.30000000000000004 in binary floating point, and a calculator
 * that prints that is a calculator nobody trusts. Rounding to the precision a
 * double can actually represent gives 0.3 without inventing accuracy.
 */
export function format(value: number): string {
  if (!Number.isFinite(value)) return 'Error'
  const rounded = Number.parseFloat(value.toPrecision(MAX_DIGITS))
  const text = String(rounded)
  return text.length > MAX_DIGITS + 2 ? rounded.toExponential(6) : text
}

/**
 * The `±` key: a text edit, not an operation.
 *
 * Worth stating because the two are easy to conflate and this app shipped both.
 * `±` on a keypad flips the sign of what you are TYPING — you meant to enter
 * −5, you pressed 5, you press ±. It edits the display, records no history row,
 * and does nothing to a bare `0` because "−0" is not a number anyone typed.
 *
 * `UNARY` used to carry a `neg` entry that computed `-x` and recorded `−(5)` as
 * a completed step. Mobile rendered it as its `±` and got a history full of
 * sign flips; web had this function instead and, when the two tables were
 * merged, ended up with BOTH — two `±` keys in one pad, side by side. This is
 * the behaviour that survived, and it is shared so there is one of it.
 */
export function toggleSign(text: string): string {
  if (text === '0') return text
  return text.startsWith('-') ? text.slice(1) : `-${text}`
}

export function apply(a: number, b: number, op: Op): number {
  switch (op) {
    case '+':
      return a + b
    case '−':
      return a - b
    case '×':
      return a * b
    // NaN rather than Infinity: `format` prints "Error", which is the honest
    // answer to a division by zero and the one every calculator gives.
    case '÷':
      return b === 0 ? Number.NaN : a / b
    case '^':
      return a ** b
  }
}

/**
 * The scientific keys, as pure functions of the displayed value.
 *
 * Trig takes degrees, and the recorded expression says so. Silently using
 * radians would make sin(90) come out as 0.894 — correct, and not what anyone
 * pressing a calculator button meant.
 *
 * This is the keypad's vocabulary, and `expression.ts` deliberately does NOT
 * share it — see the note there about why an evaluator a model writes into has
 * no trig at all rather than trig in the other unit.
 */
export const UNARY: {
  key: string
  label: string
  expr: (x: string) => string
  run: (x: number) => number
}[] = [
  {
    key: 'sin',
    label: 'sin',
    expr: (x) => `sin(${x}°)`,
    run: (x) => Math.sin((x * Math.PI) / 180),
  },
  {
    key: 'cos',
    label: 'cos',
    expr: (x) => `cos(${x}°)`,
    run: (x) => Math.cos((x * Math.PI) / 180),
  },
  {
    key: 'tan',
    label: 'tan',
    expr: (x) => `tan(${x}°)`,
    run: (x) => Math.tan((x * Math.PI) / 180),
  },
  { key: 'ln', label: 'ln', expr: (x) => `ln(${x})`, run: Math.log },
  { key: 'log', label: 'log', expr: (x) => `log(${x})`, run: Math.log10 },
  { key: 'sqrt', label: '√', expr: (x) => `√(${x})`, run: Math.sqrt },
  { key: 'sq', label: 'x²', expr: (x) => `(${x})²`, run: (x) => x * x },
  { key: 'inv', label: '1/x', expr: (x) => `1/(${x})`, run: (x) => (x === 0 ? Number.NaN : 1 / x) },
  { key: 'pct', label: '%', expr: (x) => `${x}%`, run: (x) => x / 100 },
]
