/**
 * Turning a posting into the list of things it asks for. L3.
 *
 * The third of the readers, and the one that feeds `core/assess.ts`. Its
 * siblings answer different questions about the same page: `read-posting.ts`
 * pulls the fields a form needs — who, what, where, by when — and `read-cv.ts`
 * points the other way, at the person. This one reads the part of a posting
 * that decides whether to apply at all: the requirements.
 *
 * ## Why this is a model's job and the scoring is not
 *
 * `assess.ts` argues at length that weighing a background against a posting has
 * to be arithmetic, because a model's verdict on somebody's career is fluent
 * and uncheckable. The argument cuts the other way here. Working out that
 * "you'll be joining a team that ships Rust services daily" is a requirement
 * and "we have a dog-friendly office" is not takes reading comprehension, and no
 * amount of term matching gets there. So the split is: a model decides what was
 * asked for, and counting decides whether the person answers it.
 *
 * That split is also what makes the output checkable. Every requirement is a
 * phrase a person can find in the posting and disagree with — which is a very
 * different thing from a paragraph of assessment they can only believe.
 *
 * ## Essential versus preferred is the field that carries the weight
 *
 * `assess` weighs essentials double and `tailor` caps the verdict when one is
 * missing, so getting this wrong is not a cosmetic error — it moves the number
 * and it moves the advice. Postings state it plainly far more often than not
 * ("Required", "Minimum qualifications", "Preferred", "Nice to have"), so the
 * prompt is written to look for the HEADING the requirement sat under and to
 * fall back to `essential: false` rather than guess upward. Overstating a
 * preference as a requirement makes a good application look like a stretch;
 * understating one makes a stretch look worth an evening. The second is the
 * lesser harm — the gap still appears in the list, just without the cap.
 */

import { salvageJsonObject } from '../core/json-reply'
import type { Requirement } from '../core/assess'
import { MAX_REQUIREMENTS, MAX_REQUIREMENT_TEXT } from '../core/model'
import type { ChatMessage } from '../core/model-server'

/**
 * How much of the page the model is shown.
 *
 * The same size as `POSTING_BUDGET`, and for the same reason: the requirements
 * are in the qualifications section, which is near the top, and the 40k tail of
 * a university ad is an EEO statement and a benefits appendix. Kept as its own
 * constant rather than imported so that raising one does not silently raise the
 * other — this reader and that one are shown the same page for different
 * reasons and may not want the same slice of it forever.
 */
export const REQUIREMENTS_BUDGET = 12_000

/**
 * How many requirements are worth having, and how long one may be. Both are
 * declared in `core/model.ts`, which is where the schema that enforces them on
 * disk can reach them; re-exported here because this is the file that applies
 * them and where readers look for them.
 */
export { MAX_REQUIREMENTS, MAX_REQUIREMENT_TEXT } from '../core/model'

export type RequirementsRead =
  | {
      ok: true
      requirements: readonly Requirement[]
      /**
       * Entries the model returned that could not be used, with the reason.
       *
       * Same contract as `readCv`: reported rather than dropped, because "four
       * of sixteen were skipped" is something a person can weigh when the score
       * looks lower than they expected.
       */
      skipped: readonly string[]
      /**
       * HOW MANY entries were actually lost. Not `skipped.length`.
       *
       * The two disagree in both directions, which is why this is counted
       * separately rather than derived. `skipped` is prose for a person, so one
       * note can stand for many entries — "9 more were past the limit" is a
       * single string covering nine — and one note can stand for NONE, because
       * an `essential` that came back as `"true"` is reported and then kept.
       * A panel that printed `skipped.length` said "1 line could not be read"
       * when twelve were kept and nine dropped, and said it again when nothing
       * had been dropped at all.
       */
      dropped: number
    }
  | { ok: false; reason: string }

