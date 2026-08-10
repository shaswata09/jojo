/**
 * The arithmetic behind the Vault's calculator, with no React in it.
 *
 * Kept apart from the component for the reason every rule in this app is: it
 * is the part that can be wrong. Rounding, division by zero and degrees-vs-
 * radians are decisions, not rendering, and they belong somewhere a test can
 * reach without mounting a screen.
 */

export type Op = '+' | '−' | '×' | '÷' | '^'

/** Longest result we will show before falling back to exponent form. */
const MAX_DIGITS = 12

/**
 * Trims the float noise arithmetic leaves behind.
 *
 * 0.1 + 0.2 is 0.30000000000000004 in binary floating point, and a calculator
 * that prints that is a calculator nobody trusts. Rounding to the precision a
 * double can actually represent gives 0.3 without inventing accuracy.
 */
export function format(value: number) {
  if (!Number.isFinite(value)) return 'Error'
  const rounded = Number.parseFloat(value.toPrecision(MAX_DIGITS))
  const text = String(rounded)
  return text.length > MAX_DIGITS + 2 ? rounded.toExponential(6) : text
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
  { key: 'neg', label: '±', expr: (x) => `−(${x})`, run: (x) => -x },
]
