/**
 * Reasoning on against reasoning off, and what each costs in time.
 *
 * Measured, not modelled. The scores are the conversation benchmark run twice
 * per setting on 2026-10-23/25, commit d4221e4, 128k planning window, against
 * vLLM servers serving Gemma 4 31B (256k) and gpt-oss 120B (128k). The speeds
 * are single-request measurements on an idle server with a real jojo request —
 * the system prompt and all 105 tool descriptions — streamed, three samples.
 *
 * A typed constant rather than a second JSON payload: these figures are read
 * by one section of one page, and `tool-bench.json` already exists to carry a
 * whole run. If they are re-measured, this file and its date change together.
 */

export const REASONING_MEASURED = '2026-10-23 to 2026-10-25'

export type ReasoningRow = {
  model: string
  setting: 'On' | 'Off'
  /** Clean conversations out of 100, as the mean of two passes, then the two passes. */
  full: { mean: number; passes: readonly [number, number] }
  narrowed: { mean: number; passes: readonly [number, number] }
  /** Seconds per conversation, median and 90th percentile, across both tool sets. */
  medianSeconds: number
  p90Seconds: number
  /** Tokens the model generated per round (thinking and answer together), on average. */
  tokensPerRound: number
}

export const REASONING_ROWS: readonly ReasoningRow[] = [
  {
    model: 'Gemma 4 31B',
    setting: 'Off',
    full: { mean: 81.5, passes: [82, 81] },
    narrowed: { mean: 76.5, passes: [77, 76] },
    medianSeconds: 8.5,
    p90Seconds: 15.8,
    tokensPerRound: 39,
  },
  {
    model: 'Gemma 4 31B',
    setting: 'On',
    full: { mean: 79.5, passes: [81, 78] },
    narrowed: { mean: 73.5, passes: [72, 75] },
    medianSeconds: 24.3,
    p90Seconds: 95,
    tokensPerRound: 230,
  },
  {
    model: 'GPT-OSS 120B',
    setting: 'Off',
    full: { mean: 63.5, passes: [62, 65] },
    narrowed: { mean: 64.5, passes: [63, 66] },
    medianSeconds: 3.6,
    p90Seconds: 10.1,
    tokensPerRound: 141,
  },
  {
    model: 'GPT-OSS 120B',
    setting: 'On',
    full: { mean: 64, passes: [65, 63] },
    narrowed: { mean: 65, passes: [66, 64] },
    medianSeconds: 3.6,
    p90Seconds: 10.1,
    tokensPerRound: 139,
  },
]

export type SpeedRow = {
  model: string
  /** Milliseconds to generate one token, once generation has started. */
  msPerToken: number
  tokensPerSecond: number
  /** Tokens in the measured request: system prompt plus every tool description. */
  promptTokens: number
  /** Time to the first token: a prompt the server has not seen, and the same prompt again (its prefix cached). */
  firstTokenColdMs: number
  firstTokenWarmMs: number
  /** Thinking tokens per reply with reasoning on — the cost added before the answer starts. */
  thinkingTokens: string
  /** True for a model that reasons whatever the setting says. */
  alwaysOn?: true
  /** What that thinking adds to one reply, in seconds. */
  thinkingSeconds: string
}

export const SPEED_ROWS: readonly SpeedRow[] = [
  {
    model: 'Gemma 4 31B',
    msPerToken: 32.7,
    tokensPerSecond: 31,
    promptTokens: 20_445,
    firstTokenColdMs: 3100,
    firstTokenWarmMs: 500,
    thinkingTokens: '430–490',
    thinkingSeconds: '14–16',
  },
  {
    model: 'GPT-OSS 120B',
    msPerToken: 4.5,
    tokensPerSecond: 222,
    promptTokens: 13_443,
    firstTokenColdMs: 1300,
    firstTokenWarmMs: 250,
    thinkingTokens: '50–190',
    alwaysOn: true,
    thinkingSeconds: '0.2–0.9',
  },
]
