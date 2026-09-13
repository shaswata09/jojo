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
import { foldName } from '../core/ref'
import type { Application, RoleTag, Source } from '../core/model'
import { firstJsonObject } from '../core/json-reply'
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
  Pick<
    Application,
    'org' | 'role' | 'roleTag' | 'location' | 'comp' | 'source' | 'url' | 'postingId'
  >
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

/**
 * One of the person's own keywords, as the prompt and the matcher both see it.
 *
 * `used` is how many records already carry it. It decides nothing about a
 * posting — it only orders the list when there are more keywords than fit in a
 * prompt, on the reasoning that a vocabulary has a long tail and the words
 * somebody actually files things under are the ones worth showing a model.
 * Counted by the caller: this layer reads no graph (D26).
 */
export type KeywordOffer = { readonly id: string; readonly name: string; readonly used: number }

/**
 * How many keywords are named in the prompt.
 *
 * The store ships six (`service/data/labels.ts`) and the benchmark world holds
 * four, so this cuts nothing for an ordinary user — it exists for the person
 * who has been filing for a year. Twenty names at the schema's 40-character
 * limit is about 1.5k characters once the block's own instructions and the
 * '- ' on every line are counted — an eighth of the 12k page budget, and
 * affordable on the 7B hardware this feature is for. Sixty would not be.
 */
export const MAX_KEYWORDS_OFFERED = 20

/**
 * How many keywords one posting may come back tagged with.
 *
 * Three, from the data rather than from taste: no record in the seeded store
 * carries more than TWO keywords, and the whole shipped vocabulary is six. A
 * model that says four of your six keywords apply has read the list, not the
 * page — see `matchKeywords`, which treats that as an echo and keeps none of
 * them rather than picking three of the six to tick.
 */
export const MAX_KEYWORDS_PICKED = 3

/**
 * The keywords worth putting in front of the model, most-used first.
 *
 * A stable sort, so keywords used equally often stay in the order the person
 * defined them — the order their own chips are drawn in. Sorting a copy
 * because the caller's array is React state.
 */
export function keywordRoster(keywords: readonly KeywordOffer[]): KeywordOffer[] {
  return [...keywords].sort((a, b) => b.used - a.used).slice(0, MAX_KEYWORDS_OFFERED)
}

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

/**
 * Elements whose content is never the posting, removed whole before any text is
 * read.
 *
 * The head and inlined stylesheets are most of a captured page's bytes; SVG is
 * path data; `nav` and `footer` are the site around the listing — and together
 * they are what pushes a long posting past `POSTING_BUDGET` before the model
 * has seen its requirements. `header` is deliberately NOT here: boards put the
 * title, the employer and the location in it, which are three of the fields
 * this read exists to fill. `select` goes because a country picker is two
 * hundred lines of options the model would otherwise read as the posting.
 */
const NOT_THE_POSTING = [
  'head',
  'style',
  'script',
  'noscript',
  'template',
  'svg',
  'nav',
  'footer',
  'select',
  'iframe',
] as const

/**
 * An attribute list, quote-aware. A `>` inside a quoted value is legal and the
 * HTML serialiser leaves it unescaped, so `[^>]*` would end the tag early and
 * spill the rest of the attribute into the text. The three alternatives start
 * with disjoint characters, so this cannot backtrack.
 */
const ATTRS = `(?:[^>"']|"[^"]*"|'[^']*')*`

/** Elements that end a line. `li` is handled on its own, to keep its bullet. */
const LINE_ENDS =
  'p|div|ul|ol|tr|table|h[1-6]|section|article|header|aside|main|blockquote|pre|dl|dt|dd|figure|figcaption|form|fieldset|hr|address|details|summary'

/**
 * How much text a `<main>` has to hold before it is read instead of the page.
 *
 * A board that marks its content with `<main>` is telling the truth about where
 * the posting is, and reading only that drops the "other jobs you might like"
 * rail that otherwise fills the budget. But an app shell's `<main>` can hold a
 * spinner while the listing renders elsewhere, and reading "Loading…" as the
 * posting would be worse than reading too much — so it has to be worth it.
 */
const MAIN_MIN = 400

