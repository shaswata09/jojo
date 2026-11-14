/**
 * `calc.eval`: arithmetic and descriptive statistics, worked out exactly.
 */

import { format } from '../../core/calculator'
import { CONSTANT_NAMES, FUNCTION_NAMES, evaluate } from '../../core/expression'
import { s } from '../../core/schema'
import { defineRead } from './define'

/**
 * Arithmetic, so the model stops doing it in its head.
 *
 * THE PROBLEM THIS SOLVES is not that the model cannot add. It is that when it
 * adds wrongly there is no signal — a bad total arrives in the same even
 * sentence as a good one, phrased with the same confidence, and the person
 * reading it has no way to tell which they got. Every other read here can be
 * checked against the graph; a number the model produced from nothing cannot.
 *
 * WHY ONE TOOL AND NOT SEVERAL. `sum`, `mean` and `median` as three names would
 * be three more entries in a list this file's header argues hard for keeping
 * short — a model choosing from more names picks worse than one choosing from
 * fewer, on hardware that is frequently a 7B at home. One name and
 * one grammar covers arithmetic and descriptive statistics together, and the
 * grammar composes in a way a fixed set of tools cannot: `mean(58000/9*12,
 * 72000)` is one call.
 *
 * WHY A LIST OF EXPRESSIONS. An answer about a job search wants several figures
 * at once — the total, the average, the gap — and one call returning three
 * beats three round trips through a local model. One bad expression reports its
 * own error and the others still answer, because a typo in the third should not
 * cost the two that were fine.
 *
 * It takes no `memory` argument and touches no records on purpose. Pairing it
 * with `memory.list` is the intended shape: read the records, then compute over
 * what came back. Letting it reach into the graph itself would make it a second
 * query language beside `graph.query`.
 */
export const calcEval = defineRead({
  name: 'calc.eval',
  title: 'Work out a number',
  summary:
    `Work out arithmetic exactly instead of doing it in your head — always use this for any sum, ` +
    `average, percentage or comparison whose answer you are going to state. ` +
    `Operators + - * / % ^ and brackets. Functions: ${FUNCTION_NAMES.join(', ')}. ` +
    `Constants: ${CONSTANT_NAMES.join(', ')}. The aggregates take any number of arguments, ` +
    `so mean(58000, 72000, 65000) works. Write plain numbers with no currency symbols and no ` +
    `thousand separators: 50000, never 50,000 and never 50 000 — a comma is how you separate one ` +
    `argument from the next, so a separator inside a number silently becomes two numbers. Every ` +
    `result echoes the numbers it actually read; if that list is longer than you meant, that is ` +
    `what happened. Percentages are decimals: 20% is 0.2, and % is the remainder operator. ` +
    `There is no trigonometry here.`,
  effect: 'read',
  input: s.object({
    expressions: s.array(
      s.string({ min: 1, label: 'Expression', description: 'One expression, for example mean(58000, 72000).' }),
      {
        min: 1,
        max: 20,
        label: 'Expressions',
        description: 'The expressions to work out. Send several at once when an answer needs several figures.',
      },
    ),
  }),
  read: (_memory, input: { expressions: string[] }) => {
    const results = input.expressions.map((expression) => {
      const outcome = evaluate(expression)
      return outcome.ok
        ? {
            expression,
            ok: true,
            // `value` and `display` both, because they are for different
            // readers: the raw double is what a following expression should be
            // given, and `format` is the rounded text a person should be shown.
            // Handing back only the rounded one would make the model quote
            // 0.30000000000000004 as 0.3 and then compute with 0.3.
            value: outcome.value,
            display: format(outcome.value),
            /*
             * Every literal that was read, in order. The audit trail for the one
             * hazard the evaluator cannot detect: `mean(72,500, 65,250)` is four
             * arguments and two arguments at the same time, and nothing in the
             * text tells them apart. Rather than guess, it reports — a caller
             * that meant two numbers sees four here, beside the answer.
             */
            read: outcome.numbers,
          }
        : { expression, ok: false, error: outcome.error }
    })

    const failed = results.filter((r) => !r.ok).length
    return {
      results,
      // Said out loud rather than left to be counted. A model that skims the
      // list and reports a figure from a row that failed is the failure mode
      // this whole tool exists to prevent.
      ...(failed > 0
        ? {
            hint: `${String(failed)} of ${String(results.length)} could not be worked out. Do not state a number for those — fix the expression and ask again.`,
          }
        : {}),
    }
  },
})
