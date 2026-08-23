/**
 * The protocol, and the executor under it, against a real runtime.
 *
 * The host is the actual `createToolRuntime` over a real repository, not a fake:
 * what `tools/call` is being asked to prove is that a name off a wire reaches a
 * tool and changes the graph, and a fake host proves only that the fake was
 * called.
 */
import { describe, expect, it } from 'vitest'
import { MutableSnapshot } from '../core/snapshot'
import { createRepository } from '../repo/repository'
import { createToolRuntime } from '../tools/runtime'
import type { GraphSnapshot } from '../core/model'
import type { ToolName } from '../tools/index'
import { callTool, renderOutcome } from './execute'
import type { ToolHost } from './execute'
import { MCP_PROTOCOL_VERSION, handleMcp, mcpManifest } from './mcp'

const START = Date.parse('2026-08-22T09:00:00.000Z')

const nullDriver = () => ({
  open: async () => ({ ok: true as const, value: { version: 1, from: 0, migrated: [], crossTab: false } }),
  readAll: async () => ({ ok: true as const, value: { nodes: [], edges: [], meta: [], ops: [] } }),
  commit: async () => ({ ok: true as const, value: undefined }),
  replace: async () => ({ ok: true as const, value: undefined }),
  seedIfPristine: async () => ({ ok: true as const, value: true }),
  destroy: async () => ({ ok: true as const, value: undefined }),
  onRemoteCommit: () => () => {},
  onBlocking: () => () => {},
  close: () => {},
})

function host(): ToolHost & { memoryNow: () => GraphSnapshot } {
  let tick = 0
  const now = () => new Date(START + tick++ * 1000).toISOString()
  const repo = createRepository({
    driver: nullDriver() as Parameters<typeof createRepository>[0]['driver'],
    snapshot: new MutableSnapshot(),
    meta: {
      schemaVersion: 1,
      createdAt: new Date(START).toISOString(),
      lastOpenedAt: new Date(START).toISOString(),
      dataSet: 'empty',
      seededAt: null,
    },
    now,
  })
  const runtime = createToolRuntime({ repo, now })
  return {
    memory: () => repo.getSnapshot() as GraphSnapshot,
    memoryNow: () => repo.getSnapshot() as GraphSnapshot,
    check: (name, input) => runtime.check(name as ToolName, input) as never,
    run: (name, input) => runtime.run(name as ToolName, input as never) as never,
  }
}

const call = (h: ToolHost, name: string, args: unknown) =>
  handleMcp(h, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })

describe('handshake', () => {
  it('declares only the capabilities it implements', () => {
    // Declaring one it does not is how a client hangs waiting for a list that
    // never comes.
    const r = handleMcp(host(), { jsonrpc: '2.0', id: 1, method: 'initialize' })
    expect(r).toMatchObject({
      id: 1,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
      },
    })
    const caps = (r as { result: { capabilities: Record<string, unknown> } }).result.capabilities
    expect(Object.keys(caps)).toEqual(['tools'])
  })

  it('never answers a notification', () => {
    // JSON-RPC says a message with no id must not be replied to, and some
    // clients treat a reply as fatal.
    expect(handleMcp(host(), { jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull()
  })

  it('reports an unknown method as a protocol error', () => {
    const r = handleMcp(host(), { jsonrpc: '2.0', id: 7, method: 'resources/list' })
    expect(r).toMatchObject({ id: 7, error: { code: -32601 } })
  })
})

describe('tools/list', () => {
  it('lists every catalogued tool with a schema', () => {
    const r = handleMcp(host(), { jsonrpc: '2.0', id: 2, method: 'tools/list' }) as {
      result: { tools: { name: string; inputSchema: unknown }[] }
    }
    expect(r.result.tools.length).toBe(mcpManifest().tools.length)
    expect(r.result.tools.every((t) => t.inputSchema !== undefined)).toBe(true)
  })
})

describe('tools/call', () => {
  it('runs a write and actually changes the graph', () => {
    const h = host()
    const r = call(h, 'application_create', {
      org: 'UT Austin',
      role: 'Assistant professor, CS',
      roleTag: 'Assistant Professor',
      stage: 'submitted',
    }) as { result: { isError: boolean; content: { text: string }[] } }
    expect(r.result.isError).toBe(false)
    expect(h.memory().ofType('application')).toHaveLength(1)
    // The sentence the app's own toast would have shown, plus the new id.
    expect(r.result.content[0]?.text).toContain('id: ')
  })

  it('runs a read without touching anything', () => {
    const h = host()
    const r = call(h, 'memory_overview', {}) as { result: { content: { text: string }[] } }
    expect(JSON.parse(r.result.content[0]?.text ?? '{}')).toMatchObject({ total: 0 })
  })

  it('treats a tool refusing as a RESULT, not a JSON-RPC error', () => {
    // The call succeeded; the tool said no. The model has to see the reason as
    // content it can act on, not as a transport failure.
    const h = host()
    const r = call(h, 'application_create', { org: '', role: 'x' }) as {
      result: { isError: boolean; content: { text: string }[] }
      error?: unknown
    }
    expect(r.error).toBeUndefined()
    expect(r.result.isError).toBe(true)
    expect(r.result.content[0]?.text).toContain('Error:')
  })

  it('names the mistake when the tool does not exist', () => {
    const h = host()
    const r = call(h, 'application_summon', {}) as { result: { isError: boolean; content: { text: string }[] } }
    expect(r.result.isError).toBe(true)
    expect(r.result.content[0]?.text).toContain('application_summon')
  })

  it('accepts a call with no arguments key at all', () => {
    // Models routinely omit it for a tool that takes nothing, and `undefined`
    // fails an object parse that `{}` passes.
    const h = host()
    const r = handleMcp(h, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'memory_overview' },
    }) as { result: { isError: boolean } }
    expect(r.result.isError).toBe(false)
  })

  it('rejects a call with no name as a protocol error', () => {
    const r = handleMcp(host(), { jsonrpc: '2.0', id: 4, method: 'tools/call', params: {} })
    expect(r).toMatchObject({ error: { code: -32602 } })
  })
})

