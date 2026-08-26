/**
 * A second, smaller agent whose only job is choosing which tools the first one
 * may use.
 *
 * ## Why a model does this better than the lexical retriever
 *
 * `retrieve.ts` selects on words: it matches the request against a lexicon and
 * closes over the tool graph. That is fast, free, deterministic and offline,
 * and it is right most of the time — which is why it stays, and why it is the
 * fallback here rather than the other way round.
 *
 * What it cannot do is read intent. "I heard back from Rice" names no tool and
 * no verb the lexicon knows; a model recognises it as a stage change. When the
 * lexicon does not recognise a request it ABSTAINS, and the caller then offers
 * everything — which is the 16,000-token first message this whole layer exists
 * to avoid.
 *
 * ## Why this is affordable
 *
 * The retriever does not need schemas. Ninety-one names with a one-line summary
 * each is about 2,600 tokens; the same ninety-two as JSON Schema is about
 * 16,000. So the choosing call costs roughly a sixth of what it saves, and it
 * saves it on every subsequent round of the main loop rather than once.
 *
 * ## Why it is a separate call and not a first step of the main loop
 *
 * It runs against its own transcript — the request and a few recent lines, not
 * the conversation, not the tool results, not the system prompt. That keeps it
 * cheap, keeps it stable as the main conversation grows, and means an app may
 * point it at a smaller and faster model than the one doing the work. It also
 * cannot be talked out of its answer by anything in the main thread.
 *
 * ## What it is not allowed to do
 *
 * Widen. Whatever it picks goes through the same pipeline as a lexical pick —
 * closed over the tool graph so a composition's dependencies come with it, the
 * resident reads added, and `NEVER_IMPLICIT` stripped unless the person's own
 * words asked for it. A retriever that could hand back `memory.clear` because a
 * model thought it might be useful would be a worse door than the one this
 * layer closed.
 */

import { CATALOG } from './catalog'
import type { ChatMessage, Turn } from '../core/model-server'
import { firstJsonObject } from '../core/json-reply'

/**
 * How much of a tool's summary the chooser sees.
 *
 * First sentence, capped. The summaries are written for the model that will USE
 * the tool and several run to a paragraph — the longest is 859 characters, and
 * a chooser reading ninety-two paragraphs is a chooser paying for prose it does
 * not need to decide relevance.
 */
const SUMMARY_CHARS = 120

const firstSentence = (text: string): string => {
  const trimmed = text.trim()
  const stop = trimmed.search(/[.!?](\s|$)/)
  const head = stop === -1 ? trimmed : trimmed.slice(0, stop + 1)
  return head.length > SUMMARY_CHARS ? `${head.slice(0, SUMMARY_CHARS).trimEnd()}…` : head
}

/** The catalog as the chooser sees it: a name and a line, never a schema. */
export const listing = (): string =>
  CATALOG.map((e) => `${e.name} — ${firstSentence(e.summary)}`).join('\n')

const SYSTEM = [
  'You choose which tools another assistant may use for one request. You do not answer the request and you do not call anything.',
  'Reply with JSON only: {"tools": ["name", "name"]}. No prose, no explanation.',
  /*
   * The write instruction comes first and is stated as a rule, because the
   * failure it prevents is the expensive one.
   *
   * Measured: for "I am withdrawing from Baylor" the chooser picked reads only.
   * The assistant then looked the record up, found it, and ANSWERED "I have
   * updated the application to the closed stage" — having called nothing. A
   * model with no way to act does not say it cannot; it says it did.
   *
   * "Include the read as well as the write" was already here and is the wrong
   * emphasis: under-picking reads costs a round trip, under-picking writes
   * costs the person a change they were told had happened.
   */
  'MOST IMPORTANT: if the request asks for anything to be changed, added, moved, filed, removed or recorded, you MUST include the tool that makes that change. An assistant given only read tools will still say it did the thing, and nothing will have happened.',
  'Include the reads it needs to find the record first — that is normal — but never instead of the write.',
  'Pick every tool the request could plausibly need, and nothing else.',
  'If you are unsure whether something is needed, include it. Leaving out a tool the assistant needs makes the request fail; including a spare one costs a little space.',
  'Use names exactly as they appear in the list. Do not invent names.',
].join(' ')

/**
 * The chooser's whole input.
 *
 * `recent` is the last few things said, in order, oldest first — not the tool
 * results and not the full transcript. A follow-up like "and the second one?"
 * is unreadable alone and obvious with one line of context, and that is all the
 * context choosing ever needs.
 */
export function retrieverMessages(request: string, recent: readonly string[] = []): ChatMessage[] {
  const context = recent.length > 0 ? `Recently said:\n${recent.join('\n')}\n\n` : ''
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `${context}Request: ${request}\n\nTools:\n${listing()}` },
  ]
}

/**
 * The names the chooser picked, or `null` if it did not answer usefully.
 *
 * `null` and not `[]`, and the difference decides what happens next: an empty
 * array is a chooser saying "none of these", which for a request that reached
 * an assistant is almost certainly wrong and would leave it with no tools at
 * all. Both mean "fall back to the lexicon".
 *
 * Unknown names are dropped rather than failing the whole reply. A model that
 * returns nine real tools and one invented one has still done the job.
 */
export function readPicks(reply: string): string[] | null {
  const payload = firstJsonObject(reply)
  const raw = (payload as { tools?: unknown } | null)?.tools
  if (!Array.isArray(raw)) return null

  const known = new Set(CATALOG.map((e) => e.name))
  const wire = new Map(CATALOG.map((e) => [e.wireName, e.name]))
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const name = known.has(item) ? item : wire.get(item)
    if (name !== undefined && !out.includes(name)) out.push(name)
  }
  return out.length > 0 ? out : null
}

export type ChooserDeps = {
  /**
   * The chooser's own model call — deliberately its own, not the main loop's.
   *
   * An app may point this at a smaller, faster model: choosing from a list is a
   * far easier task than doing the work, and the two do not have to be the same
   * weights.
   */
  readonly ask: (messages: readonly ChatMessage[]) => Promise<Turn>
  /** Recent lines of the conversation, oldest first. Empty is fine. */
  readonly recent?: readonly string[]
}

/**
 * Ask the chooser which tools this request needs.
 *
 * Returns `null` for every kind of not-working — a refused call, an unreachable
 * server, prose instead of JSON, an empty pick. The caller falls back to the
 * lexical retriever, which is offline and cannot fail, so a chooser that is
 * down costs latency and never capability.
 */
export async function pickTools({ ask, recent = [] }: ChooserDeps, request: string): Promise<string[] | null> {
  let turn: Turn
  try {
    turn = await ask(retrieverMessages(request, recent))
  } catch {
    return null
  }
  if (!turn.ok || turn.text === null) return null
  return readPicks(turn.text)
}
