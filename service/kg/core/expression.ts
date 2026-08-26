/**
 * L1 — a numeric expression evaluator, for the agent to do arithmetic with.
 *
 * WHY THIS EXISTS. The agent can read every record in the graph and could not
 * add two of them together. It would produce the sum in its own head instead,
 * which is the one thing a language model is worst at and the one thing it does
 * without ever signalling doubt — a wrong total arrives in the same confident
 * sentence as a right one. `queries.ts` hands this to the model as `calc.eval`
 * so the numbers in an answer are computed rather than recalled.
 *
 * NO `eval`, NO `Function`. Not primarily a sandbox argument, though it is that
 * too: `check-platform` governs this layer, Hermes runs it on a phone with the
 * JS compiler often unavailable, and a string-to-code path is the one thing that
 * cannot be made portable by a polyfill. It is a hand-written tokeniser and a
 * precedence-climbing parser, which is about ninety lines and has the pleasant
 * side effect that every failure has a position in it.
 *
 * WHAT IT DELIBERATELY DOES NOT HAVE, because each absence is a decision:
 *
 *   - NO TRIG. `calculator.ts` has sin/cos/tan and they take DEGREES, because
 *     that is what someone pressing a calculator button means. The mathematical
 *     convention for a written expression is radians. Supporting trig here would
 *     put two different meanings of `sin` in one product, and the drift this
 *     whole file is a reaction to started exactly that way. A job search does no
 *     trigonometry; the keypad keeps it, this does not have it.
 *   - NO `stdev`. Sample or population is a question the caller has to answer
 *     and a model will not think to. Over the three offers someone is actually
 *     comparing the answer is close to meaningless either way, and a number that
 *     is meaningless but confident is what `core/fit.ts` refuses to return.
 *   - NO PERCENT OPERATOR. `%` is modulo here, the meaning it has in every
 *     expression language. `20%` as a suffix would be a second meaning for one
 *     symbol; a model can write `0.2` and the summary tells it to.
 *
 * PRECEDENCE, low to high: `+ −`, then `* / %`, then unary `±`, then `^`
 * (right-associative). `-2^2` is −4, as in ordinary mathematical writing.
 */

/** Longest expression accepted. A model that needs more is doing this wrong. */
const MAX_LENGTH = 500

/** Cap on nesting, so a pathological input fails as an error and not a crash. */
const MAX_DEPTH = 32

/**
 * The keypad's operator glyphs are accepted alongside the ASCII ones.
 *
 * `calculator.ts` records history as `48000 × 0.8`, and the obvious thing to do
 * with a line of it is paste it in here. Refusing the app's own output would be
 * a small betrayal that costs one line to avoid.
 */
const MINUS = new Set(['-', '−', '–', '—'])
const TIMES = new Set(['*', '×'])
const DIVIDE = new Set(['/', '÷'])

/**
 * A refusal, shared by the internal result and the public one.
 *
 * Split out so `fail()` has one return type that is assignable to both: the
 * parser's own results carry no `numbers`, only the entry point adds it.
 */
type EvalFailure = { ok: false; error: string; at?: number }

/*
 * Named `Parsed` until it collided, in a reader's head rather than in the
 * compiler: `core/schema.ts` exports a `Parsed<T>` that is the result of
 * VALIDATING a tool's input, and this one is the result of EVALUATING an
 * arithmetic expression. Two unrelated things, one word, and this one is not
 * exported — so the collision cost nothing but a double-take, and a rename is
 * the whole fix.
 */
type Evaluated = { ok: true; value: number } | EvalFailure

type Token =
  | { kind: 'number'; value: number; at: number }
  | { kind: 'name'; value: string; at: number }
  | { kind: 'op'; value: string; at: number }

export type EvalResult =
  /**
   * `numbers` is every numeric literal read, in source order.
   *
   * The audit trail for the half of the separator problem that cannot be
   * detected: `mean(72,500, 65,250)` is four valid arguments and two valid
   * arguments at the same time, and nothing in the text distinguishes them. So
   * this stops trying, and reports what it read instead — a caller that meant
   * two numbers and is handed back four has been told, in the same reply as the
   * answer, without the evaluator having had to guess.
   */
  | { ok: true; value: number; numbers: readonly number[] }
  | EvalFailure

const fail = (error: string, at?: number): EvalFailure =>
  at === undefined ? { ok: false, error } : { ok: false, error, at }

/* --------------------------------- functions ------------------------------ */

/**
 * Aggregates take any number of arguments; the unary ones take exactly one.
 *
 * Split by arity rather than by a `length` field on one table so that "wrong
 * number of arguments" is a message this file can write precisely, naming what
 * the function wanted. A model that calls `mean()` with nothing gets told that,
 * rather than getting NaN back and reporting it as a result.
 */
