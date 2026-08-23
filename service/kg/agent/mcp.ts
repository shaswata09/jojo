/**
 * L3 — the Model Context Protocol, as a pure function from request to response.
 *
 * MCP is JSON-RPC 2.0 over some transport. The protocol is the part with rules
 * worth testing; the transport is a socket, a pipe, or — here — a function call
 * inside the same process. Keeping them apart is what lets this be tested
 * without either, and is the same split `model-server.ts` makes for the LLM
 * client: `check-platform` bans the network from this layer, so the protocol is
 * data and whoever carries it lives in the app.
 *
 * WHY AN IN-PROCESS MCP SERVER IS NOT A CONTRADICTION. There is no daemon here
 * and no port: jojo is a browser tab and a phone app, and a local-first app that
 * opened a listening socket would be a different promise. What MCP buys without
 * a socket is the interface — one tool list, one call shape, one error
 * convention, generated from the registry rather than written twice. `handle`
 * below is a complete server; giving it a stdio or HTTP transport later is
 * twenty lines in a host that is allowed to have one, and nothing in here
 * changes.
 *
 * The `isError` convention is the part people get wrong. A tool that refuses is
 * NOT a JSON-RPC error: the call succeeded, the tool said no, and the model has
 * to see the reason as content it can act on. JSON-RPC errors are reserved for
 * the protocol going wrong — unknown method, malformed request — which is a bug
 * in the client rather than something a model can recover from.
 */

import { mcpSpecs } from './catalog'
import { callTool, renderOutcome } from './execute'
import type { ToolHost } from './execute'

/** The revision this speaks. Sent back on initialize so a client can refuse. */
export const MCP_PROTOCOL_VERSION = '2025-06-18'

export const MCP_SERVER_INFO = {
  name: 'jojo',
  title: 'jojo — your job search, on your device',
  version: '1',
} as const

export type JsonRpcId = string | number | null

export type McpRequest = {
  jsonrpc: '2.0'
  id?: JsonRpcId
  method: string
  params?: unknown
}

export type McpResponse =
  | { jsonrpc: '2.0'; id: JsonRpcId; result: unknown }
  | { jsonrpc: '2.0'; id: JsonRpcId; error: { code: number; message: string } }

/** JSON-RPC's reserved codes. Only the three that can actually happen here. */
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602
const INVALID_REQUEST = -32600

const ok = (id: JsonRpcId, result: unknown): McpResponse => ({ jsonrpc: '2.0', id, result })
const err = (id: JsonRpcId, code: number, message: string): McpResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
})

/**
 * Handles one message.
 *
 * Returns `null` for a notification — a message with no `id`, which JSON-RPC
 * says must not be answered. `notifications/initialized` is the one that
 * actually arrives, and answering it is a protocol violation that some clients
 * treat as fatal.
 */
export function handleMcp(host: ToolHost, request: unknown): McpResponse | null {
  if (typeof request !== 'object' || request === null) {
    return err(null, INVALID_REQUEST, 'Request must be a JSON-RPC object.')
  }
  const { id = null, method, params } = request as McpRequest
  if (typeof method !== 'string') {
    return err(id, INVALID_REQUEST, 'Request is missing a method.')
  }

  // Notifications carry no id and get no reply, whatever they say.
  const isNotification = !('id' in (request as object)) || (request as McpRequest).id === undefined
  if (method.startsWith('notifications/')) return isNotification ? null : ok(id, {})

  switch (method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        // Only what is true. No prompts, no resources, no sampling — declaring a
        // capability this server does not implement is how a client hangs
        // waiting for a list that never comes.
        capabilities: { tools: { listChanged: false } },
        serverInfo: MCP_SERVER_INFO,
        instructions:
          'Every record lives on this device. Read before you write: most tools need the id of an existing record, and memory.overview then memory.search is the cheapest way to find one.',
      })

    case 'ping':
      return ok(id, {})

    case 'tools/list':
      // No cursor: sixty-four tools is one page, and paginating a list that
      // never grows past a screen is a second code path with no second caller.
      return ok(id, { tools: mcpSpecs() })

    case 'tools/call': {
      const p = params as { name?: unknown; arguments?: unknown } | undefined
      if (!p || typeof p.name !== 'string') {
        return err(id, INVALID_PARAMS, 'tools/call needs a string `name`.')
      }
      const outcome = callTool(host, p.name, p.arguments)
      // A refusal is a RESULT, not a JSON-RPC error. The call succeeded; the
      // tool said no, and the model has to see why as content it can act on.
      return ok(id, {
        content: [{ type: 'text', text: renderOutcome(outcome) }],
        isError: !outcome.ok,
      })
    }

    default:
      return err(id, METHOD_NOT_FOUND, `This server does not implement ${method}.`)
  }
}

/**
 * The manifest a client would fetch, as a value.
 *
 * Exported separately because it is useful without the protocol: a settings
 * screen that wants to show "sixty-four tools are exposed" should not have to
 * hand-roll a JSON-RPC request to find out.
 */
export const mcpManifest = () => ({
  protocolVersion: MCP_PROTOCOL_VERSION,
  serverInfo: MCP_SERVER_INFO,
  tools: mcpSpecs(),
})
