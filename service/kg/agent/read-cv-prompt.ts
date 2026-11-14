/**
 * L3 — what the model is told: the extraction rules, what each kind of document
 * needs said, and the messages for the section pass and the omission pass.
 *
 * Part of `read-cv.ts`, which re-exports every name exported here. The prompt
 * text is the contract with the model; `read-cv-parse.ts` is the other half,
 * which reads back what this asked for.
 */

import { BACKGROUND_KINDS } from '../core/model'
import type { ChatMessage } from '../core/model-server'
import type { ProfileDocument } from '../core/document-kind'
import { DOCUMENT_LABEL } from '../core/document-kind'
import type { BackgroundDraft } from './read-cv-parse'
import { CV_BUDGET } from './read-cv-sections'
import type { CvPass } from './read-cv-sections'

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