const UNARY_FNS: Record<string, (x: number) => number> = {
  abs: Math.abs,
  sqrt: Math.sqrt,
  ln: Math.log,
  log: Math.log10,
  exp: Math.exp,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  sign: Math.sign,
}

const AGGREGATE_FNS: Record<string, (xs: number[]) => number> = {
  sum: (xs) => xs.reduce((a, b) => a + b, 0),
  product: (xs) => xs.reduce((a, b) => a * b, 1),
  count: (xs) => xs.length,
  min: (xs) => Math.min(...xs),
  max: (xs) => Math.max(...xs),
  mean: (xs) => xs.reduce((a, b) => a + b, 0) / xs.length,
  /**
   * Even counts take the mean of the two middles, the usual convention.
   *
   * The `[...xs]` copy is defensive rather than load-bearing: `args` is built
   * fresh inside `primary()` and read by nobody afterwards, so sorting in place
   * would be unobservable today. Mutation testing confirmed exactly that — the
   * in-place version survives the whole suite — and the copy stays because the
   * next caller of these tables may not own its array, not because a test is
   * holding it.
   */
  median: (xs) => {
    /*
     * The non-finite check is here and nowhere else because median is the only
     * aggregate that does not propagate NaN on its own. `sum`, `mean`, `min`,
     * `max` and `product` all arrive at NaN arithmetically and are then refused
     * by the finite check in `evaluate`. A sort does not: `(a, b) => a - b`
     * returns NaN for every comparison involving one, the comparator is
     * inconsistent, and the engine is free to leave the NaN anywhere. V8 leaves
     * it wherever it started, so `median(58000, 72000, sqrt(-1))` returned
     * 72000 — finite, plausible, and different depending on which position the
     * NaN was in. That is this file's worst possible failure: a confident wrong
     * number with no signal, in the one function whose whole job is a sort.
     */
    if (xs.some((x) => !Number.isFinite(x))) return Number.NaN
    const sorted = [...xs].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 1
      ? (sorted[mid] as number)
      : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
  },
}

/** Named constants. `pi` is here because `e` alone would look like an omission. */
const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E }

/**
 * Everything callable, for the tool summary to print.
 *
 * Exported so `queries.ts` describes the language from the language rather than
 * from a hand-kept sentence beside it — the drift `calculator.ts`'s header is
 * about, in miniature.
 */
export const FUNCTION_NAMES: readonly string[] = [
  ...Object.keys(AGGREGATE_FNS),
  ...Object.keys(UNARY_FNS),
].sort()

export const CONSTANT_NAMES: readonly string[] = Object.keys(CONSTANTS).sort()

/* --------------------------------- tokenise ------------------------------- */

const isDigit = (c: string) => c >= '0' && c <= '9'
const isAlpha = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')

function tokenise(source: string): Token[] | EvalFailure {
  const tokens: Token[] = []
  let i = 0

  while (i < source.length) {
    const c = source[i] as string

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i += 1
      continue
    }

    if (isDigit(c) || (c === '.' && isDigit(source[i + 1] ?? ''))) {
      const start = i
      while (isDigit(source[i] ?? '')) i += 1
      if (source[i] === '.') {
        i += 1
        while (isDigit(source[i] ?? '')) i += 1
      }
      if (source[i] === 'e' || source[i] === 'E') {
        const mark = i
        i += 1
        if (source[i] === '+' || MINUS.has(source[i] ?? '')) i += 1
        if (isDigit(source[i] ?? '')) {
          while (isDigit(source[i] ?? '')) i += 1
        } else {
          // '2e' followed by nothing numeric — back off and let 'e' be the
          // constant, so `2e` is a multiplication error rather than a bad number.
          i = mark
        }
      }
      // A normalised copy, because the source may carry the keypad's minus.
      const text = source.slice(start, i).replace(/[−–—]/g, '-')

      /*
       * A leading zero before another digit, refused — the sound half of the
       * thousand-separator problem.
       *
       * This replaced a regex over the raw source that looked for "digit,
       * three digits". That guard was unsound in both directions and the first
       * one mattered: `sum(75000,500)` is an ordinary two-argument call and it
       * was REFUSED, with a message telling the caller to delete the comma —
       * which turns it into `sum(75000500)`, a number that is silently wrong.
       * A guard whose advice manufactures the exact failure it exists to
       * prevent is worse than no guard.
       *
       * This check has no false positives: `007` is not a number anybody
       * writes meaning seven. It catches every separated group that begins
       * with a zero, which is what `50,000`, `50, 000` and `1,000,000` all
       * reduce to. `0.5` is untouched, because the character after the zero is
       * a dot rather than a digit.
       *
       * What it cannot catch is `72,500` — a three-digit group with no leading
       * zero is genuinely indistinguishable from a second argument. That one is
       * handled by honesty instead of by cleverness: `numbers` below reports
       * every literal actually read, so the caller can see four where it meant
       * two.
       */
      if (/^0\d/.test(text)) {
        return fail(
          `"${text}" has a leading zero. If that is part of a larger number, write it without the separator — 50000, not 50,000.`,
          start,
        )
      }

      const value = Number(text)
      if (!Number.isFinite(value)) return fail(`"${text}" is not a number I can read.`, start)
      tokens.push({ kind: 'number', value, at: start })
      continue
    }

    if (isAlpha(c) || c === '_') {
      const start = i
      while (isAlpha(source[i] ?? '') || isDigit(source[i] ?? '') || source[i] === '_') i += 1
      tokens.push({ kind: 'name', value: source.slice(start, i).toLowerCase(), at: start })
      continue
    }

    if (MINUS.has(c)) {
      tokens.push({ kind: 'op', value: '-', at: i })
      i += 1
      continue
    }
    if (TIMES.has(c)) {
      tokens.push({ kind: 'op', value: '*', at: i })
      i += 1
      continue
    }
    if (DIVIDE.has(c)) {
      tokens.push({ kind: 'op', value: '/', at: i })
      i += 1
      continue
    }
    if ('+%^(),'.includes(c)) {
      tokens.push({ kind: 'op', value: c, at: i })
      i += 1
      continue
    }

    // Named rather than shrugged at. A currency symbol and a stray letter want
    // different fixes, and the model can only make one if it is told which.
    return fail(`I cannot read "${c}" in an expression. Give me numbers and operators only.`, i)
  }

  return tokens
}