describe('the executor', () => {
  it('validates before running, so a bad argument never opens a transaction', () => {
    const h = host()
    const out = callTool(h, 'application.create', { org: 'X', role: 'Y', roleTag: 'Nope', stage: 'submitted' })
    expect(out.ok).toBe(false)
    expect(h.memory().nodes()).toHaveLength(0)
  })

  it('accepts either spelling of a name', () => {
    const h = host()
    expect(callTool(h, 'memory.overview', {}).ok).toBe(true)
    expect(callTool(h, 'memory_overview', {}).ok).toBe(true)
  })

  it('hands back an undo for a write, which is what makes an agent safe', () => {
    const h = host()
    const out = callTool(h, 'application.create', {
      org: 'Stripe',
      role: 'ML engineer',
      roleTag: 'ML Engineer',
      stage: 'submitted',
    })
    if (!out.ok) throw new Error('should have run')
    expect(typeof out.undo).toBe('function')
    out.undo?.()
    expect(h.memory().ofType('application')).toHaveLength(0)
  })

  it('announces a truncation rather than pretending the answer was complete', () => {
    const h = host()
    for (let i = 0; i < 40; i++) {
      h.run('application.create' as ToolName, {
        org: `Org ${String(i)} with a fairly long name to take up room`,
        role: 'Assistant professor of something with a long title',
        roleTag: 'Assistant Professor',
        stage: 'submitted',
      })
    }
    const out = callTool(h, 'memory.list', { type: 'application', limit: 200 })
    const text = renderOutcome(out, 500)
    expect(text).toContain('Truncated')
    expect(text).toContain('Narrow the search')
  })

  it('never throws, whatever it is handed', () => {
    const h = host()
    for (const args of [undefined, null, 'nonsense', 42, [], { wrong: true }]) {
      expect(() => callTool(h, 'application.update', args)).not.toThrow()
      expect(() => callTool(h, 'memory.get', args)).not.toThrow()
    }
  })
})

describe('the graph is only ever changed on purpose', () => {
  it('leaves it byte-identical after a whole read-only session', () => {
    const h = host()
    callTool(h, 'application.create', {
      org: 'UT Austin',
      role: 'Assistant professor, CS',
      roleTag: 'Assistant Professor',
      stage: 'submitted',
    })
    const before = JSON.stringify({ n: h.memory().nodes(), e: h.memory().edges() })
    handleMcp(h, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    call(h, 'memory_overview', {})
    call(h, 'memory_list', { type: 'application' })
    call(h, 'memory_search', { query: 'austin' })
    call(h, 'application_summon', {})
    expect(JSON.stringify({ n: h.memory().nodes(), e: h.memory().edges() })).toBe(before)
  })
})
