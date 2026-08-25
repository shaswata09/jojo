/**
 * Turning a CV into facts the graph can hold. L3.
 *
 * The sibling of `read-posting.ts`, pointed the other way. That one reads the
 * employer's side of a match and produces an application draft; this one reads
 * the person's side and produces the things a hiring committee would actually
 * weigh — where they studied, what they have held, what they have published,
 * what they can teach.
 *
 * ## Why this exists
 *
 * A CV could be uploaded and read — `vault.file.read` has converted documents
 * to text for a while — and nothing ever looked at what came back. The profile
 * was ten fields somebody typed, `fitOf` scored postings against those, and a
 * person who had uploaded forty pages of evidence got exactly the same answer
 * as a person who had uploaded nothing. The document was in the app and not in
 * the graph.
 *
 * ## The prompt is written to make omission easy
 *
 * Every instruction that matters here is a permission to leave something out.
 * A model asked to extract from a CV will, unprompted, fill in a plausible
 * university, invent a date range from context, or promote "familiar with
 * Rust" into a skill entry that reads like expertise. Each of those is a claim
 * about a real person that they never made, sitting in their own records, and
 * shown to them as though they wrote it.
 *
 * So: omit rather than guess, copy rather than paraphrase, and one entry per
 * line of the document rather than per inference.
 *
 * ## Why the reply is JSON and parsed defensively
 *
 * Same reason as the posting reader: a small local model writes prose around
 * its JSON, fences it, or trails a comma. The parser strips a fence, finds the
 * outermost object, and refuses cleanly rather than throwing — because the
 * caller's next move is to tell the user their CV could not be read, not to
 * crash the screen they uploaded it from.
 */

import { BACKGROUND_KINDS } from '../core/model'
import type { BackgroundKind } from '../core/model'
import type { ChatMessage } from '../core/model-server'

/**
 * How much of a document is sent.
 *
 * A CV is a few pages; an academic one can be forty. The tail of a long CV is
 * usually the publication list, which is exactly the part worth having — so
 * this is generous where `POSTING_BUDGET` is not, and the truncation notice
 * below tells the model it is reading a fragment rather than letting it
 * conclude the person has no publications.
 */
export const CV_BUDGET = 24_000

/** One extracted fact, before it has been checked or filed. */
export type BackgroundDraft = {
  kind: BackgroundKind
  title: string
  where?: string
  period?: string
  year?: number
  detail?: string
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

const SYSTEM = [
  'You read a CV or résumé and return JSON. Nothing else.',
  '',
  'Return exactly one JSON object, with no prose around it and no code fence:',
  '  {"background": [ … ]}',
  '',
  'Each entry describes ONE fact stated in the document. Copy what is written.',
  'Do not summarise, do not combine two entries into one, and do not infer a',
  'fact the document does not state.',
  'Omit any key you cannot find. Never guess, and never write "unknown",',
  '"N/A" or an empty string.',
  '',
  'Entry keys:',
  `  kind    EXACTLY one of: ${BACKGROUND_KINDS.join(', ')}.`,
  '  title   the degree, job title, paper title, skill, or course name.',
  '  where   the university, employer, journal or conference. Omit if absent.',
  '  period  the dates AS WRITTEN: "2021–2024", "Summer 2019", "since 2024".',
  '          Do not convert to a format the document does not use.',
  '  year    a single four-digit year for ordering, if one is clear. Omit if not.',
  '  detail  anything else on that line worth keeping — a venue, a grade, a',
  '          co-author list, a short description. Omit rather than pad.',
  '',
  'What counts as which kind:',
  '  education    a degree, diploma or certification the person received.',
  '  employment   a post held. Include internships and postdocs.',
  '  publication  a paper, book, chapter or patent.',
  '  skill        a named competence: a language, a tool, a method.',
  '  teaching     a course taught, a supervision, a teaching role.',
  '  award        a prize, grant, fellowship or scholarship.',
  '  service      reviewing, committee work, editorial roles, organising.',
  '',
  'A long skills line — "Python, Rust, Go, Kubernetes" — is FOUR skill entries,',
  'one per name. Do not file it as one entry containing a list.',
  '',
  'If the text is not a CV — a cover letter, a job posting, an error page —',
  'return {"notACv": true} instead.',
].join('\n')

/** The two messages, ready for `agentTurn`. The caller owns the transport. */
export function cvMessages(name: string, markdown: string): ChatMessage[] {
  const long = markdown.length > CV_BUDGET
  const text = long ? markdown.slice(0, CV_BUDGET) : markdown
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: [
        `Document: ${name}`,
        // Said out loud, because a model handed a truncated CV otherwise
        // concludes the person simply has no publications — the list is almost
        // always what falls off the end.
        long ? '(This is the first part of a longer document.)' : '',
        '',
        'Text:',
        text,
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ]
}

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
  const payload = parseObject(reply)
  if (payload === null) {
    return { ok: false, reason: 'The model did not return JSON.' }
  }
  if ((payload as { notACv?: unknown }).notACv === true) {
    return { ok: false, reason: 'That document does not read as a CV.' }
  }

  const raw = (payload as { background?: unknown }).background
  if (!Array.isArray(raw)) {
    return { ok: false, reason: 'The model returned JSON without a background list.' }
  }

  const background: BackgroundDraft[] = []
  const skipped: string[] = []

  for (const [index, entry] of raw.entries()) {
    if (typeof entry !== 'object' || entry === null) {
      skipped.push(`entry ${String(index + 1)}: not an object`)
      continue
    }
    const row = entry as Record<string, unknown>

    const kind = row['kind']
    if (typeof kind !== 'string' || !(BACKGROUND_KINDS as readonly string[]).includes(kind)) {
      skipped.push(`entry ${String(index + 1)}: kind "${String(kind)}" is not one jojo knows`)
      continue
    }

    const title = text(row['title'])
    if (title === undefined) {
      skipped.push(`entry ${String(index + 1)}: no title`)
      continue
    }

    background.push({
      kind: kind as BackgroundKind,
      title,
      ...maybe('where', text(row['where'])),
      ...maybe('period', text(row['period'])),
      ...maybe('year', year(row['year'])),
      ...maybe('detail', text(row['detail'])),
    })
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
function parseObject(reply: string): unknown {
  const withoutFence = reply.replace(/```(?:json)?/gi, '')
  const start = withoutFence.indexOf('{')
  const end = withoutFence.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(withoutFence.slice(start, end + 1)) as unknown
  } catch {
    return null
  }
}
