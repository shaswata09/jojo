/**
 * Which kind of document about the person this is. L1 core.
 *
 * A CV is a list of dated entries. A research statement is four pages of prose
 * that never repeats a date and states things no CV can — what somebody works
 * on, how they work on it, what they think it is for. A teaching statement is
 * the same shape pointed at a classroom. A cover letter is prose too, and is
 * the only one of the four addressed to somebody else.
 *
 * They are read very differently and the extractor has to be told which it is
 * looking at. Asked for "entries" from a research statement, a model returns
 * three; told it is reading prose and asked for the claims the person makes
 * about their own work, it returns the research areas, the methods and the
 * projects — which is exactly the material a CV does not carry and an academic
 * posting asks for.
 *
 * ## Why this is a guess made deterministically
 *
 * The alternative is asking a model what it is reading, which costs a round
 * trip before the real work and gets it wrong on a document with no heading.
 * The filename is a strong signal that costs nothing — people name these files
 * what they are, because they have to find them again — and the opening lines
 * are the fallback.
 *
 * Getting it wrong is not fatal in either direction. The kind only changes the
 * guidance in the prompt; every rule about inventing nothing applies whatever
 * it decides, and `other` gets the general instructions rather than none.
 */

import { fold } from './text'

/** The four documents people write about themselves, plus a default. */
export const PROFILE_DOCUMENTS = [
  'cv',
  'research-statement',
  'teaching-statement',
  'cover-letter',
  'other',
] as const
export type ProfileDocument = (typeof PROFILE_DOCUMENTS)[number]

/**
 * Filename patterns, most specific first.
 *
 * Order matters: "research-statement.pdf" contains neither "cv" nor "resume",
 * but "Teaching statement — CV appendix.pdf" contains both, and the statement
 * is what it is. So the two statements are tested before the CV.
 */
const BY_NAME: readonly (readonly [ProfileDocument, RegExp])[] = [
  ['research-statement', /\b(research|scholarship|scholarly)[\s_-]*(statement|plan|agenda|vision|narrative)\b/i],
  ['teaching-statement', /\b(teaching|pedagog\w*)[\s_-]*(statement|philosophy|portfolio|narrative)\b/i],
  ['cover-letter', /\b(cover|covering|application|motivation)[\s_-]*letter\b/i],
  // `resume` alone covers the folded 'résumé'; see `documentKindOf`.
  ['cv', /\b(cv|resume|curriculum[\s_-]*vitae|vitae)\b/i],
  // A bare "statement" after the specific ones. A research statement named
  // "Statement.pdf" is commoner than any other kind of statement in a Vault,
  // but calling it research would be a guess — `other` gets prose guidance
  // without claiming to know which prose.
  ['other', /\bstatement\b/i],
]

/**
 * Opening words, for a document whose name says nothing.
 *
 * Only the first part is looked at: these phrases are how each kind of document
 * begins, and scanning the whole text finds "my research" in a teaching
 * statement and "I am applying" in a CV's summary line.
 *
 * THE EARLIEST MATCH WINS, not the first pattern in this list. Order-of-listing
 * was the first rule and it was wrong: a teaching statement that opens "My
 * teaching philosophy begins…" and mentions research on its second page was
 * classified as research, because research happened to be listed first. A
 * document announces itself at the top, so position is the signal — and it also
 * means adding a pattern here cannot silently re-classify documents the ones
 * above it were already handling.
 */
const HEAD = 2_000

const BY_TEXT: readonly (readonly [ProfileDocument, RegExp])[] = [
  // A letter names a recipient and a post, and that is what distinguishes it
  // from a statement that also happens to open with "I".
  ['cover-letter', /\b(dear\s+(sir|madam|dr|professor|prof|mr|ms|mrs|hiring|search|members?|colleagues?)|to whom it may concern|i am writing to apply|i wish to apply|i am delighted to apply)\b/i],
  ['research-statement', /\b(my research (programme|program|agenda|focuses|centres|centers|lies|is)|research statement|my (work|research) (sits|lies|focuses))\b/i],
  ['teaching-statement', /\b(my teaching (philosophy|approach|practice)|teaching statement|in the classroom|as an (instructor|educator))\b/i],
  // A CV announces itself structurally rather than in a sentence: a contact
  // line and a section heading within the first screenful.
  ['cv', /^[^\n]{0,80}\n[^\n]{0,120}@[^\n]{0,120}\n/],
]

/**
 * What this document is, from its name and then its opening.
 *
 * The name wins when it says anything at all. Somebody who has called a file
 * "Research statement.pdf" has told us more reliably than any phrase inside it
 * — including the case where they pasted their CV under the statement, which
 * happens and which the name still describes correctly enough for the prompt.
 */
export function documentKindOf(name: string, text: string): ProfileDocument {
  /*
   * Folded, because `\b` is ASCII in JavaScript regular expressions and
   * "résumé" therefore has word boundaries inside it — `\brésumé\b` does not
   * match the word it was written for. `fold` strips the accents the same way
   * every other name comparison in the app does.
   */
  const folded = fold(name)
  for (const [kind, pattern] of BY_NAME) {
    if (pattern.test(folded)) return kind
  }

  const head = text.slice(0, HEAD)
  let best: { kind: ProfileDocument; at: number } | null = null
  for (const [kind, pattern] of BY_TEXT) {
    const at = pattern.exec(head)?.index
    if (at === undefined) continue
    if (best === null || at < best.at) best = { kind, at }
  }
  return best?.kind ?? 'other'
}

/** What the app calls each one on screen. */
export const DOCUMENT_LABEL: Readonly<Record<ProfileDocument, string>> = {
  cv: 'CV',
  'research-statement': 'research statement',
  'teaching-statement': 'teaching statement',
  'cover-letter': 'cover letter',
  other: 'document',
}
