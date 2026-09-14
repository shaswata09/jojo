/**
 * Tailoring one of the person's own documents for one posting. L2 agent.
 *
 * The prompt and the reader for the tailoring card — what is sent to the
 * model, and what is made of what comes back. Nothing here reads a document,
 * talks to a server or writes a record; `react/use-tailor.ts` does those, and
 * the live harness in `test/live-tailor.test.ts` drives this end to end
 * against real models.
 *
 * ## The one rule that matters
 *
 * The model may not invent. A tailored CV that gains a paper the person never
 * wrote, or a cover letter that claims five years of something they did for
 * one, is worse than no tailoring at all — it is a document they might send.
 * So the prompt hands over exactly two sources of fact, the document itself and
 * the background the graph already holds, and says in as many words that
 * nothing else may appear. Everything that IS changed is marked, so the person
 * reads the changes and not the whole page.
 *
 * ## Whole or sections
 *
 * A cover letter is a page; a CV is six. The local box streams at about
 * fourteen tokens a second, so a full rewrite of a long CV would take most of
 * ten minutes and arrive as one enormous reply — and models asked to echo six
 * pages drop things from the middle. Past `WHOLE_LIMIT` the prompt asks for the
 * sections that changed, each under its own heading, and a closing line naming
 * the ones left alone. The person pastes sections into their own document,
 * which is what they were going to do anyway.
 */

import { DOCUMENT_LABEL } from '../core/document-kind'
import { hasMarks, stripMarks } from '../core/marks'
import type { Requirement } from '../core/assess'
import type { ProfileDocument } from '../core/model'
import type { ChatMessage } from '../core/model-server'
import type { Guidance } from '../core/tailor'

/** Characters of the base document sent. A CV keeps its publications last, so the cut is announced. */
export const TAILOR_BASE_BUDGET = 24_000

/** Characters of the posting sent. Requirements are sent separately, so this is for tone and specifics. */
export const TAILOR_POSTING_BUDGET = 8_000

/** Below this many characters the whole document comes back; above, the changed sections. */
export const WHOLE_LIMIT = 7_000

export type TailorMode = 'whole' | 'sections'

export const modeFor = (baseChars: number): TailorMode =>
  baseChars <= WHOLE_LIMIT ? 'whole' : 'sections'

/**
 * Below this the reply is not a document. Per mode: a whole document under
 * two hundred characters is a refusal wearing a document's clothes, but a
 * sections reply can honestly be one rewritten summary paragraph.
 */
export const TOO_SHORT: Readonly<Record<TailorMode, number>> = { whole: 200, sections: 60 }

export type TailorBrief = {
  readonly kind: ProfileDocument
  readonly org: string
  readonly role: string
  /** The posting document's name, for the model's reference line. */
  readonly postingName: string
  /** The posting's text, as the reader returned it. */
  readonly posting: string
  /** What it asks for, as already read and stored on the posting. */
  readonly requirements: readonly Requirement[]
  /** The fit verdict, when the background allowed one. */
  readonly guidance: Guidance | null
  readonly baseName: string
  /** The document's text, as the reader returned it. */
  readonly base: string
}

/** What the model stopped on when it ran out of room. `loop.ts` says it the same way. */
export const CUT_OFF =
  'The model stopped mid-document because it hit its own output limit. Try a shorter document, or a larger reply limit on the server.'

const SYSTEM = [
  'You tailor ONE of a person’s own application documents for ONE job posting.',
  'Return the tailored text and nothing else: no preamble, no commentary, no code fence, no JSON.',
  '',
  'Rules, in order of importance:',
  '1. Use only facts from the document and the background list you are given. Never invent a',
  '   qualification, a paper, a project, a number, a date or a name. If the posting asks for',
  '   something the person does not have, do not claim it — reorder and reword what is true so',
  '   the relevant things come first.',
  '2. Keep the person’s voice, tense and formatting. Keep every passage you did not change',
  '   EXACTLY as written, character for character.',
  '3. Mark what you changed, with exactly these four spellings and no others. The marks wrap',
  '   the changed words themselves — never write a mark on its own or around a placeholder:',
  '   **…**  double asterisks around a passage you added or rewrote for this posting',
  '   _…_    single underscores around a passage you reworded or softened',
  '   __…__  double underscores around a passage you moved up or gave more weight (keep its words)',
  '   ## Heading  a section heading, using the document’s own heading names',
  '   No other markup: no HTML, no tables, no bullets the document did not have.',
  '4. Tailor to THIS posting: its language, its priorities, the department or team it names.',
  '   Do not address it to anyone by name unless the document already does.',
].join('\n')