const SYSTEM = [
  'You read a job posting and return JSON. Nothing else.',
  '',
  'Return exactly one JSON object, with no prose around it and no code fence:',
  '  {"requirements": [ … ]}',
  '',
  'Each entry is ONE thing the posting asks a candidate to have or to have done.',
  '',
  'Entry keys:',
  '  text       the requirement, as short as it can be said and still be',
  '             specific: "PhD in Computer Science", "distributed systems",',
  '             "five years managing engineers", "fluent German".',
  '             Copy the words the posting uses. Do not generalise them.',
  '  essential  true if the posting states it as required, false if it states',
  '             it as preferred, desirable or a plus.',
  '',
  'Judging essential: use the heading the requirement sits under.',
  '  Required, Requirements, Minimum qualifications, Must have, Essential',
  '    -> true',
  '  Preferred, Desirable, Nice to have, Bonus, A plus, Advantageous',
  '    -> false',
  'A sentence saying the candidate "must hold", "must have", "is required to"',
  'or "is expected to" -> true. "Expected to" is how an academic posting',
  'says required.',
  'If there is no heading and the sentence does not say, use false.',
  'Do not decide for yourself that something sounds important.',
  '',
  'What a posting says the candidate is "expected to show", "must hold" or',
  '"will be expected to" do — a degree, teaching, mentoring, securing funding,',
  'publishing — IS a requirement, phrased as an expectation. Academic postings',
  'state most of their requirements this way. Keep every one of them.',
  '',
  'A research area or specialism the posting says it seeks IS a requirement,',
  'one entry per area, in the posting\'s words: "security and privacy",',
  '"computer graphics", "robotics". Preferred when the posting gives it',
  'primary consideration or says other areas will also be considered;',
  'required when it says only those areas will be considered. A posting',
  'that names the areas it wants is telling a candidate in another area',
  'the most important thing it has to say.',
  '',
  'What is NOT a requirement, and must be left out:',
  '  - what the job involves day to day, unless it names a skill to have',
  '  - what the employer offers: salary, benefits, holidays, the office',
  '  - who the employer is, their mission, their size, their funding',
  '  - equal-opportunity, visa, right-to-work and application-process text',
  '  - "excellent communication skills" and other phrases every posting has',
  '',
  `Return at most ${String(MAX_REQUIREMENTS)}, the most specific first. If the`,
  'posting asks for fewer, return fewer. Do not pad the list.',
  '',
  'If the text is not a job posting — a CV, an error page, a search results',
  'page — return {"notAPosting": true} instead.',
].join('\n')

