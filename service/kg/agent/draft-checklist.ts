/**
 * Drafting an application's checklist from the posting. L3.5 agent.
 *
 * What this asks for is not what `read-requirements.ts` asks for, and the
 * difference is the whole feature: that reader wants what the job REQUIRES OF
 * A CANDIDATE, so it can be scored against a background. This one wants what
 * the person has to GO AND DO — order a transcript, ask three referees,
 * register on a portal, quote a requisition number — which is the part of a
 * posting nothing else in the app reads.
 *
 * ## The posting is cut at BOTH ends
 *
 * `read-requirements.ts` takes the first 12,000 characters, and is right to:
 * qualifications sit near the top. Application instructions do not. "Three
 * letters through Interfolio", "a diversity statement of no more than one
 * page", "quote requisition PR-4012" live under How to apply, at the bottom,
 * beneath the equal-opportunity paragraph — so a head-only cut of a long
 * university advertisement throws away the single most useful section for this
 * feature. `postingSlice` keeps both ends and says how much it left out, and
 * the prompt is told what the marker means so the tail is not read as
 * continuing the head.
 *
 * ## It only ever ADDS
 *
 * The list the person already has goes into the prompt, ticked items marked, so
 * the model is told not to repeat them. The reader drops anything that survives
 * that anyway, and the TOOL drops it again — because the reader is advice and
 * the tool is the rule. Nothing here can tick, reword or remove a step.
 *
 * ## A cut-off reply is not a failure
 *
 * Tailoring refuses one, because half a document is not a document. Half a
 * LIST is a shorter list of whole entries — `salvageJsonObject` only ever hands
 * back complete elements — so this keeps what arrived and raises a note. That
 * note travels on the job to whatever screen the person walked to.
 */

import { postingSlice } from '../core/checklist'
import { keyOf } from '../core/checklist'
import { salvageJsonObject } from '../core/json-reply'
import { DRAFT_CHECKLIST_ITEMS, MAX_CHECKLIST_TEXT } from '../core/model'
import type { ChatMessage } from '../core/model-server'

/** Head and tail of the posting the model is shown. See the header. */
export const CHECKLIST_HEAD = 10_000
export const CHECKLIST_TAIL = 4_000

export type ChecklistBrief = {
  org: string
  role: string
  /** The posting document's name and text. */
  postingName: string
  posting: string
  /** What the fit panel already read off it. Free — it is stored. */
  requirements: readonly string[]
  /** Where the person is weakest against it, when that has been measured. */
  guidance: readonly string[]
  /** Steps already on the list, with the ticked ones marked. */
  existing: readonly { text: string; done: boolean }[]
  /** Titles of documents, links and people already filed under this job. */
  filed: readonly string[]
  /** What is already on the calendar for it, so the list does not repeat it. */
  dated: readonly string[]
}

export type ChecklistRead =
  | {
      ok: true
      items: readonly string[]
      /** Prose, for a person. One note can stand for many entries, or for none. */
      skipped: readonly string[]
      /** How many entries were actually lost. NOT `skipped.length`. */
      dropped: number
      /** Doubts about a list that was still produced. Shown, never a refusal. */
      notes: readonly string[]
    }
  | { ok: false; reason: string }

const SYSTEM = [
  'You read a job posting and return JSON. Nothing else.',
  '',
  'Return exactly one JSON object, with no prose around it and no code fence:',
  '  {"items": [ … ]}',
  '',
  'Each entry is ONE thing the applicant must GO AND DO before they can send',
  'this application. Not what the job requires of them — what the application',
  'process requires of them.',
  '',
  'Entry keys:',
  '  text  the step, imperative and verb first, naming what the posting names:',
  '        "Request three reference letters through Interfolio",',
  '        "Order an official transcript from your PhD institution",',
  '        "Write a one-page diversity statement",',
  '        "Quote requisition PR-4012 on the cover letter".',
  '',
  'Prefer the steps that take the LONGEST to get, and put them first. A',
  'reference letter takes weeks and a transcript costs money and time; a',
  'covering letter is an evening. A list that leads with the slow things is',
  'the one worth having.',
  '',
  'Read the whole posting for these, and read the end of it especially. What a',
  'posting asks you to SEND is almost always under a heading like "How to',
  'apply", "Application instructions" or "To be considered", near the bottom,',
  'often after the equal-opportunity paragraph.',
  '',
  'What is NOT a step, and must be left out:',
  '  - anything already on the list you are shown, in any wording',
  '  - anything already on the calendar you are shown',
  '  - what the job involves once you have it',
  '  - what the employer offers, who they are, or their mission',
  '  - equal-opportunity, visa and right-to-work text',
  '  - advice on HOW to write something. Another part of this app does that.',
  '  - "Review your application", "Proofread everything", "Submit on time",',
  '    "Tailor your CV", "Research the department". Every posting implies',
  '    these and none of them tells the person anything.',
  '',
  `Return at most ${String(DRAFT_CHECKLIST_ITEMS)}, longest-lead-first. If the`,
  'posting asks for fewer things, return fewer. Do not pad the list.',
  '',
  'If the text is not a job posting — a search results page, a login wall, an',
  'error page — return {"notAPosting": true} and nothing else.',
].join('\n')

const bullet = (lines: readonly string[]): string => lines.map((l) => `  - ${l}`).join('\n')

