/**
 * Reading a model list back: the ids, and the failure worth naming.
 *
 * Split out of `model-server.ts`, which re-exports every public name here.
 */

import type { ModelFailure } from './model-server-errors'
import { refused } from './model-server-errors'
import type { ModelResponse } from './model-server-protocol'
import { normaliseEndpoint, parse } from './model-server-protocol'

/**
 * The model ids a `/v1/models` response advertises, in the order given.
 *
 * vLLM serves one model and lists it; Ollama and LM Studio list everything they
 * have. So the first id is the sensible default and the rest are worth keeping —
 * a caller that wants to offer a choice has one, and a caller that does not
 * takes `[0]`.
 *
 * Written against the shape rather than a type, because "OpenAI-compatible" is
 * a claim each server makes about itself. Anything that is not a list of
 * objects with string `id`s comes back empty, and the caller reports that it
 * could not read the server rather than rendering `undefined` as a model name.
 */
export function readModelIds(payload: unknown): string[] {
  if (typeof payload !== 'object' || payload === null) return []

  /*
   * Two shapes, because Ollama's native endpoint answers differently from
   * everything else: `{models:[{model:'…'}]}` rather than `{data:[{id:'…'}]}`.
   * Both are read here rather than behind a dialect branch, because a list of
   * model names is a list of model names — and a caller that had to say which
   * spelling it expected would be one more place to get the pairing wrong.
   * Anthropic's `/v1/models` already uses the `data[].id` shape unchanged.
   */
  const data = (payload as { data?: unknown }).data
  if (Array.isArray(data)) {
    return data
      .map((entry) =>
        typeof entry === 'object' && entry !== null ? (entry as { id?: unknown }).id : undefined,
      )
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
  }

  const models = (payload as { models?: unknown }).models
  if (Array.isArray(models)) {
    return models
      .map((entry) =>
        typeof entry === 'object' && entry !== null
          ? (entry as { model?: unknown }).model
          : undefined,
      )
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
  }

  return []
}

/** What a `/v1/models` call came back with. */
export type ModelsResult = { ok: true; models: string[] } | ModelFailure

/**
 * The one mistake worth naming, because the server cannot name it for you.
 *
 * Typing the host without its `/v1` is by far the commonest way to get this
 * wrong, and every server answers it unhelpfully: vLLM 404s `/models` with
 * `{"error": "Not Found"}`, and a server behind a proxy answers 200 with an
 * index page. Both are true reports of what happened and neither points at the
 * missing three characters. Measured against a live vLLM stub — the 404 case is
 * what sent this back for a second pass.
 *
 * Only appended when the address really is missing it, so it never contradicts a
 * user who got that part right.
 */
const pathHint = (endpoint: string) =>
  /\/v\d+$/.test(normaliseEndpoint(endpoint))
    ? ''
    : ' Check the address ends in /v1 — that is the path an OpenAI-compatible server serves on.'

export function readModelsResponse(response: ModelResponse, endpoint: string): ModelsResult {
  if (!response.ok) {
    const fail = refused(response.status, response.text, response.retryAfter ?? null)
    return { ...fail, reason: fail.reason + pathHint(endpoint) }
  }
  const models = readModelIds(parse(response.text))
  if (models.length === 0) {
    return {
      ok: false,
      kind: 'malformed',
      reason: `That address answered, but not with a model list.${pathHint(endpoint)}`,
    }
  }
  return { ok: true, models }
}
