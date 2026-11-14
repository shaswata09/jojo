/**
 * The model servers a user has pointed this app at, and how to read one.
 *
 * Everything here is pure: URL arithmetic, response parsing, and the rules for
 * a saved list. The `fetch` that uses it lives in each app's `lib/`, because
 * `check-platform` bans the network from this layer and is right to — a domain
 * layer that can reach the network is one that can block, fail and leak.
 *
 * So the split is the usual one. The parts that can be wrong in an interesting
 * way are here and tested; the ten lines that call `fetch` are per-app and
 * boring by design.
 *
 * WHY A SAVED LIST AT ALL. A local model lives at a URL with a port, and the
 * port is the part nobody remembers — `:8000` for vLLM, `:11434` for Ollama,
 * `:1234` for LM Studio, and whatever was passed to `--port` on the day. Typing
 * it once per session is the friction that stops people connecting a model they
 * already have running.
 *
 * WHERE THE CODE LIVES. This file is the stable surface: every name it has
 * always exported is re-exported here, so no importer changes. The code is in
 * the modules beside it, one concern each —
 *
 *   - `model-server-protocol.ts`   URLs, `ModelRequest`/`ModelResponse`, `ChatMessage`
 *   - `model-server-saved.ts`      the saved list of servers
 *   - `model-server-errors.ts`     `ModelFailure` and the sentence for each failure
 *   - `model-server-thinking.ts`   thinking modes and the fields that carry them
 *   - `model-server-request.ts`    the model-list and chat requests, per dialect
 *   - `model-server-list.ts`       reading a model list back
 *   - `model-server-tools.ts`      tool calls off the wire
 *   - `model-server-turn.ts`       reading a chat turn back, per dialect
 *   - `model-server-truncation.ts` catching a server that read part of the prompt
 *   - `model-server-retry.ts`      `sendTurn`: asking again after an empty turn
 */

export { normaliseEndpoint, modelsUrl, chatUrl } from './model-server-protocol'

export type {
  ModelRequest,
  ModelResponse,
  WireToolCall,
  ChatMessage,
} from './model-server-protocol'

export {
  saveServer,
  serverId,
  renameServer,
  removeServer,
  serversFor,
  serverAt,
} from './model-server-saved'

export type { ModelServer } from './model-server-saved'

export {
  FAILURE_KINDS,
  MODEL_TIMEOUT_MS,
  emptyTurn,
  unreachable,
  stalled,
  unconfigured,
} from './model-server-errors'

export type { ModelFailure, FailureKind } from './model-server-errors'

export {
  THINKING_MODES,
  DEFAULT_THINKING,
  helperThinking,
  thinkingFields,
  sendsThinking,
} from './model-server-thinking'

export type { Thinking, ChatOptions } from './model-server-thinking'

export { modelsRequest, chatRequest } from './model-server-request'

export { readModelIds, readModelsResponse } from './model-server-list'

export type { ModelsResult } from './model-server-list'

export { cleanToolName } from './model-server-tools'

export type { ToolCall } from './model-server-tools'

export {
  readTurnFor,
  readOllamaTurn,
  readTurn,
  readReply,
  readChatResponse,
} from './model-server-turn'

export type { Usage, Turn, ChatResult } from './model-server-turn'

export {
  estimateTokens,
  TRUNCATION_RATIO,
  truncationOf,
  guardTruncation,
  truncationWarning,
} from './model-server-truncation'

export {
  EMPTY_TURN_ATTEMPTS,
  EMPTY_RETRY_BASE_MS,
  emptyRetryDelayMs,
  isEmptyTurn,
  rejectsThinking,
  sendTurn,
  exhaustedEmptyTurn,
} from './model-server-retry'

export type { Delay, TurnAttempt, SendTurnOptions } from './model-server-retry'

/*
 * `isConfigured` used to live here and asked two questions: is there an
 * endpoint, and is there a model. That was the whole of "configured" while
 * every provider was a URL the user typed. It is not any more — a cloud
 * provider has a fixed endpoint and needs a key — so the rule moved to
 * `provider.ts` next to the table it has to consult, and is re-exported here so
 * that callers importing it from the module that always had it keep working.
 *
 * Re-exported rather than reimplemented. Two functions with this name answering
 * slightly different questions is exactly the drift `check-no-copies` exists to
 * prevent and cannot see, because it compares files rather than exported names.
 */
export { isConfigured } from './provider'
