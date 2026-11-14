/**
 * `stats.report`: the whole search as counted figures, from the same functions
 * the Statistics page renders.
 */

import { applicationFrom } from '../../core/project'
import { recommendationsFor } from '../../core/recommend'
import { s } from '../../core/schema'
import { comparisonsFor, rangeLabel } from '../../core/segments'
import type { Comparison } from '../../core/segments'
import { statsFor } from '../../core/statistics'
import { defineRead } from './define'

/**
 * The whole search, as numbers nobody has written down.
 *
 * ## Why this is a tool and not a list the model counts
 *
 * The benchmark has a category for exactly this — "counting and comparing
 * across the whole store, where the answer is a number nobody has written
 * down" — and until now the only way to answer one was `memory.list` followed
 * by arithmetic in the model's head. That fails in three ways at once, and each
 * of them is silent:
 *
 *   - The list is capped and the cap is not the store. A rate computed over the
 *     first fifty of two hundred records is wrong and looks right.
 *   - Counting is the thing models are worst at. "How many reached an
 *     interview" over thirty rows is a coin flip past about twelve.
 *   - Whatever it computed would be a SECOND definition of reply rate, beside
 *     the Statistics page's — and two numbers on one screen that disagree is
 *     worse than not having the second.
 *
 * One call, exact figures, and the same functions the page renders. If the
 * assistant and the Statistics page ever disagree it is a bug in one shared
 * place rather than a difference of opinion.
 *
 * ## Everything here is arithmetic
 *
 * `assess.ts` and `recommend.ts` both argue this at length: an assessment of
 * somebody's job search is precisely what a language model produces fluently
 * and unaccountably. So the model is handed counts and asked to say them, not
 * asked to judge. The recommendations carry their own `strength`, so a model
 * relaying one can say whether it was counted or compared against a benchmark.
 */
export const statsReport = defineRead({
  name: 'stats.report',
  title: 'Report the numbers',
  summary:
    'Figures across the whole search: how many were sent, reply and interview rates, the funnel, outcomes, per-role and per-source breakdowns with confidence ranges, and what to do next. Use it for any question about rates, totals, comparisons or how the search is going. Rates are null until something has been sent — that means not measured, not zero.',
  effect: 'read',
  input: s.object({}),
  read: (memory, _input: Record<string, never>, ctx) => {
    const today = ctx.today
    const applications = memory
      .ofType('application')
      .map((n) => applicationFrom(n, memory, today))

    /*
     * Built from props rather than through the React projection, which is a
     * layer above this one. Only three fields are read downstream — the kind,
     * the date and whether it is done — so the join to the application is work
     * nothing here would use.
     */
    const timeline = memory.ofType('timelineItem').map((n) => n.props) as never

    const stats = statsFor(applications)
    const background = memory.ofType('background').length

    return {
      // Said first and said plainly: every rate below divides by this, and a
      // model that reports "50%" without it will be believed.
      sent: stats.sent,
      tracked: applications.length,
      /*
       * Null, never zero, and this guard is load-bearing rather than tidy.
       *
       * `statsFor` floors a rate at 0 when the denominator is 0, because the
       * Statistics page never renders the tiles unless something has been sent
       * — it guards on `sent > 0` before mounting them. A tool has no such
       * wrapper, so an unguarded payload tells somebody on their first day that
       * their reply rate is 0%. That is not a bad score, it is no measurement,
       * and the difference is what the whole Statistics rebuild was about.
       *
       * `null` rather than an empty list, matching `assess` and `fitOf`: it is
       * this codebase's word for "not measured", and a model that sees it says
       * so instead of inventing a figure.
       */
      kpis:
        stats.sent === 0
          ? null
          : stats.kpis.map((k) => ({ label: k.label, value: k.value, of: k.note })),
      funnel: stats.funnel,
      outcomes: stats.outcomes,
      byRole: stats.roles,
      /*
       * Comparisons come with their ranges AND with whether jojo is willing to
       * call the difference real. A model handed two bare rates will announce a
       * finding from four records — `segments.ts` exists to stop that, and
       * hiding `confident` here would hand the problem straight back.
       */
      comparisons: comparisonsFor(applications).map(comparisonOf),
      nextSteps: recommendationsFor({ applications, timeline, background, today }).map((r) => ({
        do: r.headline,
        because: r.because,
        strength: r.strength,
      })),
    }
  },
})

/** One comparison, with its arms' ranges and a sentence on whether the difference is real. */
function comparisonOf(c: Comparison) {
  return {
    splitBy: c.dimension,
    measure: c.measure,
    arms: c.arms.map((a) => ({
      label: a.label,
      of: a.of,
      count: a.count,
      rate: `${String(a.rate)}%`,
      likelyBetween: rangeLabel(a),
    })),
    differenceIsReal: c.confident,
    note: c.confident
      ? 'The ranges do not overlap, so this difference is worth acting on.'
      : 'The ranges overlap. Report the counts if asked, but do not call this a difference.',
  }
}