/**
 * The entities a serialised page actually contains. Chrome's serialiser writes
 * text as UTF-8 and escapes only these, plus numeric references; the long tail
 * of named entities does not occur in what the extension hands back.
 */
const NAMED: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/** One pass, so `&amp;lt;` becomes `&lt;` and not `<`. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X'
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10)
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole
    }
    return NAMED[body.toLowerCase()] ?? whole
  })
}

/** Markup → lines of text: blocks end lines, list items keep a bullet. */
function flatten(html: string): string {
  const text = html
    .replace(new RegExp(`<br${ATTRS}>`, 'gi'), '\n')
    .replace(new RegExp(`<li\\b${ATTRS}>`, 'gi'), '\n- ')
    .replace(new RegExp(`</?(?:${LINE_ENDS})\\b${ATTRS}>`, 'gi'), '\n')
    .replace(/<\/t[dh]\s*>/gi, ' ')
    .replace(new RegExp(`<${ATTRS}>`, 'g'), '')
  return (
    decodeEntities(text)
      .replace(/\r/g, '')
      .replace(/[^\S\n]+/g, ' ')
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      // A list item whose content starts a block of its own leaves its bullet
      // on a line by itself; it belongs in front of the text that follows.
      .replace(/^-\n+(?=\S)/gm, '- ')
      .replace(/^-$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

/**
 * The readable text of a captured page, for the model to read.
 *
 * The extension hands back the RENDERED page — the whole serialised document,
 * assets inlined — and that is the reason to go through it: a board that renders
 * in JavaScript sends a server-side fetch a blank shell, where a tab that has
 * finished rendering holds the posting. So the text is recovered here, and
 * without a DOM: this layer runs on the phone too, and neither Hermes nor the
 * test runner has a `DOMParser` (D20). What it is not is an HTML parser, and it
 * does not need to be one — the input is a serialiser's output, which is
 * well-formed by construction, and the output is read by a model that forgives
 * a stray space and cannot forgive a missing requirement.
 */
export function postingTextFromHtml(html: string): string {
  let page = html.replace(/<!--[\s\S]*?-->/g, '')
  for (const tag of NOT_THE_POSTING) {
    page = page.replace(new RegExp(`<${tag}\\b${ATTRS}>[\\s\\S]*?</${tag}\\s*>`, 'gi'), ' ')
  }
  const main = /<main\b[^>]*>([\s\S]*)<\/main\s*>/i.exec(page)?.[1]
  if (main !== undefined) {
    const text = flatten(main)
    if (text.length >= MAIN_MIN) return text
  }
  return flatten(page)
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
      /**
       * The keywords the model picked, as IT spelled them — not ids, and not
       * checked against anything that exists.
       *
       * Named for what it holds. The thing that reaches a record is a keyword
       * ID, and `keyword.record.set` rejects the whole array if one entry is
       * not one — saving the application with none of its keywords — so a name
       * and an id sharing a field name is a bug waiting for a careless
       * assignment. `matchKeywords` is the only crossing between them.
       */
      keywordNames: readonly string[]
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
  '           states one. A posting date is NOT a deadline. When it gives a day',
  '           and month but no year, work the year out from today — a deadline',
  '           is ahead, so "20 September" in December means next year.',
  `  source   one of: ${SOURCES.join(', ')}.`,
  "  postingId the posting's own reference, when the page states one: a job",
  '           number, requisition ID, posting number or job code, copied',
  '           exactly ("R-2024-0312", "JobCode 179545452", "REQ12345"). Omit',
  '           if the page gives none. Never invent one.',
].join('\n')

/**
 * The escape hatch, split out so the keyword block can sit with the other keys.
 *
 * It has to come last. It is the only instruction that is about the page rather
 * than about a field, and a model that meets it in the middle of a key list
 * starts answering `notAPosting` for pages that are merely thin.
 */
const NOT_A_POSTING = [
  'If the text is not a job posting — an error page, a login wall, or a page',
  'that says JavaScript is required — return {"notAPosting": true} instead.',
].join('\n')

/**
 * The keyword key and the person's own vocabulary, or nothing at all.
 *
 * BUILT PER CALL, unlike everything above it, because the words belong to the
 * store rather than to the program — and with no keywords the composed prompt
 * is the one this file sent before keywords existed. What the test proves is
 * that shape rather than a stored copy of the old string: the two prompts share
 * a head and a whole tail, and differ only by an inserted block. Someone who has never made a keyword is not told about
 * a feature they have not got, and is not asked to pick from an empty list.
 *
 * ONE NAME PER LINE. A keyword is 1–40 characters of the user's own text and
 * nothing forbids a comma in it — 'Berlin, remote' is a legal name — so a
 * comma-joined roster reads as two names, and the model copies back half a
 * keyword that matches nothing.
 *
 * NAMES ONLY, never ids. An id is minted per store (`core/ref.ts`), so it is a
 * token the model can only copy by luck or invent by mistake, and it would
 * spend prompt on something the reply does not need to carry.
 */
function keywordLines(offered: readonly KeywordOffer[]): string[] {
  if (offered.length === 0) return []
  return [
    '  keywords an ARRAY of names, copied EXACTLY from the list below and from',
    '           nowhere else. Pick only the ones this job is plainly about — its',
    `           field, its stack, its kind of work. At most ${String(MAX_KEYWORDS_PICKED)}, and most`,
    '           postings match one.',
    '           OMIT the key when none of them fit. That is the common answer,',
    '           and a better one than a word that nearly fits.',
    '           Some keywords describe how someone is getting on rather than any',
    '           job — a keyword like "Waiting on them" is never what a posting',
    '           is about. Skip any of theirs that read like that.',
    '',
    'Their keywords, and the only names you may return:',
    // Whitespace collapsed, because a name is 1–40 characters of the user's own
    // text with no character class behind it: a newline in one would split it
    // across two lines and make one keyword read as two — the same failure the
    // comma above is about, arriving by a different route.
    ...offered.map((keyword) => `- ${keyword.name.replace(/\s+/g, ' ').trim()}`),
  ]
}

/** The two messages, ready for `agentTurn`. The caller owns the transport. */
/**
 * `today` is required, not optional, and that is deliberate.
 *
 * This asks for `deadline` as `YYYY-MM-DD`, and postings say "applications
 * close 20 September" far more often than they give a year. Without today's
 * date the model produces one from its weights — the same defect the agent loop
 * had, where a reminder for "the 20th" was filed sixteen months in the past.
 * Here it would be a real deadline on somebody's real application.
 *
 * A required parameter rather than a default, so that adding a second caller
 * cannot quietly reintroduce it. Taken from the host's clock, never read here:
 * this layer has none (D26).
 */
export function postingMessages(
  url: string,
  markdown: string,
  today: string,
  /**
   * The person's keywords, already cut to the roster by `keywordRoster`.
   *
   * Required, with no default. A default would mean "offer nothing", which is
   * indistinguishable from a caller that forgot — and the second app would then
   * go on shipping a prompt with no keywords in it, silently, past a green
   * build. Made required, the compiler names every caller that has to be
   * taught. The OFFERS are passed rather than their names so that this and
   * `matchKeywords` cannot be handed two different lists; only the names are
   * ever written into the prompt.
   */
  offered: readonly KeywordOffer[],
): ChatMessage[] {
  const text = markdown.length > POSTING_BUDGET ? markdown.slice(0, POSTING_BUDGET) : markdown
  const system = [SYSTEM, ...keywordLines(offered), '', NOT_A_POSTING].join('\n')
  return [
    { role: 'system', content: `${system} Today is ${today}.` },
    {
      role: 'user',
      content: [`Posting URL: ${url}`, '', 'Page text:', text].join('\n'),
    },
  ]
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
  const parsed = firstJsonObject(reply)
  if (parsed === null || typeof parsed !== 'object') {
    return { ok: false, reason: 'The model did not answer with JSON.' }
  }

  const raw = parsed as Record<string, unknown>
  if (raw['notAPosting'] === true) {
    return {
      ok: false,
      reason:
        'That page does not read as a job posting. Some boards send an empty shell to anything but a browser — save the page with the extension instead, or fill the form in by hand.',
    }
  }

  const draft: PostingDraft = {}

  const org = textOf(raw['org'])
  if (org !== undefined) draft.org = org

  const role = textOf(raw['role'])
  if (role !== undefined) draft.role = role

  // Exact match only. A model that answers 'Assistant professor' or 'Professor'
  // is offering something the segmented control cannot show, and a silent
  // near-miss is worse than an empty field the user picks from.
  const roleTag = textOf(raw['roleTag'])
  if (roleTag !== undefined && (ROLES as readonly string[]).includes(roleTag)) {
    draft.roleTag = roleTag as RoleTag
  }

  const location = textOf(raw['location'])
  if (location !== undefined) draft.location = location

  const comp = textOf(raw['comp'])
  if (comp !== undefined) draft.comp = comp

  // The form's date input takes ISO and nothing else, so 'rolling', 'open until
  // filled' and '15 November' are all dropped here rather than rejected later.
  const deadline = textOf(raw['deadline'])
  if (deadline !== undefined && ISO_DATE.test(deadline)) draft.deadline = deadline

  const source = textOf(raw['source'])
  if (source !== undefined && (SOURCES as readonly string[]).includes(source)) {
    draft.source = source as Source
  }

  /*
   * The posting's own reference, and the strongest identity a posting has:
   * two applications carrying the same requisition number are the same job
   * whatever the title or the address say. Bounded, because a model asked for
   * an ID sometimes copies a sentence — anything longer than a reference could
   * be is not one.
   */
  const postingId = textOf(raw['postingId'])
  if (postingId !== undefined && postingId.length <= 40 && /\d/.test(postingId)) {
    draft.postingId = postingId
  }

  if (draft.org === undefined && draft.role === undefined) {
    return {
      ok: false,
      reason: 'The model read the page but found neither an employer nor a role in it.',
    }
  }

  /*
   * Shape-cleaned here, matched nowhere near here.
   *
   * `textOf` throws out the same non-answers it throws out of every other field
   * — a number, a blank, 'N/A' — and the fold dedupes 'Research' against
   * '  research ', which a model asked for an array will produce. What this
   * deliberately does NOT do is check the names against the roster: that is the
   * same fold-and-compare that has to run again to produce ids, and one rule
   * written in two places is one rule that will disagree with itself. It runs
   * once, in `matchKeywords`, which is also the only place that knows what the
   * prompt offered.
   *
   * No cap here either. The cut that matters is against what exists, and a long
   * list of invented names must not crowd out the real ones below it — which is
   * exactly what a cap applied before matching would do.
   */
  const keywordNames: string[] = []
  const answered: unknown = raw['keywords']
  if (Array.isArray(answered)) {
    const seen = new Set<string>()
    for (const entry of answered) {
      const bulleted = textOf(entry)
      if (bulleted === undefined) continue
      // The roster is written '- Research' and the instruction beside it says
      // to copy the name EXACTLY, so a model that takes the instruction at its
      // word hands the bullet back with it. Stripped here rather than matched
      // around, because what came back is a name with a list marker on it, and
      // no keyword begins with one.
      const name = bulleted.replace(/^[-*•]\s+/, '').trim()
      if (name === '') continue
      const folded = foldName(name)
      if (seen.has(folded)) continue
      seen.add(folded)
      keywordNames.push(name)
    }
  }

  const missing = FIELDS.filter((field) => draft[field] === undefined)
  return { ok: true, draft, missing, keywordNames }
}

/**
 * The names the model picked, as the ids of keywords that actually exist.
 *
 * FILTERS THE OFFER RATHER THAN MAPPING THE ANSWER, which is what makes the
 * guarantees structural instead of careful: it cannot emit an id for a keyword
 * that is not there, cannot emit one twice, and returns them IN THE ORDER THEY
 * WERE OFFERED rather than the order a model happened to say them in. Offered
 * order is `keywordRoster`'s — most-used first — and not the order the person's
 * chips are drawn in, which is what this comment used to claim; the two agree
 * only when every count is equal.
 *
 * Folded with `foldName` — the store's own notion of one keyword — rather than
 * the exact match `roleTag` gets. A role tag is exact because the segmented
 * control compares by value and a near miss shows nothing selected; a keyword
 * has a real node behind it, and `keyword.create` has always treated 'UT
 * Austin' and 'ut austin' as the same word. `foldName` is that same rule, so a
 * name matched here names the keyword `keyword.create` would have returned.
 *
 * It is NOT the only fold in the repo: `twin.ts` compares keyword names with
 * `fold` from `core/text`, which also strips accents, so 'Café' and 'Cafe' are
 * one word there and two here. That disagreement is older than this function
 * and belongs to whichever of them is wrong — following `keyword.create` is
 * the defensible half, because it is what decides whether a second node gets
 * minted.
 *
 * A NAME THAT MATCHES NOTHING IS DROPPED AND NOTHING IS CREATED. Reading a
 * posting writes no records — the dialog this feeds says so in its own header —
 * and minting a keyword from a page the user has not even decided to apply to
 * would put words in their vocabulary that they never chose.
 *
 * MORE THAN `MAX_KEYWORDS_PICKED` MATCHES MEANS NONE, and the reason is not the
 * size of the answer but what exceeding it says. The prompt states the number;
 * a model that returns more has not applied the one countable instruction it
 * was given, so its selection is a list rather than a judgement and there is no
 * principled way to pick three of it. Keeping the first three would tick three
 * chips with the confidence of three considered ones.
 *
 * It bites hardest where it is most often right: against the six keywords the
 * app ships, four of which describe the person's own progress ('Read',
 * 'Referral', 'Negotiating', 'Waiting on them'), "four of these apply" tags the
 * job with where they are up to. It is worst for the rare person with twenty
 * keywords and four honest matches, who gets none and ticks them by hand —
 * which is what they did before this feature existed.
 *
 * And it cannot fire at all for someone with three keywords or fewer: `matched`
 * is bounded by the offer. That is the right way round. A whole vocabulary of
 * three is three chips to glance at, not a list being read back.
 */
export function matchKeywords(
  offered: readonly KeywordOffer[],
  names: readonly string[],
): string[] {
  if (names.length === 0) return []
  const wanted = new Set(names.map(foldName))
  const matched = offered.filter((keyword) => wanted.has(foldName(keyword.name)))
  if (matched.length > MAX_KEYWORDS_PICKED) return []
  return matched.map((keyword) => keyword.id)
}

/**
 * One more draw when the model's answer did not parse.
 *
 * ## Why the ask is worth repeating and the fetch is not
 *
 * These are three different failures wearing one word. A refused request, an
 * empty answer and an answer that is prose instead of JSON all end the run
 * here today — and only the last one is worth trying again. Sampling is why: a
 * small local model asked the same question twice does not give the same
 * answer, so a malformed draw is a coin that can be flipped again, where a
 * server that said no will say no just as fast the second time.
 *
 * It matters because of WHERE this sits. By the time the parse fails the page
 * has already been fetched through a reader, converted to markdown and held in
 * memory — the slow, fallible part is done. Losing all of that to one bad draw
 * means the person starts the whole thing over, and on a 7B model that is not a
 * rare event: this is the failure `flow.ts` was written about, one step in a
 * run returning something malformed while everything around it worked.
 *
 * ## Why one retry and not a policy
 *
 * A second draw is a coin flip; a third is waiting. Two attempts turn the
 * common case — a model that wrapped its JSON in an apology — into a success,
 * and anything that fails twice is a model that cannot do this task on this
 * page, which more attempts will not change. The person is better served by
 * the message than by the wait.
 *
 * `attempts` is reported so a caller can say so rather than pretending the
 * first draw worked.
 */
export async function askForPosting(
  ask: () => Promise<string | null>,
  attempts = 2,
): Promise<PostingRead & { readonly attempts: number }> {
  let last: PostingRead = { ok: false, reason: 'The model answered with nothing at all.' }
  for (let attempt = 1; attempt <= Math.max(1, attempts); attempt += 1) {
    const reply = await ask()
    // Not a parse failure, so not something a second draw fixes: an empty
    // answer twice over is a model that is not answering at all.
    if (reply === null || reply.trim() === '') {
      return { ...last, attempts: attempt }
    }
    last = readPosting(reply)
    if (last.ok) return { ...last, attempts: attempt }
    // The page is not a posting. That is a fact about the PAGE, and asking a
    // second time cannot change it — retrying here would just make the person
    // wait to be told the same thing.
    if (last.reason.startsWith('That page does not read as a job posting')) {
      return { ...last, attempts: attempt }
    }
  }
  return { ...last, attempts: Math.max(1, attempts) }
}
