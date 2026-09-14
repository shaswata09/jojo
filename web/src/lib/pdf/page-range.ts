/**
 * "1-3, 7, 9-" -> the pages it names.
 *
 * Page numbers are what a person reads off the page, so they are 1-based in the
 * text and 0-based in the result: every PDF library indexes from zero, and
 * converting at the boundary means nothing downstream has to remember which
 * convention it is holding.
 *
 * Pure, and its own module, because a range is the one input here a person
 * types by hand — it is where a typo becomes a silently wrong document, and it
 * is the only part of merging that can be checked without a PDF.
 */

export type PageRange =
  | { readonly ok: true; readonly pages: readonly number[] }
  | { readonly ok: false; readonly reason: string }

/** What a blank box means. Spelled out because "" and "all" must not diverge. */
export const ALL_PAGES = ''

/**
 * Parses `input` against a document of `pageCount` pages.
 *
 * Blank means every page, which is what an empty box should do: a merge with
 * nothing typed takes the whole document rather than nothing at all.
 *
 * Repeats are kept. `1,1,2` is a legitimate request — a cover sheet used twice
 * — and silently collapsing it would produce a document the person did not ask
 * for without saying so. Order is kept for the same reason: `3,1` means pages
 * in that order, which is how a range doubles as a reordering.
 */
export function parsePageRange(input: string, pageCount: number): PageRange {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    return { ok: false, reason: 'That document has no pages.' }
  }
  const text = input.trim()
  if (text === ALL_PAGES) return { ok: true, pages: Array.from({ length: pageCount }, (_, i) => i) }

  const pages: number[] = []
  for (const raw of text.split(',')) {
    const part = raw.trim()
    if (part === '') return { ok: false, reason: 'There is an empty range between two commas.' }

    // A single page, or a span. `9-` runs to the end, `-3` starts at the first
    // page; both are how every page-range box a person has used already behaves.
    const span = /^(\d*)\s*-\s*(\d*)$/.exec(part)
    if (span) {
      const [, fromText = '', toText = ''] = span
      if (fromText === '' && toText === '') {
        return { ok: false, reason: `'${part}' names no pages.` }
      }
      const from = fromText === '' ? 1 : Number(fromText)
      const to = toText === '' ? pageCount : Number(toText)
      const bad = outOfRange(from, pageCount) ?? outOfRange(to, pageCount)
      if (bad) return { ok: false, reason: bad }
      if (from > to) {
        return { ok: false, reason: `'${part}' counts backwards. Write it as ${to}-${from}.` }
      }
      for (let page = from; page <= to; page++) pages.push(page - 1)
      continue
    }

    if (!/^\d+$/.test(part)) return { ok: false, reason: `'${part}' is not a page number.` }
    const bad = outOfRange(Number(part), pageCount)
    if (bad) return { ok: false, reason: bad }
    pages.push(Number(part) - 1)
  }
  if (pages.length === 0) return { ok: false, reason: 'That range names no pages.' }
  return { ok: true, pages }
}

function outOfRange(page: number, pageCount: number): string | null {
  if (page < 1) return 'Pages are numbered from 1.'
  if (page > pageCount) {
    return `This document ends at page ${pageCount}, so page ${page} is not in it.`
  }
  return null
}

/**
 * The inverse, for printing a selection back: [0,1,2,4] -> '1-3, 5'.
 *
 * Only collapses a run that is already in order. A reordering like [2,0] stays
 * '3, 1' rather than being tidied into something that reads the same forwards
 * and backwards but is not the same document.
 */
export function formatPageRange(pages: readonly number[]): string {
  if (pages.length === 0) return ''
  const parts: string[] = []
  let start = pages[0] ?? 0
  let previous = start
  for (const page of pages.slice(1)) {
    if (page === previous + 1) {
      previous = page
      continue
    }
    parts.push(span(start, previous))
    start = page
    previous = page
  }
  parts.push(span(start, previous))
  return parts.join(', ')
}

const span = (from: number, to: number) => (from === to ? `${from + 1}` : `${from + 1}-${to + 1}`)
