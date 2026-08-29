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
 * ## Exhaustive about what is written, silent about what is not
 *
 * The first version of this file made omission easy and said nothing at all
 * about completeness. Every instruction was a permission to leave something
 * out, for a good reason — a model asked to extract from a CV will, unprompted,
 * fill in a plausible university, invent a date range from context, or promote
 * "familiar with Rust" into a skill entry that reads like expertise, and each
 * of those is a claim about a real person that they never made, sitting in
 * their own records, shown to them as though they wrote it.
 *
 * That reason still holds and none of those instructions have gone. What was
 * wrong was the missing half: a model told six times to omit and never once to
 * be complete returns a representative sample of a CV, not a reading of it.
 * The two goals are not in tension once they are stated separately —
 *
 *   - Every entry the document STATES must come back. Leaving one out is an
 *     error exactly as much as inventing one.
 *   - Nothing the document does not state may be added. Omit the key, omit the
 *     entry, say nothing rather than guess.
 *
 * ## Why it reads the document in sections, and twice
 *
 * A single pass over a whole CV is where the rest of the loss was. Asked for
 * one flat list of facts from 24k characters, models produce ten to fifteen
 * entries and stop — long-list generation degrades, and the tail of a CV is
 * where the publications are. Splitting on the document's own headings and
 * asking each section for everything in it turns one impossible instruction
 * into six easy ones, and it is the single largest recall win available here.
 *
 * Then `missedMessages` asks once more, showing the model what was found and
 * asking only what was left out. That pass raises recall at some cost to
 * precision, which is the right trade for this direction: a wrong entry is
 * visible in the review list and one click to drop, and a missing one is
 * invisible forever.
 *
 * ## Why the reply is JSON and parsed defensively
 *
 * Same reason as the posting reader: a small local model writes prose around
 * its JSON, fences it, or trails a comma. The parser strips a fence, finds the
 * outermost object, and refuses cleanly rather than throwing — because the
 * caller's next move is to tell the user their CV could not be read, not to
 * crash the screen they uploaded it from.
 */

import { firstJsonObject, salvageJsonObject } from '../core/json-reply'
import { BACKGROUND_KINDS } from '../core/model'
import type { BackgroundKind } from '../core/model'
import type { ChatMessage } from '../core/model-server'
import { fold } from '../core/text'
import type { ProfileDocument } from '../core/document-kind'
import { DOCUMENT_LABEL } from '../core/document-kind'

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

/* ------------------------------- sectioning ------------------------------- */

/** One part of the document, under the heading the document gave it. */
export type CvSection = { readonly heading: string; readonly text: string }

/**
 * What counts as a heading in a converted CV.
 *
 * Three shapes, because the reader hands back whatever the original used and
 * the three are not interchangeable. A Word CV with styled headings converts to
 * `## Education`; one typed with bold runs converts to `**Education**`; one
 * from LaTeX or a plain-text export arrives as a short line in capitals.
 *
 * The capitals rule is deliberately narrow — under 60 characters, no full stop,
 * at least one letter — because a CV also contains lines like
 * "IEEE TRANSACTIONS ON SOFTWARE ENGINEERING", and treating a journal name as a
 * section heading would split a publication list into forty sections of one
 * line each.
 */
