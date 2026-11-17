/**
 * The Assistant's scripted replies: what the page answers with when no model is
 * connected, and the pure rules that pick and file them. Rendered by
 * `ScriptedPanel.tsx`; tested in `scripts.test.ts`.
 */
import { i18next } from '@/i18n/i18n'
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

/**
 * A script whose words come from the `assistant` catalog, read each time they
 * are asked for, so a reply drawn after the language changes is in the new one.
 * The `cues` are matching data and stay English.
 */
function scripted(
  id: string,
  key: string,
  cues: string[],
  tag: SnippetTag,
  { quickAction = true }: { quickAction?: boolean } = {},
): Script {
  const tx = (field: string) => i18next.t(`assistant:scripts.${key}.${field}`)
  return {
    id,
    cues,
    tag,
    get action() {
      return quickAction ? tx('action') : ''
    },
    get title() {
      return tx('title')
    },
    get reply() {
      return tx('reply')
    },
  }
}

export const SCRIPTS: Script[] = [
  scripted(
    'cover-letter',
    'coverLetter',
    ['cover letter', 'letter of application', 'motivation'],
    'Cover letter',
  ),
  scripted('tailor-cv', 'tailorCv', ['cv', 'resume', 'tailor'], 'Application form'),
  scripted(
    'parse-posting',
    'parsePosting',
    ['posting', 'parse', 'job ad', 'advert'],
    'Application form',
  ),
  scripted('follow-up', 'followUp', ['follow up', 'follow-up', 'chase', 'nudge', 'email'], 'Email'),
  scripted(
    'interview',
    'interview',
    ['interview', 'job talk', 'chalk talk', 'campus visit'],
    'Application form',
  ),
]

/**
 * What comes back when nothing in the message matches a script.
 *
 * It says what it is rather than improvising, because the alternative — a
 * plausible-sounding paragraph about whatever was typed — is the exact thing a
 * page with no model behind it must not do.
 */
export const FALLBACK: Script = scripted('fallback', 'fallback', [], 'Application form', {
  quickAction: false,
})

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
export function scriptedExchange(at: number, clean: string, scriptId?: string): [Message, Message] {
  // A quick action names its script; typed text is matched on its cues.
  const script = scriptId === undefined ? scriptFor(clean) : scriptById(scriptId)
  return [
    { id: `m${at}`, role: 'you', text: clean },
    { id: `m${at + 1}`, role: 'assistant', text: script.reply, scriptId: script.id },
  ]
}