const BY_KIND: Readonly<Record<ProfileDocument, string>> = {
  cv: [
    'For a CV: rewrite the summary or profile paragraph if there is one; under each entry, put the',
    'bullets that match the posting first; tighten wording toward the posting’s own terms. Do not',
    'drop entries, and do not shorten the publications list.',
  ].join(' '),
  'research-statement': [
    'For a research statement: open with the thread of the person’s work that this department',
    'or team would care about most; keep the argument and the evidence; do not pad.',
  ].join(' '),
  'teaching-statement': [
    'For a teaching statement: lead with the courses and approaches closest to what the posting',
    'asks for; keep every real example; do not add courses the person has not taught.',
  ].join(' '),
  'cover-letter': [
    'For a cover letter: address this employer and this role; open with the strongest match;',
    'keep it to about one page; keep any greeting and sign-off the letter already has.',
  ].join(' '),
  other: 'Tailor it toward the posting while keeping its purpose and every factual claim intact.',
}

const MODE_TEXT: Readonly<Record<TailorMode, string>> = {
  whole: 'Return the ENTIRE document, with your changes marked.',
  sections: [
    'The document is long. Return ONLY the sections you changed, each under its heading spelled',
    'exactly as the document spells it (## Heading), in the document’s order. End with one line',
    'that reads "Unchanged:" followed by the headings you left as they were.',
  ].join(' '),
}

/**
 * The document as plain text, before it goes to the model.
 *
 * A DOCX or PDF read through MarkItDown arrives AS MARKDOWN: its own bold is
 * `**bold**`, its bullets are `* `, its italics `_so_`. The prompt tells the
 * model to keep unchanged passages character for character, so those would
 * come straight back and be read by `core/marks.ts` as changes the model made.
 * Flattening the source's emphasis first means every mark in the reply is the
 * model's own. Bullets become `- `, which the parser never touches.
 */
export function plainSource(markdown: string): string {
  return markdown
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/(^|[^\p{L}\p{N}*])\*([^*\n]+)\*(?![\p{L}\p{N}*])/gu, '$1$2')
    .replace(/(^|[^\p{L}\p{N}_])_([^_\n]+)_(?![\p{L}\p{N}_])/gu, '$1$2')
    .replace(/^(\s*)[*+]\s+/gm, '$1- ')
}

const cut = (text: string, budget: number, what: string): string =>
  text.length <= budget
    ? text
    : `${text.slice(0, budget)}\n\n[${what} continues for ${String(text.length - budget)} more characters; not shown]`

function fitLines(guidance: Guidance | null): string[] {
  if (guidance === null) return ['(no background recorded, so no fit was measured)']
  const lines: string[] = []
  if (guidance.tailor.length > 0) {
    lines.push('Lead with:')
    for (const note of guidance.tailor) {
      lines.push(
        `- ${note.evidence.title}${note.evidence.where === undefined ? '' : ` (${note.evidence.where})`} — answers “${note.answers}”`,
      )
    }
  }
  if (guidance.prepare.length > 0) {
    lines.push('Gaps the posting will ask about (do NOT claim these; reorder around them):')
    for (const note of guidance.prepare) {
      lines.push(`- ${note.requirement}${note.essential ? ' (required)' : ''}`)
    }
  }
  return lines.length === 0 ? [`Verdict: ${guidance.summary}`] : lines
}

export function tailorMessages(brief: TailorBrief): ChatMessage[] {
  const base = plainSource(brief.base)
  const posting = plainSource(brief.posting)
  const mode = modeFor(brief.base.length)
  const label = DOCUMENT_LABEL[brief.kind]
  const asks =
    brief.requirements.length === 0
      ? ['(nothing was extracted from the posting; read the posting text below)']
      : brief.requirements.map((r) => `- [${r.essential ? 'required' : 'preferred'}] ${r.text}`)

  const user = [
    `Posting: ${brief.role} at ${brief.org} (${brief.postingName})`,
    '',
    'What it asks for:',
    ...asks,
    '',
    'How the person fits, computed from their record:',
    ...fitLines(brief.guidance),
    '',
    `--- posting text ---`,
    cut(posting, TAILOR_POSTING_BUDGET, 'The posting'),
    '',
    `--- the ${label} to tailor: ${brief.baseName} ---`,
    cut(base, TAILOR_BASE_BUDGET, 'The document'),
    '',
    BY_KIND[brief.kind],
    MODE_TEXT[mode],
  ].join('\n')

  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user },
  ]
}

export type TailoredRead =
  | {
      ok: true
      body: string
      /** Whether anything in it is marked. False is worth saying out loud. */
      marked: boolean
      /** Doubts worth showing beside the result. Never a reason to refuse it. */
      notes: readonly string[]
    }
  | { ok: false; reason: string }

/** A fence around the whole thing, closed or — a cut-off model — not. */
const FENCE = /^```[a-z]*\s*\n([\s\S]*?)(?:\n```\s*)?$/i
/**
 * "Here is your tailored CV:" — one line, ending in a colon or followed by a
 * blank line. The blank line used to be required, and a model that wrote the
 * sentence and went straight into the document kept its sentence.
 */
