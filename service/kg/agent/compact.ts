/**
 * Summarising the part of a conversation that no longer fits, so a long chat
 * loses detail instead of losing memory.
 *
 * ## Why trimming alone is not enough
 *
 * `budget.ts` drops the oldest exchanges until the request fits, which stops
 * the server truncating from the front. It is the right floor and it is not
 * enough on its own: what it drops is gone, so at turn twelve the assistant has
 * no idea that at turn three you told it which Rice application you meant, or
 * that it already filed the CV, or that you asked it not to touch the Baylor
 * one. It will ask again, or worse, act as though none of it happened.
 *
 * ## What replaces them
 *
 * One short message, in the model's own words, describing what happened in the
 * exchanges being dropped — decisions, ids that matter, things the person
 * asked for and things they refused. It sits where those exchanges were, so
 * the conversation still reads in order.
 *
 * ## What it must not do
 *
 * Invent, and speak as though it were the person. A summary that says "you
 * agreed to close the Baylor application" when you did not is worse than the
 * amnesia it replaces, because the assistant will then act on it. The prompt
 * asks for facts already in the transcript and nothing else, and the result is
 * clearly marked as a summary so a model reading it knows it is not verbatim.
 *
 * ## When it runs
 *
 * Only when trimming would otherwise drop something, so an ordinary short
 * conversation never pays for it. It costs one model call at the moment a chat
 * gets long, and it is allowed to fail: a compaction that does not come back is
 * a plain trim, which is what would have happened anyway.
 */

import type { ChatMessage, Turn } from '../core/model-server'

/**
 * How much summary to ask for.
 *
 * Short enough that compacting cannot itself be what overflows the window, and
 * long enough to hold a handful of decisions and ids. A summary that grew with
 * the conversation would just move the problem.
 */
export const SUMMARY_CHARS = 1200

const SYSTEM = [
  'You summarise part of a conversation between a person and their job-application assistant, so the assistant can keep working after the earlier messages are dropped.',
  'Write it as notes, in the third person, under 150 words.',
  'Keep: what the person asked for, what was actually done, any record ids or names that were established, anything they explicitly refused or corrected.',
  'Drop: pleasantries, the assistant’s explanations, anything already undone.',
  'State only what is in the messages. Do not guess what the person wanted, and never write that they agreed to something unless they said so — the assistant will act on this.',
].join(' ')

/** The text of a message, whatever shape it is. Tool results included. */
const textOf = (message: ChatMessage): string => {
  if (message.role === 'tool') return `[tool result] ${message.content}`
  if (message.role === 'assistant') {
    const calls = message.tool_calls?.map((c) => c.function.name).join(', ')
    const said = message.content ?? ''
    return calls ? `assistant called ${calls}. ${said}` : `assistant: ${said}`
  }
  return `${message.role}: ${message.content}`
}

export function compactionMessages(dropped: readonly ChatMessage[]): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: dropped.map(textOf).join('\n') },
  ]
}

/**
 * The summary as a message to put where the dropped exchanges were.
 *
 * `system` rather than `assistant`, and the distinction matters: an assistant
 * message is something the model believes it SAID, and a model that reads its
 * own summary as its own prior speech will defend it. A system note is context.
 *
 * Prefixed so it can never be mistaken for verbatim history by a person reading
 * the transcript or by a model reading the prompt.
 */
export const asMessage = (summary: string): ChatMessage => ({
  role: 'system',
  content: `Earlier in this conversation (summarised, not verbatim): ${summary.trim().slice(0, SUMMARY_CHARS)}`,
})

export type CompactDeps = {
  /** The summariser's model call. May be a different, smaller model. */
  readonly ask: (messages: readonly ChatMessage[]) => Promise<Turn>
}

/**
 * Summarise the messages being dropped, or return `null`.
 *
 * `null` for every kind of not-working, and the caller then does a plain trim —
 * which is what it would have done anyway. Compaction improves a long chat; it
 * is never what makes one possible.
 */
export async function compact(
  { ask }: CompactDeps,
  dropped: readonly ChatMessage[],
): Promise<string | null> {
  if (dropped.length === 0) return null
  let turn: Turn
  try {
    turn = await ask(compactionMessages(dropped))
  } catch {
    return null
  }
  if (!turn.ok || turn.text === null || turn.text.trim() === '') return null
  /*
   * The RAW summary, not the message.
   *
   * It used to return `asMessage(text)` and the loop stored that message's
   * content on the thread — prefix included. The next turn then wrapped the
   * stored value again, so a twice-compacted conversation carried "Earlier in
   * this conversation (summarised, not verbatim): Earlier in this conversation
   * (summarised, not verbatim): …", growing a line of boilerplate per
   * compaction inside the thing that exists to stop growth.
   *
   * The prefix belongs to the MESSAGE, so `asMessage` owns it and the stored
   * value stays the summary itself.
   */
  return turn.text.trim().slice(0, SUMMARY_CHARS)
}
