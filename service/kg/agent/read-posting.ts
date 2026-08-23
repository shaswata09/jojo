/**
 * L3.5 — a job posting, read by a model into the fields of an application.
 *
 * `core/parse-posting.ts` already turns a URL into a guess, and that guess is
 * genuinely good: a Greenhouse link carries the employer in its path and the
 * role in its last segment, and `draftFromUrl` reads both without a network
 * call or a model. What it cannot do is read the POSTING — the deadline, the
 * location, the salary band, whether "Assistant Professor" or "Lecturer" is the
 * right tag — because none of that is in the URL. This is the other half: given
 * the page as text, fill in what the URL could never carry.
 *
 * WHY THE MODEL IS ASKED FOR JSON AND NOT FOR TOOL CALLS. The agent loop exists
 * and could do this: hand it `application.create` and let it call it. That would
 * be worse in the one way that matters here. A posting is read to PREFILL a
 * form the user then checks — `AddByUrl` has always worked that way, on the
 * argument that an employer read out of a hostname is wrong often enough that a
 * silent save files records under names nobody chose, and a model reading a page
 * is wronger, not righter. So this returns a draft and writes nothing, and the
 * dialog it feeds is the same dialog every other route to a new application
 * opens.
 *
 * WHAT IT REFUSES TO GUESS. Every field is optional and an absent one is left
 * absent rather than filled with a plausible default. `stage` is never set — a
 * posting cannot know whether you have applied — and `roleTag` is only accepted
 * when it matches one of `ROLES` exactly, because the form's segmented control
 * has no room for a sixth value and a near-miss would silently drop anyway.
 *
 * The model may also answer that the page is not a job posting at all, which is
 * the case that matters most: JS-only boards return "You need to enable
 * JavaScript to run this app" and a 403 returns an error page, and both are
 * pages that a model asked to extract an employer will happily invent one from.
 */

import { ROLES, SOURCES } from '../core/model'
import type { Application, RoleTag, Source } from '../core/model'
import type { ChatMessage } from '../core/model-server'

/**
 * What a posting can contribute to a new application.
 *
 * Its own type rather than `Partial<Application>` for one reason: `deadline` is
 * not a field on an application at all. It is a timeline item `ABOUT` one, and
 * the create form takes it as a convenience that `application.create` turns
 * into that item. So the shape the form accepts and the shape the record has
 * differ by exactly this key, and naming that here keeps the service from
 * having to know anything about the form.
 */
export type PostingDraft = Partial<
  Pick<Application, 'org' | 'role' | 'roleTag' | 'location' | 'comp' | 'source' | 'url'>
> & { deadline?: string }

/**
 * How much of the page the model is shown.
 *
 * Postings run long — a university ad with an EEO statement and a benefits
 * appendix is routinely 40k characters, and the facts wanted here are almost
 * always in the first few thousand. Measured against the Greenhouse board this
 * was built on: 8k characters for a whole listing page. 12k leaves room for the
 * long ones without spending a 32k context on boilerplate nobody reads.
 */
export const POSTING_BUDGET = 12_000

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
}

/**
 * The saved posting, as a document the app's own viewers can render.
 *
 * The reader hands back markdown, and the record it becomes is `kind: 'page'` —
 * which is honest, because it IS a saved web page, and it is what earns the
 * "open the original" affordance that keys off `sourceUrl`. But both viewers
 * put a page in a frame and render it as HTML: web in an `iframe srcdoc`,
 * mobile in a WebView. Handed bare markdown, HTML collapses every newline and
 * the whole posting arrives as one unbroken paragraph — a file the app saved,
 * offered to read, and then rendered unreadably.
 *
 * So it is wrapped. Deliberately the smallest wrapper that fixes that: a
 * `<pre>` that wraps, a readable measure, and nothing else. No stylesheet, no
 * markdown rendering, no script — a captured posting is opened with scripts off
 * and no connection, and this one must be able to make the same promise.
 *
 * Shared rather than written twice because the two platforms would otherwise
 * each escape HTML their own way, and one of them would get it wrong.
 */
export function postingDocument(url: string, markdown: string): string {
  const escape = (text: string) => text.replace(/[&<>]/g, (ch) => ESCAPES[ch] ?? ch)
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8">',
    `<title>${escape(url)}</title>`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '</head><body>',
    '<pre style="white-space:pre-wrap;word-wrap:break-word;font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;max-width:44rem;margin:1.5rem auto;padding:0 1rem">',
    escape(markdown),
    '</pre></body></html>',
  ].join('\n')
}

/** What the model is asked to produce, and nothing else. */
const FIELDS = ['org', 'role', 'roleTag', 'location', 'comp', 'deadline', 'source'] as const