const PREAMBLE =
  /^(here('s| is| are)|below is|sure|certainly|of course|okay|ok)\b[^\n]*(:\s*\n|\n\s*\n)/i
/**
 * A mark wrapped around nothing but the prompt's own placeholder.
 *
 * Qwen3 14B, asked for `**text**` in an earlier wording of rule 3, wrote
 * `**text**` — the literal word — in front of the passages it changed, which
 * the parser read as three real changes each saying "text". Rule 3 no longer
 * shows a copyable word, and this strips the echo if one comes back anyway,
 * so a degenerate mark is neither shown as a change nor counted as one.
 *
 * ANCHORED TO THE START OF A LINE, which is the shape the echo actually has —
 * a marker standing in front of a passage. Unanchored, this matched anywhere
 * and deleted the words themselves: a researcher's `Builds **text** retrieval
 * systems for low-resource languages` lost `**text**` outright, so the saved
 * snippet read "Builds retrieval systems" and the loss was invisible, because
 * the document it is compared against is the model's reply and not the source.
 * `**words**`, `**word**` and `_passage_` are all real things to write in a CV.
 *
 * PAST A LIST MARKER, because a CV's changed unit is a bullet and `plainSource`
 * rewrites every bullet to `- `. Anchored at column zero alone, the echo went
 * straight through on every line that mattered — and a surviving echo is worse
 * than a cosmetic mark, because `hasMarks` then reads the reply as tailored and
 * the unchanged-document guard below never fires. The marker is CAPTURED and
 * put back, so stripping an echo does not also flatten the list.
 *
 * The bullet has to be followed by whitespace, or `[-*+]?` would eat the first
 * star of a `**text**` that has no bullet at all and strand the second.
 *
 * The inner gaps are spaces and tabs rather than `\s`, so a stripped echo
 * cannot swallow the newline after it and weld two lines together.
 */
const PLACEHOLDER =
  /^([ \t]*(?:(?:[-*+]|\d+[.)])[ \t]+)?)(\*\*|__|_|\*)[ \t]*(?:text|…|\.\.\.|passage|words?)[ \t]*\2[ \t]*/gim

/** Not a document at all: the model declined, or explained itself instead. */
const REFUSAL =
  /^(i('m| am) (sorry|unable|afraid)|i can(no|')t|as an ai|i (do not|don't) have (access|enough)|unfortunately)/i

/**
 * What the reply is worth keeping as.
 *
 * Lenient about the wrapping and strict about the substance: a fence or a
 * "Here is your tailored CV:" line is stripped, an empty or tiny reply is
 * refused, and everything in between is kept WITH notes rather than rejected.
 * A tailored document with nothing marked is still the person's document; the
 * card says the marks are missing, and they decide.
 */
export function readTailored(reply: string, brief: TailorBrief): TailoredRead {
  /*
   * Preamble, then fence, then preamble again: "Here is your CV:" followed by
   * a fenced document is the commonest wrapping, and a fence anchored at the
   * start of the text cannot see past the sentence in front of it.
   */
  let text = reply.trim().replace(PREAMBLE, '').trim()
  const fenced = FENCE.exec(text)
  if (fenced) text = (fenced[1] ?? '').trim()
  text = text.replace(PREAMBLE, '').replace(PLACEHOLDER, '$1').trim()

  if (text.length < TOO_SHORT[modeFor(brief.base.length)]) {
    return {
      ok: false,
      reason: 'The model answered with almost nothing. Try again, or try a different model.',
    }
  }
  if (REFUSAL.test(text)) {
    return {
      ok: false,
      reason: `The model declined rather than tailoring: “${text.slice(0, 120).replace(/\s+/g, ' ')}…”`,
    }
  }

  const mode = modeFor(brief.base.length)
  const notes: string[] = []
  const marked = hasMarks(text)

  /*
   * The document handed back as it was is not a tailored document, and it
   * must not be saved as one. Measured on Qwen3 14B: a third of its replies
   * were the source byte for byte, or the source followed by the source again,
   * and a card listing "CV — Rice University · gemma" over the person's own
   * unchanged CV is worse than an error — it looks done. Nothing marked AND the
   * source sitting whole at the front of the reply is that case exactly; a
   * genuine rewrite with the marks forgotten still differs somewhere and is
   * kept with the note below.
   */
  if (!marked) {
    const flat = (t: string) => t.replace(/\s+/g, ' ').trim()
    // Both sides through the same two flatteners: the source's own Markdown
    // goes (as it did before it was sent), and its headings lose their hashes
    // exactly as the reply's do.
    const source = flat(stripMarks(plainSource(brief.base)))
    if (source.length > 0 && flat(stripMarks(text)).startsWith(source)) {
      return {
        ok: false,
        reason:
          'The model returned the document unchanged rather than tailoring it. Try again, or try a different model.',
      }
    }
  }
  if (!marked) {
    notes.push(
      'Nothing in it is marked as changed — the model may have returned the document as it was, or left the marks out.',
    )
  }
  if (mode === 'whole' && stripMarks(text).length < brief.base.length * 0.4) {
    notes.push(
      'The tailored version is much shorter than the original. Check that nothing was dropped.',
    )
  }
  if (mode === 'sections' && !/^##\s+\S/m.test(text)) {
    notes.push(
      'No section headings came back, so it is not clear which parts of the document these replace.',
    )
  }
  return { ok: true, body: text, marked, notes }
}
