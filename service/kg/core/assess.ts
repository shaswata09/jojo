/**
 * How well the person actually fits a posting, and what is missing. L1 core.
 *
 * `fit.ts` scores a posting against what somebody TYPED — their match terms,
 * their target roles, their regions. That is a real signal and it is a
 * statement of intent: it says what they are looking for. It says nothing about
 * whether they would get it.
 *
 * This scores against what they have DONE — the background read out of their own
 * documents. Different question, different answer, and the two disagreeing
 * is itself informative: somebody whose stated interest is systems and whose
 * publications are all in graphics is looking at the wrong postings, and only a
 * comparison of the two can tell them so.
 *
 * ## Arithmetic, not a model, and the reason is not cost
 *
 * `fit.ts` makes this argument and it holds here for a stronger reason. An
 * assessment of somebody's career is exactly the kind of output a language
 * model will produce fluently and unaccountably: "your background is a strong
 * match for this role" is a sentence a model will write for any pairing, and
 * the person reading it has no way to check it.
 *
 * Everything below is countable and every claim carries its evidence — the
 * requirement it matched, and the background entry that matched it. A person can
 * disagree with a specific line. That is worth more than a paragraph they can
 * only believe or not.
 *
 * A model still has a job here, and it is the one at the top: turning a posting
 * into the list of requirements this takes as input. Judging prose is what it
 * is good at; scoring is not.
 *
 * ## What "improve" means, and what it does not
 *
 * A gap is a requirement with nothing in the record that answers it. That is
 * emphatically NOT the same as a shortcoming — the commonest reason for a gap
 * is that the CV never mentioned something the person can do. So the copy
 * around every gap has to leave room for "you have this, it is not written
 * down", and the type below says which of the two it can tell apart: it
 * cannot, and it does not pretend to.
 */

import { fold } from './text'

/** One thing a posting asks for, as a reader would state it. */
export type Requirement = {
  /** The phrase from the posting: 'distributed systems', 'PhD in CS'. */
  readonly text: string
  /**
   * Whether the posting states this as required or preferred.
   *
   * Weighted differently below, because missing a "must have" and missing a
   * "nice to have" are not the same news.
   */
  readonly essential: boolean
}

/** A background entry, in the shape this file needs. Kept structural on purpose. */
export type Evidence = {
  readonly id: string
  readonly kind: string
  readonly title: string
  readonly where?: string | undefined
  readonly detail?: string | undefined
  readonly year?: number | undefined
}

/** One requirement, and what in the record answers it. */
export type Answered = {
  readonly requirement: Requirement
  /**
   * What matched, best first. Empty means this is a gap.
   *
   * Ids rather than prose, so a screen can link to the actual record. A claim
   * about somebody's background that cannot be traced to the line it came from
   * is a claim they cannot check.
   */
  readonly evidence: readonly Evidence[]
  /** 0–1, how well the best evidence covers the requirement. */
  readonly strength: number
}

export type Assessment = {
  /**
   * 0–100, or null when there is nothing to score.
   *
   * Null rather than zero, and every caller must handle it — the same rule
   * `fitOf` follows. A person with no background entries recorded has not scored badly
   * against this posting; they have not been measured, and telling them 0% is
   * telling them something false about themselves.
   */
  readonly score: number | null
  readonly answered: readonly Answered[]
  /** Requirements with nothing behind them, essential ones first. */
  readonly gaps: readonly Answered[]
  /**
   * The background entries worth putting in front of this employer.
   *
   * The tailoring half. Which of somebody's thirty facts are the five that
   * matter for THIS posting is a question they otherwise answer by rereading
   * their own CV every time.
   */
  readonly lead: readonly Evidence[]
}

/** Words too common to carry a match. Shorter than a stoplist for prose. */
const NOISE = new Set([
  'and', 'the', 'for', 'with', 'you', 'our', 'are', 'have', 'has', 'will', 'work',
  'working', 'experience', 'strong', 'excellent', 'ability', 'skills', 'knowledge',
  'related', 'field', 'years', 'year', 'plus', 'preferred', 'required', 'must',
  'should', 'demonstrated', 'proven', 'track', 'record', 'candidate', 'candidates',
  'role', 'position', 'team', 'teams',
])

