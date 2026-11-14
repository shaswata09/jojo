/**
 * L3 — every pass's entries merged into one list, without a row twice.
 *
 * Part of `read-cv.ts`, which re-exports `mergeBackground`. The identity an
 * entry is deduped on, and the normalising that identity needs, live here.
 */

import { fold } from '../core/text'
import type { BackgroundDraft } from './read-cv-parse'

/**
 * One entry's identity, for merging passes without duplicating rows.
 *
 * Kind, title and employer, folded. Deliberately NOT the period: the same job
 * appears in a "Positions" section with dates and again in a "Summary" without
 * them, and keying on the dates would file it twice. Two genuinely different
 * things with the same title at the same place — a Lecturer post held twice —
 * merge into one, and that is the right cost: the alternative duplicates every
 * entry a well-organised CV mentions in two places.
 */
const identity = (b: BackgroundDraft): string =>
  `${b.kind}|${flatten(b.title)}|${flatten(b.where ?? '')}`

/**
 * Folded, and with runs of whitespace collapsed.
 *
 * `fold` lowercases and strips diacritics; it deliberately leaves spacing
 * alone, because it is shared with keyword dedupe where the blast radius of a
 * change is every tag in the app. Here the extra step is needed: a document
 * converter turns a line break inside a job title into a double space, so the
 * Positions section yields "Staff  Engineer" and the summary yields "Staff
 * Engineer", and the same job is filed twice.
 */
const flatten = (text: string): string => fold(text).replace(/\s+/gu, ' ')

/**
 * Every pass's entries, in reading order, with repeats removed.
 *
 * First wins, because the passes run in document order and the first sighting
 * of an entry is the one in the section that is about it — where the dates and
 * the bullets are. A later mention in a summary is the thinner record.
 */
export function mergeBackground(
  passes: readonly (readonly BackgroundDraft[])[],
): BackgroundDraft[] {
  const seen = new Set<string>()
  const out: BackgroundDraft[] = []
  for (const pass of passes) {
    for (const entry of pass) {
      const key = identity(entry)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(entry)
    }
  }
  return out
}
