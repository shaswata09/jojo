import type { Profile } from './model'
import { fold } from './text'

/**
 * How well something matches what you said you are looking for.
 *
 * IN `core` RATHER THAN ON ONE PLATFORM, and that is the whole reason it moved.
 * It lived in `mobile/src/lib`, so the phone computed a real percentage against
 * the user's own profile while the web app went on rendering the seeded fixture
 * numbers under a panel captioned "example scores". Same product, same profile,
 * two different answers — and the more capable one was on the smaller screen.
 * Nothing in here is a phone: it is arithmetic over a profile and a string, so
 * it belongs where both apps can reach it.
 *
 * The seed shipped fit percentages as fixtures and the panel that showed them
 * was labelled "example scores", which was honest and also useless: a number
 * nobody computed cannot rank anything, so the Matches list was in whatever
 * order the fixture happened to be written in.
 *
 * This computes them. No model and no network — scoring a short string against
 * a list of terms the user typed is arithmetic, and pretending it needs either
 * is how a feature that could work today waits for a server that does not
 * exist. What a model would add is judgement about *near* matches, which is
 * exactly what the `null` case below refuses to fake.
 *
 * THE SHAPE OF THE SCORE.
 *
 * Three inputs, weighted by how much the user actually told us:
 *
 * - **Match terms** carry most of it. They are the only field whose entire
 *   purpose is this, and someone who has typed six of them has said more about
 *   what they want than every other field combined.
 * - **Target roles** are next, and are matched loosely — "assistant professor"
 *   should hit "Assistant Professor of Computer Science".
 * - **Regions** are a bonus rather than a filter. Somewhere you did not list is
 *   not disqualifying; people take jobs in cities they never wrote down.
 *
 * `null` when the profile says nothing to score against, and every caller is
 * required to handle it. That is the difference between this and the fixtures:
 * an empty profile produces "not scored", not a confident 50%.
 */

export type Fit = {
  /** 0–100, or null when the profile has nothing to match on. */
  score: number | null
  /** The terms that actually hit, for the row's explanation. */
  matched: string[]
  /** Why there is no score, when there is none. */
  reason?: string
}

/**
 * Splits a separated field into terms worth matching.
 *
 * The interpunct is in there because both Profile screens ask for one: their
 * placeholders read `e.g. Assistant professor (TT) · Research scientist` and
 * `e.g. Texas · remote`. Splitting on commas alone meant anyone who did as they
 * were told handed the scorer a single long phrase that could not match
 * anything, so their target roles and regions were worth exactly zero and the
 * field looked broken rather than unmatched. The seeded demo profile used to be
 * written that way too, which is how it went unnoticed: its own roles and
 * regions scored nothing.
 */
const termsOf = (raw: string): string[] =>
  raw
    .split(/[,\n;·]/)
    .map((t) => fold(t).trim())
    .filter((t) => t.length > 1)

/** A word character, on text that `fold` has already lowercased and stripped. */
const WORDISH = /[a-z0-9_]/

/**
 * `term` as a whole word, bounded on whichever side ends in a word character.
 *
 * The condition matters for terms like `c++`, where a trailing `\b` would
 * demand a word character after the plus signs and never match.
 */
function wholeWord(term: string, text: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const lead = WORDISH.test(term[0] ?? '') ? '\\b' : ''
  const tail = WORDISH.test(term[term.length - 1] ?? '') ? '\\b' : ''
  return new RegExp(`${lead}${escaped}${tail}`).test(text)
}

/** At most this long, and a single word, and it has to match a whole word. */
const SHORT = 3

/**
 * A term hits if it appears in the text, or if every word of it does.
 *
 * The second half is what makes "assistant professor" match "Assistant
 * Professor of Computer Science, tenure track" — a substring test alone is too
 * strict for phrases, and any-word is far too loose ("professor" would hit
 * everything in an academic search and rank nothing).
 *
 * SHORT TERMS ARE THE EXCEPTION, and a region of `US` is why. Two letters, and
 * a substring test finds them inside Austin, focus, campus and industry — so
 * the region bonus went to nearly every posting and the row's explanation said,
 * in as many words, `matched: us`. A number that is always awarded ranks
 * nothing, and an explanation that points at the middle of "Austin" is worse
 * than no explanation. Anything up to three characters has to match a whole
 * word: `ml`, `ai`, `uk`, `nlp`.
 *
 * Longer terms keep the substring test deliberately. It is what lets
 * "inference" match "inferences", and giving that up to guard against a
 * collision that needs a word of three letters or fewer is a bad trade.
 */
function hits(term: string, text: string): boolean {
  if (term.length <= SHORT && !term.includes(' ')) return wholeWord(term, text)
  if (text.includes(term)) return true
  const words = term.split(/\s+/).filter((w) => w.length > 2)
  return words.length > 1 && words.every((w) => text.includes(w))
}

const share = (terms: string[], text: string) => {
  const hit = terms.filter((t) => hits(t, text))
  return { ratio: terms.length === 0 ? null : hit.length / terms.length, hit }
}

export function fitOf(profile: Profile, ...parts: (string | undefined)[]): Fit {
  const text = fold(parts.filter(Boolean).join(' '))

  const match = share(
    profile.matchTerms.map((t) => fold(t)),
    text,
  )
  const roles = share(termsOf(profile.text.targetRoles), text)
  const regions = share(termsOf(profile.text.regions), text)

  // Weights over the fields that were actually filled in, so a profile with
  // terms but no regions is not silently capped at the weight of what it has.
  const bands: { ratio: number; weight: number }[] = []
  if (match.ratio !== null) bands.push({ ratio: match.ratio, weight: 60 })
  if (roles.ratio !== null) bands.push({ ratio: roles.ratio, weight: 30 })
  if (regions.ratio !== null) bands.push({ ratio: regions.ratio, weight: 10 })

  if (bands.length === 0) {
    return {
      score: null,
      matched: [],
      reason: 'Add match terms or target roles to your profile and this starts scoring.',
    }
  }

  const total = bands.reduce((n, b) => n + b.weight, 0)
  const score = Math.round(bands.reduce((n, b) => n + b.ratio * b.weight, 0) * (100 / total))

  return { score, matched: [...match.hit, ...roles.hit, ...regions.hit] }
}
