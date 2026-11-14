/**
 * L3 — the model's reply to a section pass, turned into background drafts.
 *
 * Part of `read-cv.ts`, which re-exports every name exported here. Salvages a
 * cut-off reply, checks each entry on its own, and cleans the fields models
 * fill with placeholders despite being told not to.
 */

import { salvageJsonObject } from '../core/json-reply'
import { BACKGROUND_KINDS } from '../core/model'
import type { BackgroundKind } from '../core/model'

/** One extracted fact, before it has been checked or filed. */
export type BackgroundDraft = {
  kind: BackgroundKind
  title: string
  where?: string
  period?: string
  year?: number
  detail?: string
  highlights?: string[]
}

export type CvRead =
  | {
      ok: true
      background: readonly BackgroundDraft[]
      /**
       * Entries the model returned that could not be used, with the reason.
       *
       * Reported rather than dropped. "Four of thirty entries were skipped" is
       * something a person can act on; silently filing twenty-six is how a
       * missing publication becomes invisible.
       */
      skipped: readonly string[]
    }
  | { ok: false; reason: string }

/**
 * The model's reply, turned into drafts, refusing rather than throwing.
 *
 * Every entry is checked independently: one malformed row costs that row and
 * not the other twenty-nine. That matters more here than in most parsers —
 * re-reading a CV is a round trip to somebody's GPU, and discarding a good
 * extraction because one publication had a number where its title should be
 * would be paying for the whole thing twice.
 */
export function readCv(reply: string): CvRead {
  // Salvaged, not merely parsed. A section pass that ran out of tokens used to
  // be reported as "the model did not return JSON" and every entry in it
  // discarded — see `json-reply.ts`. The entries that arrived whole are kept
  // and the loss is reported in `skipped`, which the caller already shows.
  const { value: payload, truncated } = salvageJsonObject(reply)
  if (payload === null) {
    return { ok: false, reason: 'The model did not return JSON.' }
  }
  if ((payload as { notAboutThePerson?: unknown }).notAboutThePerson === true) {
    return { ok: false, reason: 'That document does not read as being about you.' }
  }

  const raw = (payload as { background?: unknown }).background
  if (!Array.isArray(raw)) {
    return { ok: false, reason: 'The model returned JSON without a background list.' }
  }

  const background: BackgroundDraft[] = []
  const skipped: string[] = []

  // Said once, at the top, because it explains every later gap in this pass and
  // is not the parser's fault or the model's. The caller shows `skipped`.
  if (truncated) {
    skipped.push(
      'the reply was cut off before it finished — the entries it had completed were kept, and anything after them was lost',
    )
  }

  for (const [index, entry] of raw.entries()) {
    const drafted = draftOf(entry, index)
    if (typeof drafted === 'string') skipped.push(drafted)
    else background.push(drafted)
  }

  if (background.length === 0) {
    return {
      ok: false,
      reason:
        skipped.length > 0
          ? `Nothing in that document could be read as a fact about you. ${skipped[0] ?? ''}`
          : 'Nothing in that document could be read as a fact about you.',
    }
  }

  return { ok: true, background, skipped }
}

/**
 * One entry of the reply as a draft, or the reason it could not be one.
 *
 * Checked on its own, so a bad row costs that row: the caller files the draft
 * or reports the reason in `skipped`, and moves on to the next.
 */
function draftOf(entry: unknown, index: number): BackgroundDraft | string {
  if (typeof entry !== 'object' || entry === null) {
    return `entry ${String(index + 1)}: not an object`
  }
  const row = entry as Record<string, unknown>

  const kind = row['kind']
  if (typeof kind !== 'string' || !(BACKGROUND_KINDS as readonly string[]).includes(kind)) {
    return `entry ${String(index + 1)}: kind "${String(kind)}" is not one jojo knows`
  }

  const title = text(row['title'])
  if (title === undefined) {
    return `entry ${String(index + 1)}: no title`
  }

  return {
    kind: kind as BackgroundKind,
    title,
    ...maybe('where', text(row['where'])),
    ...maybe('period', text(row['period'])),
    ...maybe('year', year(row['year'])),
    ...maybe('detail', text(row['detail'])),
    ...maybe('highlights', bullets(row['highlights'])),
  }
}

/**
 * The bullet points under an entry, cleaned, or undefined.
 *
 * Tolerant of the two wrong shapes models return for a list field. A single
 * string comes back as one bullet rather than being dropped — it is what the
 * document said, and a job with one achievement line is common. A list with
 * blanks and placeholders in it loses those and keeps the rest, on the same
 * per-row principle the entry loop follows: one bad element costs that element.
 *
 * Capped, because a model that has started transcribing has stopped extracting.
 * Twelve bullets under one job is already more than any CV prints.
 */
const MAX_HIGHLIGHTS = 12

function bullets(value: unknown): string[] | undefined {
  const raw = typeof value === 'string' ? [value] : Array.isArray(value) ? value : null
  if (raw === null) return undefined
  const out = raw
    .map((v) => text(v))
    .filter((v): v is string => v !== undefined)
    .slice(0, MAX_HIGHLIGHTS)
  return out.length > 0 ? out : undefined
}

/** Present, a string, and not one of the placeholders the prompt forbids. */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  // Models write these despite being told not to, and a record reading
  // "Where: N/A" is worse than one with the field absent.
  if (/^(unknown|n\/?a|none|null|undefined|-{1,2})$/i.test(trimmed)) return undefined
  return trimmed
}

/**
 * A four-digit year, from a number or a string containing one.
 *
 * Models return `2021`, `"2021"` and `"2021–2024"` for this field whatever the
 * prompt says. The first year in a range is the right one to keep: it is when
 * the thing started, which is how CVs are ordered.
 */
function year(value: unknown): number | undefined {
  const found =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(/\b(19|20)\d{2}\b/.exec(value)?.[0] ?? NaN)
        : NaN
  return Number.isInteger(found) && found >= 1900 && found <= 2100 ? found : undefined
}

const maybe = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }

/**
 * The outermost JSON object in a reply, fence and prose tolerated.
 *
 * Small models wrap their answer in ```json, or explain what they are about to
 * return before returning it. Neither is worth a failed extraction.
 */
