/**
 * What to do next, ranked, with the evidence attached. L1 core.
 *
 * The Statistics page reports. This decides. Those are different jobs and the
 * page has only ever done the first: a funnel, four rates and a radar tell
 * somebody how the search is going and leave them to work out what that implies
 * on a Sunday evening when they are least able to.
 *
 * ## Every line names a count, and the ones that cannot say so
 *
 * The radar's suggestions were half of this already, and half of them were
 * fixed strings: "Tailoring the opening paragraph moves this more than anything
 * else" is printed whether the reply rate is 4% or 40%, which makes it advice
 * about job hunting rather than about this search. Where a suggestion is that
 * kind of general wisdom it is marked `suggested` here and ranked below
 * everything counted, rather than dressed up as a finding.
 *
 * ## Ranking is by what the evidence supports, then by cost
 *
 * `measured` before `suggested`, always — a claim drawn from the person's own
 * records outranks one drawn from a benchmark nobody in this app has met. Below
 * that the order is roughly cheapest-first: chasing four silent applications is
 * an hour, and changing how you write a cover letter is a month. A list that
 * opened with the month-long item would be read once.
 *
 * ## What is deliberately absent
 *
 * Nothing here predicts. There is no "you are likely to get an offer in March",
 * no fitted curve, no projection from six data points. `segments.ts` argues the
 * general case: at these sample sizes the honest output is a range and a
 * refusal, and a projection is the most confident-sounding thing this app could
 * possibly print.
 */

import type { Application, TimelineItem } from './model'
import { daysBetween } from './dates'
import { medianOf, REACH, reachedOf, replyGaps, TYPICAL } from './statistics'
import { comparisonsFor, rangeLabel } from './segments'

/** After a fortnight with no activity, a live application has gone quiet. */
const STALE_DAYS = 14

export type Strength =
  /** Counted from this person's records. */
  | 'measured'
  /** General, or measured against the typical search rather than their own. */
  | 'suggested'