/** The two messages, ready for `agentTurn`. The caller owns the transport. */
export function requirementMessages(title: string, markdown: string): ChatMessage[] {
  const long = markdown.length > REQUIREMENTS_BUDGET
  const text = long ? markdown.slice(0, REQUIREMENTS_BUDGET) : markdown
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: [
        `Posting: ${title}`,
        // Said out loud for the same reason `read-cv.ts` says it: a model given
        // a fragment reasons about the fragment as though it were the whole
        // document, and here that means concluding a posting asks for nothing.
        long ? '(This is the first part of a longer page.)' : '',
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
 * The model's reply, turned into requirements, refusing rather than throwing.
 *
 * Entry by entry, like `readCv`: one malformed row costs that row. Re-reading
 * a posting is a round trip to somebody's GPU and losing eleven good
 * requirements to one bad one would pay for the whole thing twice.
 */
export function readRequirements(reply: string): RequirementsRead {
  const payload = salvageJsonObject(reply).value
  if (payload === null) {
    return { ok: false, reason: 'The model did not return JSON.' }
  }
  if ((payload as { notAPosting?: unknown }).notAPosting === true) {
    return { ok: false, reason: 'That page does not read as a job posting.' }
  }

  const raw = (payload as { requirements?: unknown }).requirements
  if (!Array.isArray(raw)) {
    return { ok: false, reason: 'The model returned JSON without a requirements list.' }
  }

  const requirements: Requirement[] = []
  const skipped: string[] = []
  /** Counted at each real loss. See `RequirementsRead.dropped`. */
  let dropped = 0
  /*
   * Folded, because a posting that lists "Rust" under both Required and
   * Preferred — which real ones do — would otherwise become two requirements
   * that `assess` counts twice, once at double weight. The first wins, and the
   * prompt asks for the most specific first.
   */
  const seen = new Set<string>()

  for (const [index, entry] of raw.entries()) {
    /*
     * A bare string is a requirement with no verdict on how firm it is.
     *
     * Asked to list the research areas a posting seeks, Gemma answered with
     * `["security and privacy", "robotics", …]` — the right content in the
     * wrong shape — and the whole read was refused as "nothing could be read".
     * Taken as preferred, which is what the prompt says to fall back to when
     * the text does not say: a string carries no `essential`, so it did not.
     */
    const row: Record<string, unknown> =
      typeof entry === 'string'
        ? { text: entry, essential: false }
        : typeof entry === 'object' && entry !== null
          ? (entry as Record<string, unknown>)
          : {}
    if (Object.keys(row).length === 0) {
      skipped.push(`entry ${String(index + 1)}: not an object`)
      dropped += 1
      continue
    }

    const value = row['text']
    const text = typeof value === 'string' ? value.trim() : ''
    if (text === '') {
      skipped.push(`entry ${String(index + 1)}: no text`)
      dropped += 1
      continue
    }

    /*
     * A phrase longer than this is a sentence, and the store will not take one.
     *
     * `NODE_PROP_SCHEMAS` caps a requirement at `MAX_REQUIREMENT_TEXT`, and a
     * schema refusal is all-or-nothing: one over-long entry would have thrown
     * away the whole reading, leaving a panel that had just spent a model call
     * showing nothing at all and re-reading on the next visit. Skipping the
     * entry here keeps the other eleven and says so in `skipped`, which is the
     * same trade every other rule in this loop makes.
     *
     * It is also a real signal about the reply rather than a storage detail: a
     * model that answers with a 300-character "requirement" has started
     * paraphrasing the posting, and `assess` would weigh that paragraph exactly
     * as heavily as "PhD in computer science".
     */
    if (text.length > MAX_REQUIREMENT_TEXT) {
      skipped.push(
        `entry ${String(index + 1)}: ${String(text.length)} characters is a sentence, not a requirement`,
      )
      dropped += 1
      continue
    }

    const key = text.toLowerCase()
    if (seen.has(key)) {
      skipped.push(`entry ${String(index + 1)}: “${text}” was already listed`)
      dropped += 1
      continue
    }
    seen.add(key)

    /*
     * `true`, `"true"`, `"yes"` and `1` all mean required.
     *
     * This used to accept only the literal `true`, on the argument that
     * understating is the safe direction — which is right PER ROW and wrong for
     * the actual failure. A small model that writes `"essential": "true"`
     * writes it for all twelve entries, not one: every requirement then becomes
     * preferred, `assess` weighs none of them double, `tailor` never caps the
     * verdict, and the person is shown a fit score that is systematically too
     * high with a gap list that looks fine.
     *
     * The list is closed and does not include a bare truthiness test, so a
     * `"false"` string still reads as preferred — the direction that only costs
     * a cap. And when the field was present but not a boolean it is REPORTED,
     * so a coercion that mattered is visible rather than silent.
     */
    const flag = row['essential']
    const essential =
      flag === true ||
      flag === 1 ||
      (typeof flag === 'string' && ['true', 'yes', 'required'].includes(flag.trim().toLowerCase()))

    if (flag !== undefined && typeof flag !== 'boolean') {
      skipped.push(
        `entry ${String(index + 1)}: “essential” came back as ${JSON.stringify(flag)} rather than true or false, read as ${essential ? 'required' : 'preferred'}`,
      )
    }

    requirements.push({ text, essential })

    if (requirements.length === MAX_REQUIREMENTS) {
      // Said rather than silently dropped: a posting that hit the cap probably
      // had the model listing sentences, and the score is drawn from twelve of
      // whatever it wrote first.
      if (index < raw.length - 1) {
        // One NOTE, but many entries. Counted as the number it names.
        dropped += raw.length - index - 1
        skipped.push(
          `${String(raw.length - index - 1)} more were past the limit of ${String(MAX_REQUIREMENTS)}`,
        )
      }
      break
    }
  }

  if (requirements.length === 0) {
    return {
      ok: false,
      reason:
        skipped.length > 0
          ? `Nothing in that posting could be read as a requirement. ${skipped[0] ?? ''}`
          : 'That posting does not state anything jojo can read as a requirement.',
    }
  }

  return { ok: true, requirements, skipped, dropped }
}

/**
 * The outermost JSON object in a reply, fence and prose tolerated.
 *
 * The same shape as `read-cv.ts`'s, and deliberately duplicated rather than
 * shared: they are eight lines each, they are the one thing in these files
 * that must never change behaviour because a sibling needed something, and a
 * shared parser is the first place a fix for one reader breaks the other.
 */
