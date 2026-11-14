/**
 * The Assistant's scripted replies: what the page answers with when no model is
 * connected, and the pure rules that pick and file them. Rendered by
 * `ScriptedPanel.tsx`; tested in `scripts.test.ts`.
 */
import type { SnippetTag } from '@/data/vault'

/**
 * A worked example, and the prompt that produces it.
 *
 * These are what the page answers with when NO model is connected, which was
 * every reply until Settings learned to reach one. They are still the whole
 * behaviour of an unconfigured install, and they still carry the badge saying
 * so — attached to the message's own `scriptId` rather than to the branch that
 * rendered it, so a canned reply cannot lose its badge by being drawn somewhere
 * new. A real reply from a real model carries no badge, because it is not an
 * example.
 */
export type Script = {
  id: string
  /** Doubles as the quick-action label and the message it sends. */
  action: string
  /** Words in a typed message that pick this script over the fallback. */
  cues: string[]
  /** Title and tag a snippet made from the reply is filed under. */
  title: string
  tag: SnippetTag
  reply: string
}

export const SCRIPTS: Script[] = [
  {
    id: 'cover-letter',
    action: 'Draft a cover letter',
    cues: ['cover letter', 'letter of application', 'motivation'],
    title: 'Cover letter — structure',
    tag: 'Cover letter',
    reply:
      'Here is the shape I would use for [DEPARTMENT]:\n\n' +
      'Paragraph 1 — what you work on, in one sentence a committee member outside your area can follow.\n' +
      'Paragraph 2 — the two results that make the case, each given with its consequence rather than its method.\n' +
      'Paragraph 3 — why this department: the group you would overlap with, and the course you would teach.\n' +
      'Paragraph 4 — availability, and what the first three years would look like.\n\n' +
      'Keep it to one page. The committee reads forty of these in an evening.',
  },
  {
    id: 'tailor-cv',
    action: 'Tailor my CV to a posting',
    cues: ['cv', 'resume', 'tailor'],
    title: 'Tailoring a CV — three passes',
    tag: 'Application form',
    reply:
      'Three passes, in this order:\n\n' +
      '1. Cut what the ad does not ask for. A CV tailored to everything is tailored to nothing.\n' +
      '2. Move the section the ad leads with to the top of page one — a teaching-heavy ad wants teaching above publications.\n' +
      "3. Rewrite the headline in the ad's own words, without overstating the scope of the work.\n\n" +
      'What survives untouched: publications, references, dates. Those are the parts a committee checks.',
  },
  {
    id: 'parse-posting',
    action: 'Parse a job posting',
    cues: ['posting', 'parse', 'job ad', 'advert'],
    title: 'What to pull out of a posting',
    tag: 'Application form',
    reply:
      'From an ad I would pull out: employer, role, deadline, the documents required, the named contact, ' +
      'and anything phrased as a hard requirement rather than a preference.\n\n' +
      'The last one is where applications are lost — "must hold the degree by the start date" is a filter, ' +
      '"experience with large-scale systems desirable" is not.\n\n' +
      'Job scout already does the cheap half of this without a model: save the URL there and it keeps the link ' +
      'and guesses the employer from it.',
  },
  {
    id: 'follow-up',
    action: 'Draft a follow-up email',
    cues: ['follow up', 'follow-up', 'chase', 'nudge', 'email'],
    title: 'Follow-up after no response',
    tag: 'Email',
    reply:
      'Subject: Following up — [ROLE], [DEPARTMENT]\n\n' +
      'Dear [NAME],\n\n' +
      'I applied for [ROLE] on [DATE] and wanted to check the committee has everything it needs from me. ' +
      'I am happy to send the outstanding reference letter directly if that is easier.\n\n' +
      'I remain very interested in the position, and I am glad to answer anything by email.\n\n' +
      'With thanks,\n[YOUR NAME]',
  },
  {
    id: 'interview',
    action: 'Prepare me for an interview',
    cues: ['interview', 'job talk', 'chalk talk', 'campus visit'],
    title: 'Interview — six questions to have answered',
    tag: 'Application form',
    reply:
      'Six questions worth having an answer to before the day:\n\n' +
      '— What is the work about, in ninety seconds, to someone outside your area?\n' +
      '— What would your first grant be, and to which agency?\n' +
      '— Which two courses could you teach next semester at no notice?\n' +
      '— Who here would you collaborate with, and on what?\n' +
      '— What is the weakness in your own result?\n' +
      '— What do you need in year one to do the work?\n\n' +
      'Write the answers out longhand. The rehearsal is the point, not the notes.',
  },
]

/**
 * What comes back when nothing in the message matches a script.
 *
 * It says what it is rather than improvising, because the alternative — a
 * plausible-sounding paragraph about whatever was typed — is the exact thing a
 * page with no model behind it must not do.
 */
export const FALLBACK: Script = {
  id: 'fallback',
  action: '',
  cues: [],
  title: 'Assistant — example response',
  tag: 'Application form',
  reply:
    'No model is connected, so this is a canned answer rather than a reply to what you typed.\n\n' +
    'With one connected, this page would read your profile, the documents in your Vault and the application ' +
    'you name, then draft against them on your own machine. Point jojo at a local OpenAI-compatible server ' +
    'in Settings — vLLM, Ollama or LM Studio.\n\n' +
    'Clear the conversation to see the worked examples again.',
}

/** First script with a cue in the message. Order in SCRIPTS breaks ties. */
export function scriptFor(text: string): Script {
  const haystack = text.toLowerCase()
  return SCRIPTS.find((s) => s.cues.some((cue) => haystack.includes(cue))) ?? FALLBACK
}

export type Message = {
  id: string
  role: 'you' | 'assistant'
  text: string
  /**
   * Assistant messages only — which script wrote it, and so how to file it.
   * Absent on a reply that came from a model, which is also what the badge
   * keys off: present means example, absent means answer.
   */
  scriptId?: string
  /** Set when a real request failed, so the row can say what went wrong. */
  failed?: boolean
}

/** How long the copied confirmation stays up, as in the Vault's snippets tool. */
export const COPIED_MS = 1600

/** The script a message was written by, for filing it; the fallback when it names none. */
export function scriptById(id: string | undefined): Script {
  return SCRIPTS.find((s) => s.id === id) ?? FALLBACK
}

/**
 * One exchange: the question as asked and the script's reply, numbered from
 * `at`. The reply carries `scriptId`, which is what puts the badge on it.
 */
export function scriptedExchange(at: number, clean: string): [Message, Message] {
  const script = scriptFor(clean)
  return [
    { id: `m${at}`, role: 'you', text: clean },
    { id: `m${at + 1}`, role: 'assistant', text: script.reply, scriptId: script.id },
  ]
}
