/**
 * Whether a new application is the same job as one already saved, when the
 * arithmetic cannot tell. L3.
 *
 * `core/duplicates.ts` answers the certain cases: the same posting ID, the
 * same posting URL, the same employer and role word for word. What it cannot
 * see is "Assistant Professor of Computer Science" against "Asst. Professor,
 * CS Department" at the same university, or a posting saved once from the
 * board and once from the department's own page. That is reading, not
 * counting, and it is what a model is for — with the same discipline as every
 * other reader here: the model JUDGES, and a person decides in front of both
 * records.
 *
 * ## Bounded, on purpose
 *
 * The model is never shown the whole store. `duplicateCandidates` narrows to
 * the applications at what looks like the same employer — folded name, or a
 * name sharing most of its words — and caps them, so the prompt is a dozen
 * lines and the answer is a choice among POSITIONS in that list. Positions,
 * never ids: a record id is a uuid, and a model asked to copy one back gets a
 * character wrong often enough that the first browser run of this created the
 * duplicate it had correctly recognised. `read-cv.ts` returns positions for
 * the same reason. A position outside the list is discarded: the model cannot
 * point at a record it was not shown.
 *
 * ## What is asked
 *
 * Whether it is the same VACANCY, not the same employer. Three roles at one
 * university is what this product is for, and a judge that flagged every
 * second application to the same place would be dismissed by lunchtime. The
 * prompt says so, and `unsure` is an answer the caller treats as "no".
 */

import { fold } from '../core/text'
import { firstJsonObject } from '../core/json-reply'
import type { ChatMessage } from '../core/model-server'

/** Enough of an application to be compared, on either side. */
export type DuplicateSubject = {
  readonly id?: string
  readonly org?: string | undefined
  readonly role?: string | undefined
  readonly location?: string | undefined
  readonly url?: string | undefined
  readonly postingId?: string | undefined
}

/** How many existing records the model is shown at most. */
export const MAX_CANDIDATES = 8

const STOP = new Set([
  'the',
  'of',
  'and',
  'at',
  'in',
  'for',
  'a',
  'an',
  'university',
  'college',
  'inc',
  'ltd',
  'llc',
])

const words = (text: string): Set<string> =>
  new Set(
    fold(text)
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !STOP.has(w)),
  )

const FUNCTION_WORDS = new Set([
  'of',
  'the',
  'and',
  'at',
  'in',
  'for',
  'a',
  'an',
  'de',
  'du',
  'des',
])

/** "University of Tennessee, Knoxville" → "utk"; what people type instead. */
const initials = (text: string): string =>
  fold(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0 && !FUNCTION_WORDS.has(w))
    .map((w) => w[0] ?? '')
    .join('')

/** Whether two employer names are plausibly one employer. */
export function sameEmployer(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false
  const fa = fold(a)
  const fb = fold(b)
  if (fa === fb) return true
  if (fa.includes(fb) || fb.includes(fa)) return true
  /*
   * The acronym. "UTK" against "University of Tennessee, Knoxville" shares no
   * word and is what a person types — measured: three models all missed the
   * same case, because this filter never offered it to them. A name short
   * enough to be initials is compared as initials of the other; "UT" then
   * matches both Texas and Tennessee, which is fine — being OFFERED is not a
   * verdict, and the model is shown the full name to decide with.
   */
  const short = (x: string) => x.replace(/[^a-z0-9]/g, '')
  const sa = short(fa)
  const sb = short(fb)
  if (sa.length >= 2 && sa.length <= 6 && sa === initials(b)) return true
  if (sb.length >= 2 && sb.length <= 6 && sb === initials(a)) return true
  const wa = words(a)
  const wb = words(b)
  if (wa.size === 0 || wb.size === 0) return false
  let shared = 0
  for (const w of wa) if (wb.has(w)) shared += 1
  return shared / Math.min(wa.size, wb.size) >= 0.5
}

/**
 * The saved applications worth asking about: same employer, newest first,
 * capped. Empty means there is nothing to ask and no call is made.
 */
export function duplicateCandidates<T extends DuplicateSubject & { id: string }>(
  existing: readonly T[],
  candidate: DuplicateSubject,
  skipId?: string,
): T[] {
  return existing
    .filter((r) => r.id !== skipId && sameEmployer(r.org, candidate.org))
    .slice(0, MAX_CANDIDATES)
}

const line = (s: DuplicateSubject): string =>
  [
    s.org ? `employer: ${s.org}` : '',
    s.role ? `role: ${s.role}` : '',
    s.location ? `location: ${s.location}` : '',
    s.postingId ? `posting id: ${s.postingId}` : '',
    s.url ? `url: ${s.url}` : '',
  ]
    .filter(Boolean)
    .join(' · ')

const SYSTEM = [
  'You decide whether a job application someone is about to add is the SAME',
  'VACANCY as one they already have. Return JSON. Nothing else.',
  '',
  'Return exactly one JSON object, no prose, no code fence:',
  '  {"duplicateOf": <the NUMBER in brackets of the saved record, or null>,',
  '   "confidence": "certain" | "likely" | "unsure",',
  '   "reason": "one short sentence"}',
  '',
  'The same vacancy means the same job opening: one position, one employer,',
  'described twice — a title abbreviated, a department named instead of the',
  "university, a posting saved from the board and again from the employer's",
  'own page. A DIFFERENT role at the same employer is NOT a duplicate; people',
  'apply for several jobs at one place and that is normal.',
  '',
  'Only answer with a number from the list you are given. If none is the same',
  'vacancy, duplicateOf is null. If you cannot tell, say "unsure" — it is',
  'treated as no.',
].join('\n')

export function duplicateJudgeMessages(
  candidate: DuplicateSubject,
  existing: readonly (DuplicateSubject & { id: string })[],
): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: [
        'About to add:',
        `  ${line(candidate)}`,
        '',
        'Already saved at what looks like the same employer:',
        ...existing.map((r, i) => `  [${String(i + 1)}] ${line(r)}`),
      ].join('\n'),
    },
  ]
}

export type DuplicateVerdict = {
  readonly duplicateOf: string
  readonly confidence: 'certain' | 'likely'
  readonly reason: string
}

/**
 * The model's answer, or null when it did not name a duplicate it was shown.
 *
 * "unsure" and any id outside the offered list both read as null: the first
 * is the model's own no, the second is an answer about a record it was never
 * given and cannot be right about.
 */
export function readDuplicateVerdict(
  reply: string,
  offered: readonly { id: string }[],
): DuplicateVerdict | null {
  const parsed = firstJsonObject(reply)
  if (parsed === null || typeof parsed !== 'object') return null
  const raw = parsed as Record<string, unknown>
  /*
   * A position, accepted as a number or as text ("2", "[2]") because a small
   * model writes it either way; anything outside the list is an answer about
   * a record the model was never shown.
   */
  const at = raw['duplicateOf']
  const position =
    typeof at === 'number'
      ? at
      : typeof at === 'string' && /^\s*\[?\s*\d+\s*\]?\s*$/.test(at)
        ? Number(at.replace(/[^\d]/g, ''))
        : NaN
  const record = Number.isInteger(position) ? offered[position - 1] : undefined
  if (record === undefined) return null
  const id = record.id
  const confidence = raw['confidence']
  if (confidence !== 'certain' && confidence !== 'likely') return null
  const reason = typeof raw['reason'] === 'string' ? raw['reason'].trim() : ''
  return {
    duplicateOf: id,
    confidence,
    reason: reason || 'The model read them as the same vacancy.',
  }
}