/** The content words of a phrase, folded for comparison. */
function terms(phrase: string): Set<string> {
  const out = new Set<string>()
  for (const word of fold(phrase).split(/[^a-z0-9+#]+/)) {
    if (word.length < 3 || NOISE.has(word)) continue
    out.add(word)
    // A crude singular, past four letters so 'has' does not become 'ha'.
    if (word.length > 4 && word.endsWith('s')) out.add(word.slice(0, -1))
  }
  return out
}

/** Everything about a background entry that could match, as one bag of terms. */
const evidenceTerms = (e: Evidence): Set<string> =>
  terms([e.title, e.where ?? '', e.detail ?? '', e.kind].join(' '))

/**
 * How much of a requirement one entry covers, 0–1.
 *
 * The fraction of the requirement's content words the entry mentions —
 * asymmetric on purpose. A publication whose title is thirty words long should
 * not score lower for being specific, and a requirement is the thing that has
 * to be covered.
 */
function overlap(requirement: Set<string>, evidence: Set<string>): number {
  if (requirement.size === 0) return 0
  let hit = 0
  for (const term of requirement) if (evidence.has(term)) hit += 1
  return hit / requirement.size
}

/** Below this, a shared word is a coincidence rather than a match. */
const MATCH_FLOOR = 0.34

/**
 * The person's record, weighed against what a posting asks for.
 *
 * `requirements` come from reading the posting — a model's job, and the one
 * place in this pipeline where judgement about prose is genuinely needed.
 * Everything after that is counting.
 */
export function assess(
  requirements: readonly Requirement[],
  background: readonly Evidence[],
): Assessment {
  if (background.length === 0 || requirements.length === 0) {
    return { score: null, answered: [], gaps: [], lead: [] }
  }

  const bags = background.map((e) => ({ evidence: e, terms: evidenceTerms(e) }))

  const answered: Answered[] = requirements.map((requirement) => {
    const wanted = terms(requirement.text)
    const scored = bags
      .map((b) => ({ evidence: b.evidence, strength: overlap(wanted, b.terms) }))
      .filter((m) => m.strength >= MATCH_FLOOR)
      .sort((a, b) => b.strength - a.strength)

    return {
      requirement,
      // Three at most. A screen that lists nine pieces of evidence for one
      // requirement is a screen nobody reads, and the fourth-best match is
      // never the one that persuades anybody.
      evidence: scored.slice(0, 3).map((m) => m.evidence),
      strength: scored[0]?.strength ?? 0,
    }
  })

  /*
   * Essentials are worth double, and the weighting is the whole difference
   * between this and a percentage of boxes ticked. Meeting eight preferences
   * and missing the one required degree is not an 89% fit, and a number that
   * said so would be actively misleading on the screen where somebody decides
   * whether to spend an evening on an application.
   */
  const weight = (r: Requirement) => (r.essential ? 2 : 1)
  const total = requirements.reduce((n, r) => n + weight(r), 0)
  const earned = answered.reduce((n, a) => n + weight(a.requirement) * a.strength, 0)

  const gaps = answered
    .filter((a) => a.evidence.length === 0)
    .sort((a, b) => Number(b.requirement.essential) - Number(a.requirement.essential))

  /*
   * The tailoring list: the background entries that answer the most, weighted by how
   * much each requirement counts, best first.
   *
   * Deliberately drawn from what MATCHED rather than from what is most
   * impressive. The best paper in somebody's record is not the one to lead with
   * if this employer never asked about that subject.
   */
  const contribution = new Map<string, { evidence: Evidence; score: number }>()
  for (const a of answered) {
    for (const [rank, evidence] of a.evidence.entries()) {
      const current = contribution.get(evidence.id) ?? { evidence, score: 0 }
      // Ranked within a requirement, so the best match for a requirement counts
      // for more than the third-best.
      current.score += weight(a.requirement) * a.strength * (1 - rank * 0.25)
      contribution.set(evidence.id, current)
    }
  }
  const lead = [...contribution.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((c) => c.evidence)

  return {
    score: Math.round((earned / total) * 100),
    answered,
    gaps,
    lead,
  }
}

/**
 * What is worth saying about a gap, given that jojo cannot tell why it is there.
 *
 * The distinction this exists to preserve: a gap means the RECORD does not
 * answer the requirement. It does not mean the person cannot do the thing. The
 * commonest cause by a wide margin is a CV that never mentioned it.
 *
 * So the sentence offers both readings and puts the recoverable one first,
 * because it is both more likely and the one the person can act on tonight.
 */
export const gapAdvice = (gap: Answered): string =>
  gap.requirement.essential
    ? `Nothing in your record answers “${gap.requirement.text}”, and this one is stated as required. If you have it, it needs to be on the CV; if you do not, this application is a long shot.`
    : `Nothing in your record answers “${gap.requirement.text}”. It is listed as preferred rather than required, so it is worth a line if you have it and not worth inventing if you do not.`
