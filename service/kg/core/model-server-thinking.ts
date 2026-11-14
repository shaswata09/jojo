/**
 * The thinking mode, and what each provider is sent to carry it.
 *
 * Split out of `model-server.ts`, which re-exports every public name here.
 */

import { providerMeta } from './provider'

/* -------------------------------------------------------------------------- */
/* Thinking                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * How much the model should reason to itself before it answers.
 *
 * ## Why this is a setting at all
 *
 * Because on the models jojo is built for, thinking is not free and is often a
 * loss. Aider publishes recommended settings for Qwen3 that read
 * `enable_thinking: false`, temp 0.7, top_p 0.8, top_k 20 — the thinking-ON
 * configuration scored LOWER on its benchmark — and the gpt-oss report says HIGH
 * reasoning "frequently exceeded the 128k context". Neither is a claim about
 * intelligence; both are claims about a budget being spent somewhere other than
 * the answer.
 *
 * This app feels that spend twice over. Its prompts carry a tool catalogue, so
 * the input is already large, and its answers are short — so a model that thinks
 * for a thousand tokens before speaking hits the server's reply limit MID-THOUGHT
 * and returns a turn with no content and no tool call. That is not hypothetical:
 * it is `emptyTurn` (model-server-errors.ts), it is what `loop.ts`'s empty-reply
 * guard already blames by name ("Models that reason before they speak — Qwen3, GPT-OSS,
 * DeepSeek-R1 — do this when the server's reply limit is small"), and it is the
 * failure `sendTurn` (model-server-retry.ts) retries.
 *
 * ## The four modes
 *
 * `on` asks every model that can reason to do so: a template switch for the
 * models that have one (Gemma 4, Qwen3) and a medium effort for gpt-oss. `low`
 * asks for as little as a model will do while still reasoning. `off` asks the
 * server not to think — which gpt-oss cannot honour; it always reasons.
 * `server-default` sends nothing at all and is the honest escape hatch:
 * whatever the deployment was configured with stands.
 */
export const THINKING_MODES = ['on', 'low', 'off', 'server-default'] as const

export type Thinking = (typeof THINKING_MODES)[number]

/**
 * On, since 2026-10-22, and the reasons above for `off` were measured on a
 * different setup from the one this app now runs on.
 *
 * They were Qwen3 14B behind a small reply limit, where thinking spent the
 * budget before the answer. The deployments in use now are Gemma 4 31B and
 * gpt-oss 120B on vLLM with a 32k window and no reply cap — measured against
 * both: with reasoning on, Gemma thinks ~70–400 tokens before the same tool call
 * it made without, in under two seconds; gpt-oss was ALREADY reasoning at medium
 * effort, because `off` was only ever a template switch it does not read. So
 * the old default turned reasoning off for exactly one of the two models, and it
 * was the one that could use it.
 *
 * The blank-reply failure is still real for a small model behind a small limit,
 * which is why this stays a setting: Settings → Model → Reasoning, stored on
 * `ModelSettings.thinking`, and the empty-reply error names it.
 */
export const DEFAULT_THINKING: Thinking = 'on'

/**
 * The thinking mode for the HELPER calls — the tool chooser and the summariser
 * that compacts a long conversation — given the mode the person chose.
 *
 * Off whenever the person's mode would send anything. Measured 2026-10-22 on
 * Gemma 4 with reasoning on: one summariser call took 1 minute 45 seconds to
 * return 208 characters, because it reasoned at length over a mechanical job,
 * and the endurance conversations compact on nearly every turn. Choosing tools
 * and summarising are far easier than the work itself; the reasoning belongs
 * on the agent's own turns. `server-default` stays as it is: that mode means
 * "send nothing", and this must not start sending something.
 */
export const helperThinking = (mode: Thinking): Thinking => (mode === 'server-default' ? mode : 'off')

/** What else a caller may say about a chat request. */
export type ChatOptions = {
  /** Defaults to `DEFAULT_THINKING`. See `thinkingFields` for what is sent. */
  readonly thinking?: Thinking
}

