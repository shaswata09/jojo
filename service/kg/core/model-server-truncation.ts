/**
 * Catching a server that quietly read only part of the prompt.
 *
 * Split out of `model-server.ts`, which re-exports every public name here.
 */

import type { Turn, Usage } from './model-server-turn'

/**
 * Roughly how many tokens a request body is, without a tokeniser.
 *
 * `chars / 3.6`, which is deliberately crude and deliberately documented as
 * such. A real tokeniser would be a dependency per model family, and this
 * number is never used to make a decision that needs to be exact — only to
 * notice a server that evaluated a small FRACTION of what it was sent. The
 * divisor was calibrated against this app's own catalog: 56,071 characters of
 * tool schema measured as 15,575 tokens.
 */
export const estimateTokens = (body: string): number => Math.round(body.length / 3.6)

/**
 * How much of the prompt the server appears to have thrown away.
 *
 * Returns null when there is nothing to say — no usage reported, or the counts
 * broadly agree. A number is only produced when the server evaluated
 * materially less than was sent, which is the case worth interrupting someone
 * over.
 *
 * ## Why the threshold is generous
 *
 * Because the estimate is crude and the two numbers are counting slightly
 * different things. A chat template adds control tokens the client never sees;
 * a tokeniser splits JSON punctuation in ways `chars/3.6` cannot predict; and
 * a server with a warm prefix cache may report cached tokens differently. All
 * of that is noise in the tens of percent, and none of it is the failure being
 * looked for — truncation to a 4k window from a 19k prompt is a FOUR-FOLD
 * disagreement. Half is comfortably outside the noise and comfortably inside
 * the thing worth catching.
 */
export const TRUNCATION_RATIO = 0.5

export function truncationOf(sentBody: string, usage: Usage | null): number | null {
  if (usage?.promptTokens == null) return null
  const sent = estimateTokens(sentBody)
  // A tiny prompt has too little signal; the ratio is meaningless on 40 tokens.
  if (sent < 1000) return null
  return usage.promptTokens < sent * TRUNCATION_RATIO ? usage.promptTokens : null
}

/**
 * A turn, unless the server quietly read only part of what it was sent.
 *
 * The decision and the sentence in one place, called by both apps, because the
 * first version of this was twelve lines written twice — once in each app's
 * `llm.ts` — which is the copy this repo has a lint rule against. It was also
 * untestable there: `agentTurn` does a real `fetch`, so nothing held the wiring
 * and removing it broke no test.
 *
 * Reported as a REFUSAL rather than passed through with a warning attached. An
 * answer built on a prompt the model never fully read is not a degraded answer,
 * it is a wrong one delivered confidently, and letting it reach the screen is
 * how this failure stays invisible.
 */
export function guardTruncation(sentBody: string, turn: Turn): Turn {
  if (!turn.ok) return turn
  const evaluated = truncationOf(sentBody, turn.usage ?? null)
  if (evaluated === null) return turn
  return {
    ok: false,
    kind: 'refused',
    reason: truncationWarning(evaluated, estimateTokens(sentBody)),
  }
}

/**
 * The sentence for a server that quietly dropped most of the prompt.
 *
 * It names both numbers, because the person can act on the gap and cannot act
 * on "something went wrong". And it gives the two fixes in the order of
 * likelihood: raise the window, or ask for less.
 */

export const truncationWarning = (evaluated: number, sent: number): string =>
  `The server read about ${String(evaluated).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} tokens of the roughly ` +
  `${String(sent).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} jojo sent, so it silently dropped the rest — ` +
  `including, most likely, the tool list and your question. Raise the model's context window, or ask from a page that offers fewer tools.`
