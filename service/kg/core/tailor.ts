/**
 * What to do about an assessment — tailor, prepare, or leave it. L1 core.
 *
 * `assess.ts` answers "how well does this person's record answer this posting".
 * That is a measurement and it stops there. This is the layer that turns the
 * measurement into the three things somebody actually wants the evening they
 * decide whether to apply:
 *
 *   - **Is it worth it.** A verdict, in words, with the reason attached.
 *   - **What to put in front of them.** Which of thirty facts are the five that
 *     matter for THIS employer.
 *   - **What to be ready for.** The requirements the record does not answer are
 *     the questions an interview will open with, whether or not the person can
 *     answer them.
 *
 * ## Still not a model, and this is where that gets hard
 *
 * Everything above `assess()` is arithmetic and stays that way here. The
 * temptation at this layer is enormous — "write me advice about this
 * application" is exactly the prompt a language model answers fluently — and
 * the output would be unfalsifiable. A person reading "emphasise your systems
 * background" cannot tell whether the app looked at their records or produced a
 * sentence that fits any candidate.
 *
 * So every line below names a record or a requirement. If there is nothing to
 * point at, the honest output is silence rather than encouragement.
 *
 * ## The verdict bands are deliberately few
 *
 * Three, not five, and no percentage in the sentence. A person deciding whether
 * to spend an evening on an application is making a three-way choice — do it,
 * do it carefully, or do not — and a finer scale invites them to treat the
 * difference between 61% and 68% as meaning something it does not. The number
 * is available beside it for anyone who wants it.
 */

import type { Assessment, Evidence } from './assess'
import { gapAdvice } from './assess'

export type Verdict = 'strong' | 'worth-tailoring' | 'a-stretch' | 'not-measured'

/**
 * What to lead with, and why it earns the space.
 *
 * The requirement is carried alongside the record because that is what makes
 * this actionable: "lead with your OSDI paper" is a suggestion, and "lead with
 * your OSDI paper — it is what answers their distributed systems requirement"
 * is an instruction somebody can follow into a cover letter.
 */
export type TailorNote = {
  readonly evidence: Evidence
  /** The requirement this record answers best. */
  readonly answers: string
}

/** Something to be ready to be asked about. */
export type PrepNote = {
  readonly requirement: string
  readonly essential: boolean
  /** What to do about it before the interview. */
  readonly advice: string
}

export type Guidance = {
  readonly verdict: Verdict
  /** One sentence. Names the reason, never just the band. */
  readonly summary: string
  readonly tailor: readonly TailorNote[]
  readonly prepare: readonly PrepNote[]
}

/** Above this, the record answers most of what was asked. */
const STRONG = 70
/** Below this, the gaps are the story rather than the detail. */
const STRETCH = 35

/**
 * An assessment, turned into what to do about it.
 *
 * `null` score in means `not-measured` out, and every field empty. That case is
 * not a bad fit — it is a person whose background jojo has not read yet, and
 * offering them tailoring advice drawn from nothing would be the exact failure
 * `assess` refuses by returning null in the first place.
 */
export function guidanceFrom(assessment: Assessment): Guidance {
  if (assessment.score === null) {
    return {
      verdict: 'not-measured',
      summary:
        'jojo has not read anything about your background yet, so it cannot weigh this posting against it. Add your CV to the Vault and let the profile pipeline read it.',
      tailor: [],
      prepare: [],
    }
  }

  const essentialGaps = assessment.gaps.filter((g) => g.requirement.essential)

  /*
   * The verdict, and the essential-gap override is the part that matters.
   *
   * A score can be respectable while the one thing the posting says it requires
   * is missing — meeting every preference and no requirement. Reporting that as
   * "worth tailoring" would be technically defensible arithmetic and terrible
   * advice, so a missing essential caps the verdict regardless of the number.
   */
  const verdict: Verdict =
    essentialGaps.length > 0 && assessment.score < STRONG
      ? 'a-stretch'
      : assessment.score >= STRONG
        ? 'strong'
        : assessment.score >= STRETCH
          ? 'worth-tailoring'
          : 'a-stretch'

  /*
   * Each record paired with the requirement it best answers.
   *
   * Walks `answered` rather than `lead` alone, because `lead` is a ranked list
   * of records and what is needed here is the PAIR. A person writing a cover
   * letter needs to know which sentence of the posting each of their facts is
   * for.
   *
   * The pairing repeats `assess`'s own contribution weighting — essentials
   * double, later ranks discounted — rather than just taking rank 0. An entry
   * can reach `lead` on being the second-best answer to three requirements
   * without ever topping one, and dropping it here would silently shorten the
   * list of things to lead with. Using the same formula also means the
   * requirement named is the one that put the entry on the list.
   */
  const weight = (essential: boolean) => (essential ? 2 : 1)
  const bestFor = new Map<string, { text: string; score: number }>()
  for (const a of assessment.answered) {
    for (const [rank, e] of a.evidence.entries()) {
      const score = weight(a.requirement.essential) * a.strength * (1 - rank * 0.25)
      const held = bestFor.get(e.id)
      if (held && held.score >= score) continue
      bestFor.set(e.id, { text: a.requirement.text, score })
    }
  }
  const tailor: TailorNote[] = assessment.lead.flatMap((e) => {
    const best = bestFor.get(e.id)
    return best === undefined ? [] : [{ evidence: e, answers: best.text }]
  })

  const prepare: PrepNote[] = assessment.gaps.map((gap) => ({
    requirement: gap.requirement.text,
    essential: gap.requirement.essential,
    advice: gapAdvice(gap),
  }))

  return { verdict, summary: summaryFor(verdict, assessment, essentialGaps.length), tailor, prepare }
}

/**
 * The one sentence, which always names a reason.
 *
 * "This is a strong fit" is a horoscope. "Your record answers all four of what
 * they ask for, including both requirements" is a claim somebody can check
 * against the list underneath — and disagree with, which is the point.
 */
function summaryFor(verdict: Verdict, a: Assessment, essentialGaps: number): string {
  const answered = a.answered.filter((x) => x.evidence.length > 0).length
  const total = a.answered.length
  const of = `${String(answered)} of ${String(total)}`

  switch (verdict) {
    case 'strong':
      return `Your record answers ${of} of the things this posting asks for. Lead with the entries below and the application mostly writes itself.`
    case 'worth-tailoring':
      return essentialGaps > 0
        ? `Your record answers ${of}, but ${String(essentialGaps)} of what they state as required is not in it. Worth applying if you can answer those — see below.`
        : `Your record answers ${of}. The gaps are all preferences rather than requirements, so this is worth an evening.`
    case 'a-stretch':
      return essentialGaps > 0
        ? `Your record answers ${of}, and ${String(essentialGaps)} of what they call required is missing from it. If you have those and they are simply not written down, fix the CV first.`
        : `Your record answers ${of}. This one is a stretch on what jojo can see.`
    case 'not-measured':
      return 'Not measured.'
  }
}

/** What the verdict is called on screen. Short, and never a percentage. */
export const VERDICT_LABEL: Readonly<Record<Verdict, string>> = {
  strong: 'A strong fit',
  'worth-tailoring': 'Worth tailoring',
  'a-stretch': 'A stretch',
  'not-measured': 'Not measured yet',
}
