/**
 * The form behind "add an entry" and "edit this entry", as data. L1.
 *
 * Both apps draw the same form and both used to hold their own copy of the
 * three decisions in it: what a blank box means, which fields changed, and
 * what is worth refusing before a tool sees it. Two copies of that is how one
 * platform clears a field the other leaves alone. The decisions live here, the
 * apps own only the boxes.
 *
 * ## The one rule that matters
 *
 * A BLANK BOX ON AN EDIT MEANS "TAKE THIS OFF". A person who opens an entry,
 * deletes a wrong "Where" and presses Save has said something, and a form that
 * treated the empty box as "no opinion" would leave the wrong value in place
 * with nothing to show for the edit. So `updateFrom` sends `null` for a field
 * that was there and is blank now, and nothing at all for a field that did
 * not change. On an ADD, a blank box is simply absent — there is nothing to
 * take off.
 *
 * `year` is typed into a text box, because a number input's spinner is the
 * wrong control for "2019" and a phone keyboard has a numeric mode anyway; it
 * is checked here and refused with a sentence, so the tool's own message
 * ("Needs to be between 1900 and 2100") is never the first thing a person sees.
 */

import type { Background, BackgroundKind } from './model'

export type BackgroundDraft = {
  kind: BackgroundKind
  title: string
  where: string
  period: string
  /** As typed. Blank means none. */
  year: string
  detail: string
  /** One bullet per line. */
  highlights: string
}

export const emptyDraft = (kind: BackgroundKind = 'employment'): BackgroundDraft => ({
  kind,
  title: '',
  where: '',
  period: '',
  year: '',
  detail: '',
  highlights: '',
})

/** The form, filled in from a stored entry. */
export function draftOf(entry: Background): BackgroundDraft {
  return {
    kind: entry.kind,
    title: entry.title,
    where: entry.where ?? '',
    period: entry.period ?? '',
    year: entry.year === undefined ? '' : String(entry.year),
    detail: entry.detail ?? '',
    highlights: (entry.highlights ?? []).join('\n'),
  }
}

/** The bullets, one per non-blank line, trimmed. */
export const parseHighlights = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*•]\s*/, '').trim())
    .filter((line) => line !== '')

const YEAR = /^\d{4}$/

/** What is wrong with the draft, by field. Empty means it can be sent. */
export function draftProblems(
  draft: BackgroundDraft,
): Partial<Record<keyof BackgroundDraft, string>> {
  const problems: Partial<Record<keyof BackgroundDraft, string>> = {}
  if (draft.title.trim() === '') problems.title = 'Say what it was.'
  const year = draft.year.trim()
  if (year !== '') {
    const n = Number(year)
    if (!YEAR.test(year) || n < 1900 || n > 2100)
      problems.year = 'A four-digit year, or leave it blank.'
  }
  return problems
}

const yearOf = (draft: BackgroundDraft): number | undefined =>
  draft.year.trim() === '' ? undefined : Number(draft.year.trim())

/** The entry `profile.background.add` takes. Blank boxes are absent fields. */
export function addEntryFrom(draft: BackgroundDraft): {
  kind: BackgroundKind
  title: string
  where?: string
  period?: string
  year?: number
  detail?: string
  highlights?: string[]
} {
  const where = draft.where.trim()
  const period = draft.period.trim()
  const detail = draft.detail.trim()
  const year = yearOf(draft)
  const highlights = parseHighlights(draft.highlights)
  return {
    kind: draft.kind,
    title: draft.title.trim(),
    ...(where === '' ? {} : { where }),
    ...(period === '' ? {} : { period }),
    ...(year === undefined ? {} : { year }),
    ...(detail === '' ? {} : { detail }),
    ...(highlights.length === 0 ? {} : { highlights }),
  }
}

export type BackgroundUpdate = {
  kind?: BackgroundKind
  title?: string
  where?: string | null
  period?: string | null
  year?: number | null
  detail?: string | null
  highlights?: string[]
}

/**
 * What changed, as `profile.background.update` takes it — or null if nothing.
 *
 * Only the changed fields, so an edit that fixed the year leaves every other
 * field's stored value exactly as it was and the journal entry says what was
 * done. A field that was there and is blank now is sent as `null`, which the
 * tool takes off the record; a field that was never there and is still blank
 * is not mentioned.
 */
export function updateFrom(entry: Background, draft: BackgroundDraft): BackgroundUpdate | null {
  const out: BackgroundUpdate = {}
  const text = (key: 'where' | 'period' | 'detail') => {
    const next = draft[key].trim()
    const held = entry[key] ?? ''
    if (next === held) return
    out[key] = next === '' ? null : next
  }
  if (draft.kind !== entry.kind) out.kind = draft.kind
  const title = draft.title.trim()
  if (title !== '' && title !== entry.title) out.title = title
  text('where')
  text('period')
  text('detail')
  const year = yearOf(draft)
  if (year !== entry.year) out.year = year ?? null
  const highlights = parseHighlights(draft.highlights)
  const held = entry.highlights ?? []
  if (highlights.length !== held.length || highlights.some((h, i) => h !== held[i])) {
    out.highlights = highlights
  }
  return Object.keys(out).length === 0 ? null : out
}