export function checklistMessages(brief: ChecklistBrief): ChatMessage[] {
  const text = postingSlice(brief.posting, CHECKLIST_HEAD, CHECKLIST_TAIL)
  const cut = text !== brief.posting

  const sections: string[] = [`Job: ${brief.role} at ${brief.org}`, `Posting: ${brief.postingName}`]

  if (brief.existing.length > 0) {
    sections.push(
      '',
      'Already on the list — do not repeat any of these, in any wording:',
      bullet(brief.existing.map((i) => (i.done ? `${i.text} (done)` : i.text))),
    )
  }
  if (brief.dated.length > 0) {
    sections.push('', 'Already on the calendar for this job:', bullet(brief.dated))
  }
  if (brief.filed.length > 0) {
    sections.push('', 'Already filed under this job:', bullet(brief.filed))
  }
  if (brief.requirements.length > 0) {
    sections.push('', 'What it asks for, already read off the posting:', bullet(brief.requirements))
  }
  if (brief.guidance.length > 0) {
    sections.push('', 'Where this person is weakest against it:', bullet(brief.guidance))
  }
  if (cut) {
    sections.push(
      '',
      '(The posting below is long, so the middle is left out. The part after the',
      'marker is the END of the page — read it for the application instructions.)',
    )
  }
  sections.push('', 'Posting text:', text)

  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: sections.join('\n') },
  ]
}

/** A model answering "checklist" writes Markdown inside its JSON strings. */
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s*(?:\[[ xX]?\]\s*)?/

const KEYS = ['items', 'checklist', 'tasks', 'steps'] as const

/** The array, wherever the model put it. Descends one level into an object. */
function arrayIn(value: unknown): unknown[] | null {
  if (!isObject(value)) return null
  for (const key of KEYS) {
    const found = value[key]
    if (Array.isArray(found)) return found
    // `{"checklist": {"items": [...]}}` — Gemma's shape. `read-requirements.ts`
    // refused the whole read for this once; the content was right and only the
    // wrapping was wrong, which is not worth a model call.
    if (isObject(found)) {
      for (const inner of KEYS) {
        const nested = found[inner]
        if (Array.isArray(nested)) return nested
      }
    }
  }
  return null
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export function readChecklist(
  reply: string,
  existing: readonly { text: string }[],
  options: { cutOff?: boolean } = {},
): ChecklistRead {
  const { value, truncated } = salvageJsonObject(reply)
  if (value === null) {
    return {
      ok: false,
      reason: 'The model did not answer with JSON. Try again, or try a different model.',
    }
  }
  if (isObject(value) && value['notAPosting'] === true) {
    return {
      ok: false,
      reason:
        'That saved page does not read as a job posting, so there is nothing to draft a checklist from. Capture the posting itself and try again.',
    }
  }

  const raw = arrayIn(value)
  if (raw === null) {
    return { ok: false, reason: 'The model returned JSON without a list of steps.' }
  }

  const items: string[] = []
  const skipped: string[] = []
  const notes: string[] = []
  let dropped = 0
  const seen = new Set(existing.map((i) => keyOf(i.text)))

  for (const [index, entry] of raw.entries()) {
    if (items.length === DRAFT_CHECKLIST_ITEMS) {
      const rest = raw.length - index
      if (rest > 0) {
        dropped += rest
        skipped.push(
          `${String(rest)} more were past the limit of ${String(DRAFT_CHECKLIST_ITEMS)}`,
        )
      }
      break
    }

    const source = typeof entry === 'string' ? entry : isObject(entry) ? entry['text'] : undefined
    if (typeof source !== 'string') {
      skipped.push(`entry ${String(index + 1)}: no text`)
      dropped += 1
      continue
    }

    /*
     * The Markdown a model writes inside a JSON string. `- [x] …` is stripped
     * to its text and is NOT read as ticked: the model has no idea what this
     * person has done, and a later maintainer "fixing" that would hand the
     * agent the one thing it must never write.
     */
    const text = source.replace(LIST_MARKER, '').trim()
    if (text === '') {
      skipped.push(`entry ${String(index + 1)}: empty`)
      dropped += 1
      continue
    }
    if (text.length > MAX_CHECKLIST_TEXT) {
      skipped.push(
        `entry ${String(index + 1)}: ${String(text.length)} characters is a paragraph, not a step`,
      )
      dropped += 1
      continue
    }

    const key = keyOf(text)
    if (seen.has(key)) {
      // Two different sentences, because only the second tells the person
      // something about their own list.
      skipped.push(
        existing.some((i) => keyOf(i.text) === key)
          ? `“${text}” is already on your list`
          : `entry ${String(index + 1)}: the model said it twice`,
      )
      dropped += 1
      continue
    }
    seen.add(key)
    items.push(text)
  }

  if (items.length === 0) {
    return {
      ok: false,
      reason:
        skipped.length > 0
          ? `Nothing new came back for this posting. ${skipped[0] ?? ''}`
          : 'That posting does not state anything jojo can read as a step to take.',
    }
  }

  if (truncated || options.cutOff === true) {
    notes.push(
      'The model stopped mid-answer, so this may be a shorter list than it meant to write. Draft more to pick up the rest.',
    )
  }
  if (dropped > 0) {
    notes.push(
      `${String(dropped)} ${dropped === 1 ? 'suggestion was' : 'suggestions were'} left out — ${skipped[0] ?? 'unusable'}.`,
    )
  }

  return { ok: true, items, skipped, dropped, notes }
}
