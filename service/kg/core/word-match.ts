/**
 * The search box's rule, once, for both apps: every word typed, anywhere in the
 * record, accents ignored.
 *
 * The web's ⌘K palette and the phone's search screen each had a rule of their
 * own, and each got half of it right. The palette split the query on words —
 * so "rice stat" found "Rice — Statistics" — but only lowercased, so in French
 * "theme" found nothing, the row being "Thème". The phone folded accents
 * (`fold`, in `text.ts`) but needed the whole query inside ONE field, so "rice
 * stat" found nothing there, nor did "rice statistics" across an employer and
 * a role. This is the union: fold both sides, split the query on whitespace,
 * and require each word somewhere in the record's fields taken together.
 *
 * A single word behaves exactly as `matchesQuery` does — fields are joined with
 * a space, so a word with no space in it cannot straddle two of them. The
 * Vault's filters keep `matchesQuery`; this is for the places a person types a
 * few words hoping to land on one thing.
 *
 * Split in two for the palette: it builds each record's folded haystack once
 * per record rather than once per keystroke, and folds only the query as the
 * person types. `matchesWords` is the two together, for a caller that does not
 * care.
 */

import { fold } from './text'

/** The query as folded words; empty when nothing was typed. */
export function searchWords(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean)
}

/** A record's fields, folded and joined, ready for `hasWords`. */
export function haystackOf(...fields: (string | undefined | null)[]): string {
  let out = ''
  for (const field of fields) if (field) out += ` ${fold(field)}`
  return out
}

/** Every word somewhere in the haystack. No words matches everything. */
export function hasWords(words: readonly string[], haystack: string): boolean {
  return words.every((word) => haystack.includes(word))
}

/** Every word of `query`, accents and case aside, somewhere in `fields`. */
export function matchesWords(query: string, ...fields: (string | undefined | null)[]): boolean {
  const words = searchWords(query)
  return words.length === 0 || hasWords(words, haystackOf(...fields))
}
