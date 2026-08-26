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
 * How many requirements are worth having.
 *
 * A posting that yields forty is one where the model has started listing
 * sentences, and `assess` would then divide a real score across thirty pieces
 * of boilerplate. Twelve is more than any posting genuinely asks for and few
 * enough that the gap list stays readable.
 */
export const MAX_REQUIREMENTS = 12

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
  'If there is no heading and the sentence does not say, use false.',
  'Do not decide for yourself that something sounds important.',
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
  /*
   * Folded, because a posting that lists "Rust" under both Required and
   * Preferred — which real ones do — would otherwise become two requirements
   * that `assess` counts twice, once at double weight. The first wins, and the
   * prompt asks for the most specific first.
   */
  const seen = new Set<string>()

  for (const [index, entry] of raw.entries()) {
    if (typeof entry !== 'object' || entry === null) {
      skipped.push(`entry ${String(index + 1)}: not an object`)
      continue
    }
    const row = entry as Record<string, unknown>

    const value = row['text']
    const text = typeof value === 'string' ? value.trim() : ''
    if (text === '') {
      skipped.push(`entry ${String(index + 1)}: no text`)
      continue
    }

    const key = text.toLowerCase()
    if (seen.has(key)) {
      skipped.push(`entry ${String(index + 1)}: “${text}” was already listed`)
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
        skipped.push(`${String(raw.length - index - 1)} more were past the limit of ${String(MAX_REQUIREMENTS)}`)
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

  return { ok: true, requirements, skipped }
}

/**
 * The outermost JSON object in a reply, fence and prose tolerated.
 *
 * The same shape as `read-cv.ts`'s, and deliberately duplicated rather than
 * shared: they are eight lines each, they are the one thing in these files
 * that must never change behaviour because a sibling needed something, and a
 * shared parser is the first place a fix for one reader breaks the other.
 */
