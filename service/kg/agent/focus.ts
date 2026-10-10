/**
 * L3.5 — the line that tells the model which record a conversation is about.
 *
 * WHY. A chat opened beside an application — the floating dock, or a
 * conversation filed under a job on the Assistant page — is asked things like
 * "draft a follow-up for this one" or "move this to interview". Without a
 * referent the model searches by name, picks the wrong Rice, or asks which job
 * is meant. One sentence naming the record and its id removes the guess: the
 * id is what every tool takes, so the model can act on it directly.
 *
 * Built here, beside the other prompt text, rather than by each screen, so the
 * two chat surfaces cannot word it differently. Pure, and appended by the loop
 * only when a caller passes it (`AgentOptions.focus`), so a conversation about
 * nothing in particular — and the benchmark — sends the system message it
 * always did.
 */

/** What the line needs to know about the application. */
export type FocusedApplication = { id: string; org: string; role: string }

/**
 * The record's name as one clean phrase: line breaks and quotes out, length
 * bounded. These are the person's own words, but the line is a sentence in a
 * system message and a pasted newline would end it early.
 */
const NAME_LIMIT = 120
const clean = (text: string) =>
  text
    .replace(/["“”\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_LIMIT)

export function focusLine(application: FocusedApplication): string {
  const org = clean(application.org)
  const role = clean(application.role)
  const name = role ? `${org} — ${role}` : org
  return (
    `This conversation is about the application "${name}" (id ${application.id}). ` +
    'When the person says "this application", "this job" or "this one", they mean that record: ' +
    'use its id directly rather than searching for it, unless they name a different one.'
  )
}