const HEADING = /^(?:#{1,6}\s+(?<hash>.+?)\s*|\*\*(?<bold>[^*]{1,60})\*\*\s*|(?<caps>[A-Z][A-Z0-9 &/,'()-]{2,59}))$/

/** Anything before the first heading: a name, contact details, a summary. */
const PREAMBLE = 'Top of the document'

/**
 * The document, split on its own headings.
 *
 * Returns one section when there are no headings at all, which is a real case —
 * a one-page CV exported to plain text often has none — and the caller then
 * behaves exactly as the single-pass version did.
 *
 * ## Nothing the document says may leave this function
 *
 * It used to. A heading line was consumed as a label and never written into any
 * body, so a heading whose section turned out to be empty took its own text with
 * it — and two heading-shaped lines in a row make each other's sections empty.
 * Measured on CV-shaped markdown (2026-08): the six lines
 *
 *   AWARDS / BEST PAPER AWARD, OSDI 2019 / BEST DEMO AWARD, SOSP 2020
 *   ## Education / **PhD, Computer Science** / MIT, 2016-2021
 *
 * produced exactly one section — the preamble — and all six vanished before the
 * model saw them. Every line there is heading-SHAPED (the capitals rule matches
 * "MIT, 2016-2021" as readily as "AWARDS"), so each one flushed an empty body
 * and dropped the label before it.
 *
 * Two rules now stand between a line and that fate, and neither invents
 * structure the document does not have:
 *
 *   - A bold or capitals line arriving while the run of headings is still open
 *     — nothing but blanks since the last heading — is CONTENT, not a heading.
 *     Which of "EDUCATION" and "PhD, Computer Science" is the real heading is
 *     not knowable, so the first wins the label and the rest become its text.
 *     That is the safe way round: the first line of such a block is the one
 *     least likely to be an entry worth extracting.
 *   - A `#` heading always opens a section — a converter writes one because the
 *     original was styled as a heading — but if the section under it turns out
 *     to be empty, its text is carried into the next section's body rather than
 *     dropped.
 *
 * What is still dropped, deliberately: a lone heading with nothing under it at
 * the very end of the document. There is no section to carry it into, and a
 * heading word with no entries beneath it states no fact about the person.
 */
export function cvSections(markdown: string): CvSection[] {
  const out: CvSection[] = []
  let heading = PREAMBLE
  let body: string[] = []
  /** Headings whose sections were empty, waiting for a body to belong to. */
  let carried: string[] = []
  /** True from a heading line until the first line of real content after it. */
  let opening = false

  const flush = () => {
    const text = [...carried, ...body].join('\n').trim()
    if (text !== '') {
      out.push({ heading, text })
      carried = []
    } else if (heading !== PREAMBLE) {
      // A heading the reader mis-detected, or a section the person left empty.
      // Either way it names nothing — but it is still a line of the document,
      // so it waits for the next section rather than being deleted here.
      carried.push(heading)
    }
    body = []
  }

  for (const line of markdown.split('\n')) {
    const trimmed = line.trim()
    const found = HEADING.exec(trimmed)
    const hash = found?.groups?.['hash']
    const next = (hash ?? found?.groups?.['bold'] ?? found?.groups?.['caps'])?.trim()
    if (next !== undefined && next !== '') {
      if (opening && hash === undefined) {
        // Still inside the same heading block: this is the subtitle, the degree
        // line under "EDUCATION", or the second of three award lines in capitals.
        body.push(next)
        continue
      }
      flush()
      heading = next
      opening = true
      continue
    }
    body.push(line)
    // Blank lines do not close the block. A converted CV puts one between every
    // pair of lines, so closing on them would leave the two-line heading block —
    // the shape this whole guard exists for — exactly as broken as it was.
    if (trimmed !== '') opening = false
  }
  flush()

  /*
   * No fallback for "no headings found", and there was one. It was dead: a
   * document without headings never enters the loop's heading branch, so the
   * final `flush` pushes the whole thing under `PREAMBLE` and `out` is already
   * a one-section list. The fallback could only fire on a document that is
   * entirely whitespace — where it built a section with empty text, which is
   * the exact shape `flush` still refuses to create.
   *
   * An empty list for an empty document is the honest answer. The caller
   * rejects anything under `TOO_SHORT` long before this.
   */
  return out
}

/** One request's worth of document: sections that fit in a single budget. */
export type CvPass = {
  readonly label: string
  readonly text: string
  /** True when this is a piece of one long section rather than whole ones. */
  readonly partial: boolean
}

/**
 * The document, cut into passes a model can actually answer completely.
 *
 * Sections are packed rather than sent one per call: a CV has a two-line
 * "Languages" section and a nine-page publication list, and one round trip per
 * heading would spend six of them on sections that fit together in one.
 *
 * A section longer than the budget on its own is split, and the pass says so —
 * a model handed the middle of a publication list without being told it is the
 * middle will note that the list "appears to begin mid-way", which is true and
 * not what was asked.
 *
 * The budget is spent on what the pass will actually CARRY — the `## heading`
 * line above each section and the blank line between two of them included, see
 * `cost`. Only two things can still put a pass over it, and both are documents
 * with no seam to cut on: a heading longer than the budget, and a single block
 * of text with no blank line in it.
 */
export function cvPasses(markdown: string, budget = CV_BUDGET): CvPass[] {
  const out: CvPass[] = []
  let held: CvSection[] = []
  let size = 0

  const flush = () => {
    if (held.length === 0) return
    out.push({
      label: held.map((x) => x.heading).join(', '),
      text: held.map((x) => `## ${x.heading}\n${x.text}`).join(SEAM),
      partial: false,
    })
    held = []
    size = 0
  }

  for (const section of cvSections(markdown)) {
    const whole = cost(section)
    if (whole > budget) {
      flush()
      // Split on blank lines so an entry is not cut in half. A publication
      // whose title lands in one pass and whose venue lands in the next is
      // worse than either half alone.
      //
      // The heading is repeated on every piece, so what is left for the text is
      // the budget minus the frame. At least one character, so a heading longer
      // than the whole budget still cuts the section up instead of asking
      // `chunk` for room it cannot give.
      const room = Math.max(1, budget - FRAME - section.heading.length)
      for (const [i, piece] of chunk(section.text, room).entries()) {
        out.push({
          label: `${section.heading} (part ${String(i + 1)})`,
          text: `## ${section.heading}\n${piece}`,
          partial: true,
        })
      }
      continue
    }
    if (size > 0 && size + SEAM.length + whole > budget) flush()
    held.push(section)
    size += size === 0 ? whole : SEAM.length + whole
  }
  flush()

  return out
}

/** What separates two sections packed into one pass. */
const SEAM = '\n\n'

/** The `## ` before a heading and the newline after it. */
const FRAME = '## '.length + '\n'.length

/**
 * What a section costs in the text a pass actually carries.
 *
 * Packing used to count `section.text.length` and nothing else, while `flush`
 * emitted `## ${heading}\n${text}` joined by a blank line — so every heading,
 * its frame and every seam were spent without being counted. Measured
 * (2026-08): two sections with 50-character headings packed to a budget of 200
 * emitted a pass of 290 characters. `cvMessages` then slices anything over
 * `CV_BUDGET` off the END, which is where a CV keeps its publications, so the
 * overshoot was paid for by the part of the document this whole file exists to
 * stop losing.
 */
const cost = (section: CvSection): number => FRAME + section.heading.length + section.text.length

/**
 * A long section, cut at blank lines so no entry straddles two passes.
 *
 * `budget` here is room for the TEXT — the caller has already taken the heading
 * frame off it — and the blank line rejoining two blocks counts against it too.
 */
function chunk(text: string, budget: number): string[] {
  const out: string[] = []
  let held = ''
  for (const block of text.split(/\n\s*\n/)) {
    // A single block over budget has no seam to cut on; it goes whole and the
    // caller's own truncation handles it rather than this splitting mid-word.
    if (held !== '' && held.length + SEAM.length + block.length > budget) {
      out.push(held)
      held = ''
    }
    held = held === '' ? block : `${held}${SEAM}${block}`
  }
  if (held !== '') out.push(held)
  return out.length > 0 ? out : [text]
}

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

const SYSTEM = [
  'You read a CV or résumé and return JSON. Nothing else.',
  '',
  'Return exactly one JSON object, with no prose around it and no code fence:',
  '  {"background": [ … ]}',
  '',
  'TWO RULES, AND THEY ARE NOT IN TENSION.',
  '',
  '1. BE COMPLETE. Return an entry for EVERY item the text states. If it lists',
  '   six jobs, return six. If it lists forty papers, return forty. Leaving one',
  '   out is a mistake exactly as much as making one up. Work down the text in',
  '   order and do not stop early or summarise.',
  '',
  '2. INVENT NOTHING. Copy what is written. Do not summarise an entry, do not',
  '   combine two into one, and do not infer a fact the text does not state.',
  '   Omit any key you cannot find. Never guess, and never write "unknown",',
  '   "N/A" or an empty string.',
  '',
  'Entry keys:',
  `  kind        EXACTLY one of: ${BACKGROUND_KINDS.join(', ')}.`,
  '  title       the degree, job title, paper title, skill, or course name.',
  '  where       the university, employer, journal or conference. Omit if absent.',
  '  period      the dates AS WRITTEN: "2021–2024", "Summer 2019", "since 2024".',
  '              Do not convert to a format the document does not use.',
  '  year        a single four-digit year for ordering, if one is clear.',
  '  detail      a short line of anything else that belongs to the entry — a',
  '              venue, a grade, a co-author list, a one-line description.',
  '  highlights  the bullet points printed under the entry, one string each,',
  '              copied as written. This is the most valuable field on a job or',
  '              a project: it is what says the person actually did the thing.',
  '              Omit the key when there are no bullets. Never write bullets',
  '              that are not there.',
  '',
  'What counts as which kind:',
  '  education     a degree or diploma the person received.',
  '  employment    a post held. Include internships, postdocs and consulting.',
  '  publication   a paper, book, chapter or preprint.',
  '  patent        a granted or filed patent. Not a paper.',
  '  skill         a named competence: a language, a tool, a method.',
  '  language      a human language, with the level if one is given.',
  '  certification a certificate or licence awarded by a body, with an expiry',
  '                or an issuer. Not a degree.',
  '  project       something built or run that is not a job — open source, a',
  '                side project, a competition entry.',
  '  teaching      a course taught, a supervision, a teaching role.',
  '  award         a prize, medal, scholarship or honour.',
  '  grant         funding won. The amount and funder go in detail. An entry',
  '                with a sum of money in it is a grant even when its name says',
  '                "award" — "EPSRC New Investigator Award, £412,000" is a grant.',
  '  service       reviewing, programme committees, editorial or admin roles.',
  '  volunteering  unpaid work in the community. Not academic service.',
  '  membership    belonging to a professional body or society.',
  '  leadership    heading a group, team, lab, committee or society.',
  '  outreach      public engagement, schools work, science communication.',
  '  training      a course or programme the person TOOK to develop themselves.',
  '                Not a degree, and not something they taught.',
  '  other         anything the document states about the person that none of',
  '                the kinds above fits. Say what it is in `detail`. Use this',
  '                rather than forcing an entry into a kind that is nearly',
  '                right, and rather than leaving it out.',
  '',
  'A long skills line — "Python, Rust, Go, Kubernetes" — is FOUR skill entries,',
  'one per name. Do not file it as one entry containing a list.',
  '',
  'If the text is not about this person at all — a job posting, somebody else’s',
  'CV, an error page — return {"notAboutThePerson": true} instead.',
].join('\n')

/**
 * What each kind of document states, and what to be careful of in it.
 *
 * Appended to the shared rules rather than replacing them: everything about
 * inventing nothing applies whatever is being read. What changes is the SHAPE
 * the model should expect and the specific way each kind misleads.
 *
 * A CV is a list and the risk is stopping early. A statement is an argument and
 * the risk is reading an intention as an achievement. A cover letter is
 * addressed to somebody else and the risk is the worst one available here.
 */
const GUIDANCE: Readonly<Record<ProfileDocument, readonly string[]>> = {
  cv: [
    'This is a CV. It is a list of dated entries under headings.',
    'Work down it in order. Every line that names a degree, a post, a paper, a',
    'skill, a course, a prize or a grant is an entry.',
  ],
  'research-statement': [
    'This is a research statement. It is PROSE, not a list, and most of what it',
    'states will not appear as a dated line anywhere.',
    '',
    'What to take from it:',
    '  - the subjects the person works on           -> skill',
    '  - the methods and tools they say they use    -> skill',
    '  - named projects, systems or datasets built  -> project',
    '  - papers or results they describe as theirs  -> publication',
    '  - funding they say they hold or have held    -> grant',
    '  - students or teams they say they lead       -> teaching',
    '',
    'BE CAREFUL: a research statement talks about the FUTURE. "I plan to", "I',
    'intend to", "my next project will" and "I am seeking funding for" are not',
    'things the person has done. Take only what is stated as done or as ongoing.',
  ],
  'teaching-statement': [
    'This is a teaching statement. It is PROSE, not a list.',
    '',
    'What to take from it:',
    '  - courses named as taught                    -> teaching',
    '  - supervision and mentoring described        -> teaching',
    '  - methods and approaches they say they use   -> skill',
    '  - training or qualifications mentioned       -> certification',
    '  - curriculum or materials they say they made -> project',
    '',
    'BE CAREFUL: most of a teaching statement is belief rather than fact —',
    '"I believe students learn best when", "my aim is to". A belief about',
    'teaching is not a thing the person has done. Take the sentences that say',
    'what they DID.',
  ],
  'cover-letter': [
    'This is a cover letter. It is PROSE, and it is addressed to an employer.',
    '',
    'WHAT TO TAKE. Every sentence where the person says what THEY have done —',
    '"I led", "I built", "I taught", "I published", "in my current post at X I",',
    '"during my postdoc at Y I". A cover letter always contains several of',
    'these; that is what it is for. If you find none, read the sentences',
    'beginning "I" again.',
    '',
    '  - a post they say they hold or held           -> employment',
    '  - something they say they built or ran        -> project',
    '  - papers or venues they say are theirs        -> publication',
    '  - a prize they say they received              -> award',
    '',
    'WHAT TO LEAVE. Sentences whose subject is the reader: "your department’s',
    'work on verified compilation", "the post’s emphasis on teaching", "your',
    'recent Nature paper". Those are facts about the EMPLOYER, and recording',
    'one would file their qualifications as this person’s.',
    '',
    'Leave "I would", "I hope to", "I am excited to", "I would relish" — those',
    'are about a job they have not got.',
    '',
    'Both halves matter. Returning nothing is as wrong as returning the',
    'employer’s achievements.',
  ],
  other: [
    'This document is something the person wrote about themselves, and it may be',
    'prose rather than a list. Take the claims they make about what they have',
    'done and can do. Take nothing that is about somebody else, and nothing',
    'stated as an intention rather than as a fact.',
  ],
}

/** The rules, plus what this particular kind of document needs said. */
const systemFor = (kind: ProfileDocument): string =>
  [SYSTEM, '', ...GUIDANCE[kind]].join('\n')

/**
 * The two messages for one pass, ready for `agentTurn`.
 *
 * `pass` is one entry from `cvPasses`. The caller owns the transport and the
 * loop: this layer has no network and no idea how many round trips are
 * affordable on whatever the person is running.
 */
export function cvMessages(name: string, pass: CvPass, kind: ProfileDocument = 'cv'): ChatMessage[] {
  const long = pass.text.length > CV_BUDGET
  const text = long ? pass.text.slice(0, CV_BUDGET) : pass.text
  return [
    { role: 'system', content: systemFor(kind) },
    {
      role: 'user',
      content: [
        `Document: ${name} (a ${DOCUMENT_LABEL[kind]})`,
        `This is the “${pass.label}” part of it.`,
        /*
         * Said out loud whenever the model is looking at a fragment. Without it
         * a model handed the middle of a publication list remarks that the list
         * seems to start part-way through — which is true, and not what was
         * asked — or concludes the person has no publications at all because
         * the section it can see is the one about languages.
         */
        pass.partial || long ? '(This is part of a longer section, not all of it.)' : '',
        '',
        'Return every entry stated in this part. Nothing from any other part.',
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
 * How much of the document the omission pass is shown.
 *
 * Smaller than `CV_BUDGET`, because this request carries the found entries as
 * well as the text and the two together have to fit the same window. The
 * document half is what gets cut, which is the right half to cut: a model
 * checking for omissions against a partial document reports fewer omissions,
 * and reporting fewer is the safe direction.
 */
export const MISSED_BUDGET = 16_000

const MISSED_SYSTEM = [
  'You are checking an extraction for things it left out.',
  '',
  'You will be given the text of a document and a list of entries already',
  'found in it. Return ONLY entries that are stated in the text and are NOT in',
  'the list. Same JSON shape, same keys, same rules:',
  '  {"background": [ … ]}',
  '',
  'Return {"background": []} if nothing was missed. That is a common and',
  'correct answer — do not manufacture an entry to have something to say.',
  '',
  'Do not return an entry that is already in the list, even worded differently.',
  'Do not return anything the text does not state.',
].join('\n')

/**
 * A second look, showing what was found and asking only what was not.
 *
 * The research on extraction is consistent that an omission pass raises recall
 * at some cost to precision. That trade is the right way round here and the
 * reason is the review list: a wrong entry is on screen with the others and
 * costs one click to drop, and a missing one is invisible forever. A person
 * cannot review what they were never shown.
 *
 * Shown as titles rather than as the full JSON, because the model does not need
 * the periods and venues to answer "is this one already here" — and the ones it
 * does not need are the ones that crowd out the document it is checking.
 */
export function missedMessages(
  name: string,
  markdown: string,
  found: readonly BackgroundDraft[],
  kind: ProfileDocument = 'cv',
): ChatMessage[] {
  const long = markdown.length > MISSED_BUDGET
  const text = long ? markdown.slice(0, MISSED_BUDGET) : markdown
  const listed =
    found.length === 0
      ? '(nothing was found)'
      : found.map((b) => `- ${b.kind}: ${b.title}${b.where === undefined ? '' : ` — ${b.where}`}`).join('\n')

  return [
    // The kind's guidance goes to the second pass as well: a checker that does
    // not know it is reading a cover letter will "find" everything the first
    // pass correctly left out about the employer.
    { role: 'system', content: [MISSED_SYSTEM, '', ...GUIDANCE[kind]].join('\n') },
    {
      role: 'user',
      content: [
        `Document: ${name} (a ${DOCUMENT_LABEL[kind]})`,
        long ? '(This is the first part of a longer document.)' : '',
        '',
        'Already found:',
        listed,
        '',
        'Text:',
        text,
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ]
}

/* ------------------------------- relations -------------------------------- */

/**
 * One relation the model proposes, with its ends as POSITIONS in the entry list.
 *
 * Numbers, not ids, and that is the whole reason this shape exists. The records
 * do not have ids yet — nothing has been written, because the person has not
 * approved anything — and even after they do, asking a model to copy a uuidv7
 * twice per relation is asking for the one thing models reliably get wrong. A
 * number it can see in the list in front of it is a number it can get right.
 *
 * The caller maps positions to ids after the write, in the order
 * `profile.background.add` returned them.
 */
export type RelationDraft = {
  /** 0-based index into the entries the model was shown. */
  subject: number
  /** In the model's own words. `core/ontology.ts` maps it. */
  predicate: string
  object: number
}

/**
 * How much of the document the relations pass is shown.
 *
 * Smaller than `CV_BUDGET`, because this request carries the numbered entry
 * list as well as the text. The document half is the half that gets cut, and
 * that is the right way round: relations between entries are mostly derivable
 * from the entries, and a truncated document costs a few relations rather than
 * a wrong one.
 */
export const RELATIONS_BUDGET = 12_000

const RELATIONS_SYSTEM = [
  'You read a document about a person and say how the facts in it relate.',
  '',
  'You will be given a numbered list of facts already taken from the document,',
  'and the document itself. Return JSON. Nothing else:',
  '  {"relations": [{"subject": 3, "predicate": "is evidence of", "object": 7}]}',
  '',
  'subject and object are NUMBERS from the list. predicate is plain words.',
  '',
  'Say the relation however it reads most naturally — "built", "supervised",',
  '"is evidence of", "was funded by", "peer reviewed for". Do not try to guess a',
  'code or a schema name; the words are mapped afterwards.',
  '',
  'ONLY relations the document states or plainly implies. If the document says',
  '"during my postdoc at ETH I built Aurelia", then the postdoc entry and the',
  'Aurelia entry are related. If two entries merely sit near each other in the',
  'text, they are not.',
  '',
  'Do NOT relate a fact to itself. Do not repeat a relation you have already',
  'given, in either direction.',
  '',
  'Return {"relations": []} if the document states none. That is a common and',
  'correct answer for a plain list of dates.',
  '',
  'The most useful ones, when the document supports them:',
  '  - a paper or project      is evidence of   a skill',
  '  - a project               was built at     an employer',
  '  - a grant                 funded           a project',
  '  - a course                taught           a subject',
  '  - a person                supervised       a person',
].join('\n')

/**
 * The two messages for the relations pass.
 *
 * Runs after the entries are settled, not alongside them. A model asked for
 * facts AND how they relate in one reply does neither well — and the entries
 * have to be numbered before anything can point at them, which is only possible
 * once they are final.
 */
export function relationMessages(
  name: string,
  markdown: string,
  entries: readonly BackgroundDraft[],
): ChatMessage[] {
  const long = markdown.length > RELATIONS_BUDGET
  const text = long ? markdown.slice(0, RELATIONS_BUDGET) : markdown
  const listed = entries
    .map((b, i) => `${String(i + 1)}. ${b.kind}: ${b.title}${b.where === undefined ? '' : ` — ${b.where}`}`)
    .join('\n')

  return [
    { role: 'system', content: RELATIONS_SYSTEM },
    {
      role: 'user',
      content: [
        `Document: ${name}`,
        long ? '(This is the first part of a longer document.)' : '',
        '',
        'Facts:',
        listed,
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
 * The reply, turned into drafts, refusing rather than throwing.
 *
 * Row by row like everything else here. A relation naming a fact that is not on
 * the list is dropped rather than clamped to the nearest one: a model that
 * returns `object: 40` for a list of twelve has lost track of the list, and
 * pointing that relation at entry twelve would invent a fact rather than lose
 * one.
 */
export function readRelations(reply: string, entryCount: number): RelationDraft[] {
  const payload = firstJsonObject(reply)
  const raw = (payload as { relations?: unknown } | null)?.relations
  if (!Array.isArray(raw)) return []

  const out: RelationDraft[] = []
  const seen = new Set<string>()

  for (const row of raw) {
    if (typeof row !== 'object' || row === null) continue
    const r = row as Record<string, unknown>

    const subject = position(r['subject'], entryCount)
    const object = position(r['object'], entryCount)
    const predicate = typeof r['predicate'] === 'string' ? r['predicate'].trim() : ''
    if (subject === null || object === null || predicate === '' || subject === object) continue

    /*
     * Deduped on the ENDS only, ignoring direction and predicate.
     *
     * Deliberately blunter than `core/claim.ts`, which knows about inverses and
     * can afford to. Here the aim is only to stop one reply proposing the same
     * pair four ways — a model listing "A built B" and "B was built by A" in
     * one answer is describing one relation twice, and the store's own gate
     * should not have to be the first thing that notices.
     */
    const key = [subject, object].sort((a, b) => a - b).join('|')
    if (seen.has(key)) continue
    seen.add(key)

    out.push({ subject, predicate, object })
  }
  return out
}

/** A 1-based position from the model, as a 0-based index, or null. */
function position(value: unknown, count: number): number | null {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
  if (!Number.isInteger(n) || n < 1 || n > count) return null
  return n - 1
}

/**
 * One entry's identity, for merging passes without duplicating rows.
 *
 * Kind, title and employer, folded. Deliberately NOT the period: the same job
 * appears in a "Positions" section with dates and again in a "Summary" without
 * them, and keying on the dates would file it twice. Two genuinely different
 * things with the same title at the same place — a Lecturer post held twice —
 * merge into one, and that is the right cost: the alternative duplicates every
 * entry a well-organised CV mentions in two places.
 */
const identity = (b: BackgroundDraft): string =>
  `${b.kind}|${flatten(b.title)}|${flatten(b.where ?? '')}`

/**
 * Folded, and with runs of whitespace collapsed.
 *
 * `fold` lowercases and strips diacritics; it deliberately leaves spacing
 * alone, because it is shared with keyword dedupe where the blast radius of a
 * change is every tag in the app. Here the extra step is needed: a document
 * converter turns a line break inside a job title into a double space, so the
 * Positions section yields "Staff  Engineer" and the summary yields "Staff
 * Engineer", and the same job is filed twice.
 */
const flatten = (text: string): string => fold(text).replace(/\s+/gu, ' ')

/**
 * Every pass's entries, in reading order, with repeats removed.
 *
 * First wins, because the passes run in document order and the first sighting
 * of an entry is the one in the section that is about it — where the dates and
 * the bullets are. A later mention in a summary is the thinner record.
 */
export function mergeBackground(
  passes: readonly (readonly BackgroundDraft[])[],
): BackgroundDraft[] {
  const seen = new Set<string>()
  const out: BackgroundDraft[] = []
  for (const pass of passes) {
    for (const entry of pass) {
      const key = identity(entry)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(entry)
    }
  }
  return out
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
      ...maybe('highlights', bullets(row['highlights'])),
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