/* ---------------------------------- parse --------------------------------- */

/**
 * Evaluates as it parses.
 *
 * There is no tree because nothing needs one: this is called once per string,
 * the result is a number, and an AST would be a second representation to keep
 * correct. The parser IS the interpreter.
 */
class Parser {
  private pos = 0
  private depth = 0
  private readonly tokens: Token[]

  // Written out rather than a parameter property: `erasableSyntaxOnly` is on,
  // and that is the one class shorthand it forbids.
  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos]
  }

  private eat(value: string): boolean {
    const t = this.peek()
    if (t?.kind === 'op' && t.value === value) {
      this.pos += 1
      return true
    }
    return false
  }

  /** Where the parser is, for an error message. End-of-input has no position. */
  private here(): number | undefined {
    return this.peek()?.at
  }

  parse(): Evaluated {
    const value = this.expression()
    if (!value.ok) return value
    const rest = this.peek()
    if (rest !== undefined) {
      return fail(
        rest.kind === 'op' && rest.value === ')'
          ? 'There is a closing bracket with nothing to close.'
          : 'I got to the end of what I could read before the end of the expression.',
        rest.at,
      )
    }
    return value
  }

  private expression(): Evaluated {
    let left = this.term()
    if (!left.ok) return left
    for (;;) {
      if (this.eat('+')) {
        const right = this.term()
        if (!right.ok) return right
        left = { ok: true, value: left.value + right.value }
      } else if (this.eat('-')) {
        const right = this.term()
        if (!right.ok) return right
        left = { ok: true, value: left.value - right.value }
      } else {
        return left
      }
    }
  }

  private term(): Evaluated {
    let left = this.factor()
    if (!left.ok) return left
    for (;;) {
      const at = this.here()
      if (this.eat('*')) {
        const right = this.factor()
        if (!right.ok) return right
        left = { ok: true, value: left.value * right.value }
      } else if (this.eat('/')) {
        const right = this.factor()
        if (!right.ok) return right
        // Matches `calculator.ts`: a division by zero is NaN, which the caller
        // prints as "Error". Infinity would be a number the model would go on
        // to use in the next line of its answer.
        if (right.value === 0) return fail('That divides by zero.', at)
        left = { ok: true, value: left.value / right.value }
      } else if (this.eat('%')) {
        const right = this.factor()
        if (!right.ok) return right
        if (right.value === 0) return fail('That takes a remainder modulo zero.', at)
        left = { ok: true, value: left.value % right.value }
      } else {
        return left
      }
    }
  }

  /** Unary sign, binding looser than `^` so that `-2^2` is −4. */
  private factor(): Evaluated {
    if (this.eat('-')) {
      const inner = this.factor()
      return inner.ok ? { ok: true, value: -inner.value } : inner
    }
    if (this.eat('+')) return this.factor()
    return this.power()
  }

  private power(): Evaluated {
    const base = this.primary()
    if (!base.ok) return base
    if (this.eat('^')) {
      // Right-associative, and the exponent is a `factor` so `2^-1` parses.
      const exponent = this.factor()
      if (!exponent.ok) return exponent
      return { ok: true, value: base.value ** exponent.value }
    }
    return base
  }

  private primary(): Evaluated {
    if (this.depth >= MAX_DEPTH) {
      return fail('That expression nests too deeply for me to read.', this.here())
    }

    const t = this.peek()
    if (t === undefined) return fail('The expression stops before it finishes.')

    if (t.kind === 'number') {
      this.pos += 1
      return { ok: true, value: t.value }
    }

    if (t.kind === 'op' && t.value === '(') {
      this.pos += 1
      this.depth += 1
      const inner = this.expression()
      this.depth -= 1
      if (!inner.ok) return inner
      if (!this.eat(')')) {
        // "(1 2)" has its closing bracket; what it is missing is an operator.
        // Reporting that as "never closed" sent the reader looking at the wrong
        // character.
        const next = this.peek()
        return fail(
          next?.kind === 'number'
            ? 'There is no operator between two numbers.'
            : 'A bracket is opened and never closed.',
          next?.at ?? t.at,
        )
      }
      return inner
    }

    if (t.kind === 'name') {
      this.pos += 1
      const name = t.value

      /*
       * `Object.hasOwn`, not a truthiness test, and this is not defensive
       * programming — it is a bug that was here.
       *
       * These three tables are object literals, so they inherit from
       * `Object.prototype`. `CONSTANTS['constructor']` is the Object
       * constructor and passes `!== undefined`; `UNARY_FNS['__proto__']` is
       * `Object.prototype`, which is truthy and NOT callable, so the call below
       * threw a TypeError — inside a read tool, which reaches the user as a
       * stack trace in the middle of a chat. `valueOf` and `toString` were
       * saved only by the `.toLowerCase()` above, which is luck rather than a
       * guard.
       */
      if (Object.hasOwn(CONSTANTS, name) && !(this.peek()?.kind === 'op' && this.peek()?.value === '(')) {
        return { ok: true, value: CONSTANTS[name] as number }
      }

      if (!this.eat('(')) {
        return fail(
          `I do not know "${name}". Known names: ${[...FUNCTION_NAMES, ...CONSTANT_NAMES].join(', ')}.`,
          t.at,
        )
      }

      this.depth += 1
      const args: number[] = []
      if (!this.eat(')')) {
        for (;;) {
          const arg = this.expression()
          if (!arg.ok) {
            this.depth -= 1
            return arg
          }
          args.push(arg.value)
          if (this.eat(',')) continue
          if (this.eat(')')) break
          this.depth -= 1
          const next = this.peek()
          return fail(
            next?.kind === 'number'
              ? `Two numbers sit side by side in ${name}() with no operator or comma between them.`
              : `"${name}(" is opened and never closed.`,
            next?.at ?? t.at,
          )
        }
      }
      this.depth -= 1

      if (Object.hasOwn(UNARY_FNS, name)) {
        const unary = UNARY_FNS[name] as (x: number) => number
        if (args.length !== 1) {
          return fail(`${name}() takes exactly one number; it was given ${String(args.length)}.`, t.at)
        }
        return { ok: true, value: unary(args[0] as number) }
      }

      if (Object.hasOwn(AGGREGATE_FNS, name)) {
        const aggregate = AGGREGATE_FNS[name] as (xs: number[]) => number
        if (args.length === 0) {
          return fail(`${name}() needs at least one number.`, t.at)
        }
        return { ok: true, value: aggregate(args) }
      }

      return fail(
        `I do not know a function called "${name}". Known: ${FUNCTION_NAMES.join(', ')}.`,
        t.at,
      )
    }

    return fail(`I did not expect "${t.value}" here.`, t.at)
  }
}

/* ---------------------------------- entry --------------------------------- */

/**
 * Reads one expression and returns its value.
 *
 * Never throws: every failure is an `{ ok: false }` carrying a sentence the
 * model can act on. A thrown error inside a read tool would surface to the user
 * as a stack trace in a chat transcript.
 */
export function evaluate(source: string): EvalResult {
  if (source.trim().length === 0) return fail('There is no expression to work out.')
  if (source.length > MAX_LENGTH) {
    return fail(`That expression is longer than ${String(MAX_LENGTH)} characters.`)
  }

  const tokens = tokenise(source)
  if (!Array.isArray(tokens)) return tokens

  const numbers = tokens.filter((t) => t.kind === 'number').map((t) => t.value)
  const parsed = new Parser(tokens).parse()
  if (!parsed.ok) return parsed
  if (!Number.isFinite(parsed.value)) {
    // Reached by overflow (`9^999`) and by the domain errors that produce NaN
    // rather than throwing (`sqrt(-1)`, `ln(0)`). Saying which is not possible
    // here and is not useful; saying that there is no number is both.
    return fail('That does not work out to a number.')
  }
  return { ok: true, value: parsed.value, numbers }
}