export type PostingRead =
  | {
      ok: true
      draft: PostingDraft
      /**
       * Fields the model was asked for and did not find.
       *
       * Reported rather than hidden so the dialog can say "the deadline was not
       * on the page" instead of leaving a blank the user has to notice.
       */
      missing: readonly string[]
    }
  | { ok: false; reason: string }

const SYSTEM = [
  'You read job postings and return JSON. Nothing else.',
  '',
  'Return exactly one JSON object, with no prose around it and no code fence.',
  'Every key is optional. OMIT a key you cannot find in the text — never guess,',
  'never write "unknown", "N/A" or an empty string.',
  '',
  'Keys:',
  '  org      the employer, as they write it. "Rice University", not "rice".',
  '  role     the position title, as posted.',
  `  roleTag  EXACTLY one of: ${ROLES.join(', ')}. Omit if none fits.`,
  '  location city and region, or "Remote".',
  '  comp     the salary or band, as written. Omit if the posting gives none.',
  '  deadline the application deadline as YYYY-MM-DD. Omit unless the posting',
  '           states one. A posting date is NOT a deadline.',
  `  source   one of: ${SOURCES.join(', ')}.`,
  '',
  'If the text is not a job posting — an error page, a login wall, or a page',
  'that says JavaScript is required — return {"notAPosting": true} instead.',
].join('\n')

/** The two messages, ready for `agentTurn`. The caller owns the transport. */
export function postingMessages(url: string, markdown: string): ChatMessage[] {
  const text = markdown.length > POSTING_BUDGET ? markdown.slice(0, POSTING_BUDGET) : markdown
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: [`Posting URL: ${url}`, '', 'Page text:', text].join('\n'),
    },
  ]
}

/**
 * The first JSON object in a reply, however the model wrapped it.
 *
 * Models fence JSON, prefix it with "Here is the JSON:", or both, whatever the
 * prompt says — so the brace scan is the parser and the instruction is only a
 * hint. Scanning for the outermost balanced braces rather than the first `{`
 * because a fenced block often contains prose above it that itself has a brace.
 */
function firstObject(text: string): unknown {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (ch === '"') inString = !inString
    if (inString) continue
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as unknown
        } catch {
          return null
        }
      }
    }
  }
  return null
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** A string field, trimmed, or undefined for anything that is not real text. */
function textOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  // The three the prompt forbids, which models write anyway. Compared folded
  // because "N/A", "n/a" and "N/a" are all of them.
  const folded = trimmed.toLowerCase()
  if (folded === 'unknown' || folded === 'n/a' || folded === 'none') return undefined
  return trimmed
}

/**
 * Turns a model's reply into a draft, or says why it could not.
 *
 * Never throws and never trusts: every field is checked against the same values
 * the form's own controls offer, so a hallucinated role tag or a deadline
 * written as "rolling" is dropped rather than carried into a record.
 */
export function readPosting(reply: string): PostingRead {
  const parsed = firstObject(reply)
  if (parsed === null || typeof parsed !== 'object') {
    return { ok: false, reason: 'The model did not answer with JSON.' }
  }

  const raw = parsed as Record<string, unknown>
  if (raw.notAPosting === true) {
    return {
      ok: false,
      reason:
        'That page does not read as a job posting. Some boards send an empty shell to anything but a browser — save the page with the extension instead, or fill the form in by hand.',
    }
  }

  const draft: PostingDraft = {}

  const org = textOf(raw.org)
  if (org !== undefined) draft.org = org

  const role = textOf(raw.role)
  if (role !== undefined) draft.role = role

  // Exact match only. A model that answers 'Assistant professor' or 'Professor'
  // is offering something the segmented control cannot show, and a silent
  // near-miss is worse than an empty field the user picks from.
  const roleTag = textOf(raw.roleTag)
  if (roleTag !== undefined && (ROLES as readonly string[]).includes(roleTag)) {
    draft.roleTag = roleTag as RoleTag
  }

  const location = textOf(raw.location)
  if (location !== undefined) draft.location = location

  const comp = textOf(raw.comp)
  if (comp !== undefined) draft.comp = comp

  // The form's date input takes ISO and nothing else, so 'rolling', 'open until
  // filled' and '15 November' are all dropped here rather than rejected later.
  const deadline = textOf(raw.deadline)
  if (deadline !== undefined && ISO_DATE.test(deadline)) draft.deadline = deadline

  const source = textOf(raw.source)
  if (source !== undefined && (SOURCES as readonly string[]).includes(source)) {
    draft.source = source as Source
  }

  if (draft.org === undefined && draft.role === undefined) {
    return {
      ok: false,
      reason: 'The model read the page but found neither an employer nor a role in it.',
    }
  }

  const missing = FIELDS.filter((field) => draft[field] === undefined)
  return { ok: true, draft, missing }
}