/**
 * The body fields that carry a thinking mode to THIS provider, or none.
 *
 * Every server spells it differently, which is why this is a table and not a
 * constant:
 *
 *   - **Ollama native** takes a top-level `think`, boolean or an effort word.
 *     Its OpenAI shim takes nothing — it discards keys it does not know — which
 *     is the same reason `ollamaChatRequest` exists at all.
 *   - **vLLM, SGLang, LM Studio and llama.cpp** pass `chat_template_kwargs`
 *     straight into the model's own Jinja chat template, and `enable_thinking`
 *     is the variable Qwen3's template reads. A template that does not know the
 *     name ignores it: an unused kwarg is not an error in Jinja.
 *   - **gpt-oss** has no off switch; its template reads `reasoning_effort`, so
 *     `low` sets that instead of pretending `false` will be honoured.
 *
 * ## Why nothing is sent to a cloud provider
 *
 * Not an oversight, and not laziness — it is the difference between a request
 * that works and a 400. OpenAI's API rejects an unrecognised body field outright
 * ("Unrecognized request argument supplied"), and a self-hosted server ignoring
 * one is a courtesy rather than a rule. Sending a knob that only a local
 * inference server understands to a hosted API would turn a working setup into a
 * failing one for a benefit those providers do not offer anyway: Anthropic's
 * extended thinking is opt-IN and jojo never opts in, so on that dialect
 * "thinking off" is already true, and it is why the Anthropic branch of
 * `chatRequest` passes nothing.
 *
 * The gate is `cloud`, a fact the provider table already states, rather than a
 * new list to keep in step with it.
 */
export function thinkingFields(
  provider: string,
  thinking: Thinking = DEFAULT_THINKING,
): Record<string, unknown> {
  if (thinking === 'server-default') return {}
  const meta = providerMeta(provider)

  if (meta.dialect === 'ollama') {
    /*
     * `false` rather than the string 'off': native takes a boolean here, and an
     * effort word only where the model has efforts to choose between.
     *
     * NOT VERIFIED AGAINST A LIVE OLLAMA — there is none on the machine this was
     * written on — and the failure mode if a build rejects `think` on a model
     * with no thinking capability is a 400 naming it. That is precisely what
     * `rejectsThinking` reads and what `sendTurn` recovers from by re-asking
     * without the field, so the cost of being wrong here is one round trip
     * rather than a provider that cannot be used.
     */
    return { think: thinking === 'off' ? false : thinking === 'on' ? true : 'low' }
  }

  if (meta.dialect === 'openai' && !meta.cloud) {
    /*
     * Two fields, because the two model families listen in different places —
     * measured on vLLM 2026-10-22:
     *
     *   - Gemma 4 and Qwen3 switch thinking with `enable_thinking`, which only
     *     reaches them through `chat_template_kwargs`.
     *   - gpt-oss reads `reasoning_effort` from the TOP LEVEL. Put inside
     *     `chat_template_kwargs` it is ignored: low, medium and high all gave
     *     the same ~400 characters of reasoning there, so the `low` this used to
     *     send did nothing at all. At the top level, high was three times
     *     medium.
     *
     * Each family ignores the other's field — Gemma answered 200 to a top-level
     * `reasoning_effort` — so both go on every request.
     */
    if (thinking === 'off') return { chat_template_kwargs: { enable_thinking: false } }
    return {
      reasoning_effort: thinking === 'on' ? 'medium' : 'low',
      chat_template_kwargs: { enable_thinking: true },
    }
  }

  return {}
}

/**
 * Whether a mode actually puts anything on the wire for this provider.
 *
 * Exists for `sendTurn`, which must not "recover" by re-sending a request that
 * was identical the first time: on a cloud provider `off` and `server-default`
 * build the same body, so a refusal that happens to mention thinking is about
 * something else.
 */
export const sendsThinking = (provider: string, thinking: Thinking): boolean =>
  Object.keys(thinkingFields(provider, thinking)).length > 0
