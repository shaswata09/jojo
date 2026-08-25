/**
 * Comparing one slice of a search against another, honestly. L1 core.
 *
 * The most useful thing a job tracker can say is comparative: "the four
 * applications that came through a referral all got a reply, and two of your
 * seventeen cold sends did". That single sentence changes what somebody does
 * next in a way no funnel does.
 *
 * It is also the easiest sentence in the app to get wrong, and the reason the
 * Statistics page has never said anything like it. With nine applications, any
 * two slices differ. Split them any way at all — by source, by role, by the day
 * of the week — and one side will be ahead, and reporting that as a finding is
 * how a tracker starts telling people to apply on Tuesdays.
 *
 * ## So the arithmetic has to carry its own uncertainty
 *
 * Every rate here comes with a WILSON SCORE INTERVAL, and a difference is only
 * ever reported as a finding when the two intervals do not overlap.
 *
 * Wilson rather than the textbook `p ± z·√(p(1−p)/n)`, and the difference is
 * not academic at these sample sizes. The normal interval on 0 of 4 is
 * `0 ± 0`— it claims certainty precisely where there is none, and it is exactly
 * the arm a job search produces most often. Wilson gives 0 of 4 the range 0% to
 * 49%, which is the honest reading: four cold sends with no reply tell you
 * almost nothing.
 *
 * Non-overlapping intervals is a deliberately CONSERVATIVE rule — stricter than
 * a two-proportion test at the same level — because the two errors here are not
 * symmetric. Failing to report a real difference costs a missed suggestion.
 * Reporting a difference that is not there sends somebody to rewrite a CV that
 * was fine, or to stop applying to the kind of job they are best suited to.
 *
 * ## What is deliberately NOT here
 *
 * No p-value reaches the screen. A number a reader cannot interpret is a number
 * that lends unearned authority to whatever sits next to it — the same failure
 * as the fabricated "2.7% offer rate" that `statistics.ts` was rebuilt to get
 * rid of. What the screen gets is the counts, the two ranges, and whether the
 * app is willing to call it a difference.
 */

import type { Application } from './model'
import { REACH, reachedOf } from './statistics'

/** A proportion and how well it is pinned down, all on 0–1. */
export type Interval = { readonly low: number; readonly high: number }

/**
 * 1.96 — the two-sided 95% normal quantile.
 *
 * Not a parameter on the public functions. A confidence level that callers can
 * choose is a confidence level somebody eventually lowers to make a finding
 * appear, and the whole value of this module is that it is not negotiable from
 * the screen it feeds.
 */
const Z = 1.96

/**
 * The Wilson score interval for `count` successes out of `of`.
 *
 * Clamped to 0–1 at the edges: the formula cannot leave the range, but floating
 * point at n = 1 lands on -1e-17, which formats as "-0%".
 */
export function wilson(count: number, of: number): Interval {
  if (of <= 0) return { low: 0, high: 1 }
  const p = count / of
  const z2 = Z * Z
  const denominator = 1 + z2 / of
  const centre = (p + z2 / (2 * of)) / denominator
  const half = (Z / denominator) * Math.sqrt((p * (1 - p)) / of + z2 / (4 * of * of))
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) }
}

/** One side of a comparison: a slice of the search and how it did. */
export type Arm = {
  readonly label: string
  /** How many records are in this slice. The denominator, always shown. */
  readonly of: number
  readonly count: number
  /** 0–100, rounded the way every other rate in the app is rounded. */
  readonly rate: number
  readonly interval: Interval
}

/**
 * The fewest records an arm needs before it is compared at all.
 *
 * Four, and it is a floor on top of the interval rule rather than instead of
 * it. Three of three is 100% with a Wilson range of 44–100%, which can clear a
 * weak opposing arm and produce "every application you sent through a referral
 * got a reply" out of three coincidences. The interval is the mathematics; this
 * is the judgement that a finding drawn from three records is not worth putting
 * in front of somebody however the arithmetic falls.
 */
export const MIN_ARM = 4