export type Recommendation = {
  /** Stable across renders, so a list can key on it. */
  readonly id: string
  /** The action, in the imperative. What to actually do. */
  readonly headline: string
  /** Why — with the numbers, always. */
  readonly because: string
  readonly strength: Strength
  /** Higher first. Only meaningful within a strength. */
  readonly weight: number
}

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`

/**
 * Everything worth suggesting, best first.
 *
 * `background` is a count rather than the records: the only question asked of
 * it is whether the graph knows anything about the person at all, and passing
 * the rows would invite this file to start reasoning about their career.
 */
export function recommendationsFor(input: {
  applications: readonly Application[]
  timeline: readonly TimelineItem[]
  /** How many facts about the person the graph holds. See `core/twin.ts`. */
  background: number
  /** Injected — D26. This file has no clock. */
  today: string
}): Recommendation[] {
  const { applications, timeline, background, today } = input
  const out: Recommendation[] = []

  const sent = applications.filter((a) => reachedOf(a) >= REACH.sent)
  const drafts = applications.filter((a) => reachedOf(a) < REACH.sent)

  /* ------------------------- 1. what the split says ------------------------ */

  /*
   * The findings, and only the confident ones. `segments.ts` refuses to call
   * anything a difference until two Wilson intervals separate, so a comparison
   * that arrives here has already survived the part where a young search
   * produces a finding out of noise.
   */
  for (const c of comparisonsFor(applications)) {
    if (!c.confident) continue
    out.push({
      id: `segment:${c.dimension}:${c.measure}`,
      headline: `Put more of your effort into ${c.best.label.toLowerCase()}.`,
      because: `${String(c.best.count)} of ${String(c.best.of)} ${c.measure} there (${String(c.best.rate)}%, likely ${rangeLabel(c.best)}), against ${String(c.worst.count)} of ${String(c.worst.of)} for ${c.worst.label.toLowerCase()} (${String(c.worst.rate)}%, likely ${rangeLabel(c.worst)}). Split by ${c.dimension}.`,
      strength: 'measured',
      weight: 100 + (c.best.rate - c.worst.rate),
    })
  }

  /* --------------------------- 2. overdue chases --------------------------- */

  const late = timeline.filter((i) => i.kind === 'follow-up' && !i.completedOn && i.date < today)
  if (late.length > 0) {
    out.push({
      id: 'follow-ups:late',
      headline: `Clear ${plural(late.length, 'overdue follow-up', 'overdue follow-ups')}.`,
      because:
        'These are chases you already decided were worth making, on applications an employer has already seen. Nothing else on this list is as close to done.',
      strength: 'measured',
      weight: 90 + late.length,
    })
  }

  /* ------------------- 3. silent for longer than your usual ----------------- */

  /*
   * The most specific thing this file can say, and it is only sayable once the
   * person has enough replies to have a usual. `medianOf` is shared with the
   * KPI tile deliberately — two definitions of a median are two numbers that
   * eventually disagree on one screen.
   */
  const median = medianOf(replyGaps(applications))
  if (median !== null) {
    const silent = sent.filter((a) => {
      if (a.firstReplyOn || a.stage === 'closed') return false
      const at = a.appliedOn ?? a.submittedOn
      return at !== undefined && daysBetween(at, today) > median
    })
    if (silent.length > 0) {
      out.push({
        id: 'silent:past-median',
        headline: `Chase ${plural(silent.length, 'application', 'applications')} that have gone quiet.`,
        because: `Replies to you arrive in ${plural(median, 'day', 'days')} typically, and these ${silent.length === 1 ? 'one has' : 'have'} passed that with nothing back. That is your own figure, not a rule of thumb.`,
        strength: 'measured',
        weight: 80 + silent.length,
      })
    }
  }

  /* ------------------------------ 4. gone quiet ---------------------------- */

  const live = sent.filter((a) => a.stage !== 'closed')
  const stale = live.filter((a) => a.daysAgo > STALE_DAYS)
  if (stale.length > 0) {
    out.push({
      id: 'live:stale',
      headline: `Record what happened on ${plural(stale.length, 'application', 'applications')}.`,
      because: `${stale.length === 1 ? 'It has' : 'They have'} had nothing written against ${stale.length === 1 ? 'it' : 'them'} in a fortnight. Every rate on this page is only as good as what has been written down.`,
      strength: 'measured',
      weight: 70,
    })
  }

  /* ----------------------------- 5. draft debt ----------------------------- */

  if (drafts.length > 0) {
    // The oldest is named because "five drafts" is a statistic and "the Rice
    // one has been open since March" is a decision.
    const oldest = drafts.reduce((a, b) => (a.daysAgo >= b.daysAgo ? a : b))
    out.push({
      id: 'drafts:open',
      headline:
        drafts.length === 1
          ? 'Finish the draft or drop it.'
          : `Finish the closest of ${plural(drafts.length, 'draft', 'drafts')}, or drop them.`,
      because: `A draft does nothing until it goes out. The oldest has been open ${plural(oldest.daysAgo, 'day', 'days')}.`,
      strength: 'measured',
      weight: 60,
    })
  }

  /* ------------------- 6. read the CV in, so fit can be judged -------------- */

  if (background === 0 && sent.length > 0) {
    out.push({
      id: 'background:none',
      headline: 'Let jojo read your CV.',
      because:
        'Nothing about your own background is recorded, so no application can be weighed against what a posting asks for. It is one document and one confirmation.',
      strength: 'measured',
      weight: 55,
    })
  }

  /* ----------------------- 7. where the funnel leaks ----------------------- */

  /*
   * The one comparison against the typical search rather than against
   * themselves, and it is `suggested` for exactly that reason — the benchmark
   * is a round number this app chose, and `TYPICAL`'s own header says so.
   *
   * Only stated when there is a denominator worth dividing by. A reply rate off
   * three applications is not a leak, it is three applications.
   */
  const ENOUGH_TO_DIAGNOSE = 8
  if (sent.length >= ENOUGH_TO_DIAGNOSE) {
    const steps = [
      {
        id: 'replies',
        got: sent.filter((a) => reachedOf(a) >= REACH.replied).length,
        typical: TYPICAL.responseRate,
        headline: 'Rework the opening paragraph before you send the next one.',
        because: 'Replies are where this search loses most against a typical one.',
      },
      {
        id: 'interviews',
        got: sent.filter((a) => reachedOf(a) >= REACH.interview).length,
        typical: TYPICAL.interviewRate,
        headline: 'Make the fit obvious in the first three lines.',
        because:
          'Replies that stall before a call are the biggest gap here — the interest is there and the case is not landing.',
      },
    ]
    const scored = steps
      .map((s) => ({ ...s, rate: Math.round((s.got / sent.length) * 100) }))
      .map((s) => ({ ...s, behind: s.typical - s.rate }))
      .filter((s) => s.behind > 0)
      .sort((a, b) => b.behind - a.behind)

    const worst = scored[0]
    if (worst) {
      out.push({
        id: `funnel:${worst.id}`,
        headline: worst.headline,
        because: `${worst.because} ${String(worst.got)} of ${String(sent.length)} (${String(worst.rate)}%), against ${String(worst.typical)}% for a typical search — a figure jojo chose as a round comparison, not one measured from anybody.`,
        strength: 'suggested',
        weight: 40 + worst.behind,
      })
    }
  }

  /* --------------------------- 8. nothing is wrong ------------------------- */

  if (out.length === 0 && sent.length > 0) {
    out.push({
      id: 'clear',
      headline: 'Nothing here needs chasing.',
      because: `Every follow-up is on time, nothing has gone quiet, and there are no drafts waiting. ${plural(sent.length, 'application is', 'applications are')} out.`,
      strength: 'measured',
      weight: 0,
    })
  }

  return out.sort(
    (a, b) =>
      Number(b.strength === 'measured') - Number(a.strength === 'measured') || b.weight - a.weight,
  )
}