export type Comparison = {
  /** What the search was split by: 'where they came from', 'the kind of role'. */
  readonly dimension: string
  /** What was measured: 'replied', 'reached an interview'. */
  readonly measure: string
  /** Every arm that met the floor, best first. */
  readonly arms: readonly Arm[]
  readonly best: Arm
  readonly worst: Arm
  /** The intervals do not overlap. Only then is this a finding. */
  readonly confident: boolean
  /** Arms dropped for having too few records, so the screen can say so. */
  readonly tooFew: number
}

/**
 * Splits records by a label and measures each slice, or returns null.
 *
 * Null when fewer than two arms clear the floor — which on a young search is
 * almost always, and is the correct answer rather than a degenerate comparison.
 * The caller renders nothing.
 *
 * `labelOf` returning null drops a record from the split entirely: an
 * application with no source recorded is not evidence about any source, and
 * bundling it into an "unknown" arm invents a slice nobody chose.
 */
export function compare(
  rows: readonly Application[],
  spec: {
    dimension: string
    measure: string
    labelOf: (a: Application) => string | null
    hit: (a: Application) => boolean
  },
): Comparison | null {
  const groups = new Map<string, Application[]>()
  for (const row of rows) {
    const label = spec.labelOf(row)
    if (label === null) continue
    const held = groups.get(label)
    if (held) held.push(row)
    else groups.set(label, [row])
  }

  let tooFew = 0
  const arms: Arm[] = []
  for (const [label, members] of groups) {
    if (members.length < MIN_ARM) {
      tooFew += 1
      continue
    }
    const count = members.filter(spec.hit).length
    arms.push({
      label,
      of: members.length,
      count,
      rate: Math.round((count / members.length) * 100),
      interval: wilson(count, members.length),
    })
  }

  if (arms.length < 2) return null

  // Sorted by the rate a person would read, not by the interval — the ordering
  // on screen has to match the numbers on screen. Ties broken by the larger
  // denominator, so the better-evidenced arm leads.
  arms.sort((a, b) => b.rate - a.rate || b.of - a.of)
  const best = arms[0]!
  const worst = arms[arms.length - 1]!

  return {
    dimension: spec.dimension,
    measure: spec.measure,
    arms,
    best,
    worst,
    /*
     * Strictly greater, so intervals that touch at a point read as overlapping.
     *
     * No test pins the difference and none can: the two bounds are floating
     * point, and exact equality between them is not constructible from any pair
     * of integer counts. Mutating this to `>=` leaves the suite green. It is
     * written this way because the rule it states — refuse the marginal case —
     * is the one the module exists for, and the day a bound is ever computed
     * some other way, the strict form is the one that stays correct.
     */
    confident: best.interval.low > worst.interval.high,
    tooFew,
  }
}

/** The two splits worth making on what an application actually records. */
export function comparisonsFor(all: readonly Application[]): Comparison[] {
  // Only what has been sent. A draft has not been anywhere, so counting it
  // against a source would report a reply rate for applications nobody has seen.
  const sent = all.filter((a) => reachedOf(a) >= REACH.sent)

  const replied = (a: Application) => reachedOf(a) >= REACH.replied
  const interviewed = (a: Application) => reachedOf(a) >= REACH.interview

  const specs = [
    {
      dimension: 'where they came from',
      measure: 'replied',
      labelOf: (a: Application) => a.source ?? null,
      hit: replied,
    },
    {
      dimension: 'the kind of role',
      measure: 'replied',
      labelOf: (a: Application) => a.roleTag,
      hit: replied,
    },
    {
      dimension: 'where they came from',
      measure: 'reached an interview',
      labelOf: (a: Application) => a.source ?? null,
      hit: interviewed,
    },
  ]

  return specs.flatMap((spec) => {
    const found = compare(sent, spec)
    return found === null ? [] : [found]
  })
}

/** '12%' with its range, as the screen says it. Never a bare rate. */
export const rangeLabel = (arm: Arm): string =>
  `${String(Math.round(arm.interval.low * 100))}–${String(Math.round(arm.interval.high * 100))}%`
