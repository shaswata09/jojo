import { afterEach, describe, expect, it } from 'vitest'
import type { ToolHost } from '@jojo/service/agent/execute'
import { MCP_PROTOCOL_VERSION, mcpAllowed, mcpManifest } from '@jojo/service/agent/mcp'
import { MutableSnapshot } from '@jojo/service/core/snapshot'
import type { GraphSnapshot } from '@jojo/service/core/snapshot'
import { createRepository } from '@jojo/service/repo/repository'
import { createToolRuntime } from '@jojo/service/tools/runtime'
import type { ToolName } from '@jojo/service/tools/index'
import { createBridge } from '../../public/jojo-bridge.mjs'
import { directTransport, runLink } from './mcp-link'
import type { LinkStatus } from './mcp-link'

/**
 * THE JOINED PATH: a client, the real bridge, the real tab loop, a real graph.
 *
 * Each piece has its own tests — the protocol in `mcp.test.ts`, the bridge in
 * `jojo-bridge.test.ts` — and none of them can see what this can: that the
 * pieces agree. The bridge hands the tab `{ seq, message }` and the tab has to
 * read exactly that; the tab posts `{ seq, response }` back and the bridge has
 * to match it to the request still waiting; the policy has to hold at the far
 * end of all of it. Two correct halves that disagree about a field name pass
 * every unit test and fail here, which is the reason this file exists.
 *
 * Nothing is mocked but the storage driver. The client is `fetch`, speaking
 * JSON-RPC the way Claude Code does over streamable HTTP.
 */

/*
 * `tsconfig.app.json` grants no Node types — see `bench-payload.test.ts`.
 * Only `createServer` is used, so only that is typed.
 */
type NodeServer = {
  listen: (port: number, host: string, done: () => void) => void
  address: () => { port: number } | string | null
  close: (done?: () => void) => void
  closeAllConnections: () => void
}
// @ts-expect-error TS2307 — node:http has no types under tsconfig.app.json; the socket is the whole point of this test.
const http = (await import('node:http')) as {
  createServer: (handler: (req: unknown, res: unknown) => void) => NodeServer
}

const TOKEN = 't'.repeat(43)
const START = Date.parse('2026-09-11T09:00:00.000Z')

const nullDriver = () => ({
  open: async () => ({
    ok: true as const,
    value: { version: 1, from: 0, migrated: [], crossTab: false },
  }),
  readAll: async () => ({ ok: true as const, value: { nodes: [], edges: [], meta: [], ops: [] } }),
  commit: async () => ({ ok: true as const, value: undefined }),
  replace: async () => ({ ok: true as const, value: undefined }),
  seedIfPristine: async () => ({ ok: true as const, value: true }),
  destroy: async () => ({ ok: true as const, value: undefined }),
  onRemoteCommit: () => () => {},
  onBlocking: () => () => {},
  close: () => {},
})

/** The graph the tab would hold — a real repository and runtime over an empty store. */
function tabHost(): ToolHost {
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
      handoverAt: null,
    },
    now,
  })
  const runtime = createToolRuntime({ repo, now })
  return {
    memory: () => repo.getSnapshot() as GraphSnapshot,
    today: () => '2026-09-11',
    check: (name, input) => runtime.check(name as ToolName, input) as never,
    run: (name, input) => runtime.run(name as ToolName, input as never) as never,
  }
}

const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((stop) => stop()))
})

/** A bridge on a spare port, and a tab linked to it. */
async function world({ token = TOKEN, attachWaitMs = 2_000 } = {}) {
  let handler: (req: unknown, res: unknown) => void = () => {}
  const server = http.createServer((req, res) => {
    handler(req, res)
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port was bound')
  const port = address.port
  const bridge = createBridge({ token: TOKEN, port, pollMs: 250, attachWaitMs, replyWaitMs: 3_000 })
  handler = bridge.handle

  const host = tabHost()
  const statuses: LinkStatus[] = []
  const served: string[] = []
  const controller = new AbortController()
  const linked = runLink({
    address: `http://127.0.0.1:${String(port)}`,
    token,
    transport: directTransport(),
    host,
    allow: mcpAllowed,
    signal: controller.signal,
    onStatus: (status) => statuses.push(status),
    onServed: (method) => served.push(method),
    // Retries in milliseconds rather than seconds; the backoff itself is not under test.
    wait: () => new Promise((resolve) => setTimeout(resolve, 10)),
  })

  cleanups.push(async () => {
    controller.abort()
    await linked
    server.closeAllConnections()
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
  })
  return { port, host, statuses, served, controller, linked, bridge }
}

/** What Claude Code does: one JSON-RPC message per POST, a bearer token, no Origin. */
async function client(port: number, message: object) {
  const response = await fetch(`http://127.0.0.1:${String(port)}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(message),
  })
  return {
    status: response.status,
    body: (response.status === 202 ? null : await response.json()) as {
      result?: Record<string, unknown>
      error?: { message: string }
    } | null,
  }
}

/** Waits for something the loop will get to, rather than sleeping a guessed amount. */
async function until(check: () => boolean, ms = 10_000) {
  const deadline = Date.now() + ms
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

const call = (id: number, name: string, args: unknown = {}) => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name, arguments: args },
})

const textOf = (body: { result?: Record<string, unknown> } | null) =>
  ((body?.result?.['content'] as { text: string }[] | undefined)?.[0]?.text ?? '')

describe('a Claude Code session, end to end', () => {
  it('answers the handshake, the tool list and real calls against the live graph', async () => {
    const { port, host, statuses, served } = await world()
    await until(() => statuses.some((s) => s.state === 'ready'))

    const hello = await client(port, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    expect(hello.body?.result?.['protocolVersion']).toBe(MCP_PROTOCOL_VERSION)

    // The notification never reaches the tab: the bridge answers it.
    expect((await client(port, { jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202)

    const listed = await client(port, { jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const names = ((listed.body?.result?.['tools'] ?? []) as { name: string }[]).map((t) => t.name)
    expect(names).toHaveLength(mcpManifest().tools.length - 2)
    expect(names).not.toContain('memory_reset')
    expect(names).toContain('application_delete')

    const created = await client(
      port,
      call(3, 'application_create', {
        org: 'Rice University',
        role: 'Assistant professor, CS',
        roleTag: 'Assistant Professor',
        stage: 'submitted',
      }),
    )
    expect(created.body?.result?.['isError']).toBe(false)
    // The write landed in the tab's graph — which is the whole feature.
    expect(host.memory().ofType('application')).toHaveLength(1)

    const overview = await client(port, call(4, 'memory_overview'))
    expect(JSON.parse(textOf(overview.body))).toMatchObject({ total: expect.any(Number) })

    expect(served).toEqual(['initialize', 'tools/list', 'tools/call', 'tools/call'])
  })

  it('holds the policy at the far end of the wire', async () => {
    /*
     * The tool is not in the list the client saw, and a client can send its name
     * anyway. The refusal has to come from the tab, not from the list.
     */
    const { port, host } = await world()
    await client(
      port,
      call(1, 'application_create', {
        org: 'Stripe',
        role: 'ML engineer',
        roleTag: 'ML Engineer',
        stage: 'submitted',
      }),
    )
    const reset = await client(port, call(2, 'memory_reset'))
    expect(reset.body?.result?.['isError']).toBe(true)
    expect(textOf(reset.body)).toContain('not available')
    expect(host.memory().ofType('application')).toHaveLength(1)
  })
})

describe('what the tab says about the link', () => {
  it('reports a bridge that is not running, and keeps looking', async () => {
    const statuses: LinkStatus[] = []
    const controller = new AbortController()
    // Port 9 is discard, which nothing on a test machine answers.
    const linked = runLink({
      address: 'http://127.0.0.1:9',
      token: TOKEN,
      transport: directTransport(),
      host: tabHost(),
      signal: controller.signal,
      onStatus: (status) => statuses.push(status),
      wait: () => new Promise((resolve) => setTimeout(resolve, 10)),
    })
    await until(() => statuses.filter((s) => s.state === 'searching').length >= 3)
    controller.abort()
    await linked
    expect(statuses.every((s) => s.state === 'searching')).toBe(true)
  })

  it('does not accuse the extension of being missing over one dropped poll', async () => {
    /*
     * An MV3 service worker is evicted when idle and the poll that wakes it can
     * miss. Reported at once, that showed "Needs the extension" on a page whose
     * extension was working and whose bridge was printing "jojo connected" —
     * which is how somebody came to debug a link that was already up.
     */
    const statuses: LinkStatus[] = []
    const controller = new AbortController()
    let calls = 0
    const linked = runLink({
      address: 'http://127.0.0.1:9',
      token: TOKEN,
      host: tabHost(),
      signal: controller.signal,
      onStatus: (status) => statuses.push(status),
      wait: () => new Promise((resolve) => setTimeout(resolve, 5)),
      transport: async () => {
        calls += 1
        // One miss, then the bridge answers as usual.
        return calls === 1
          ? { failed: { kind: 'absent' as const, reason: 'no answer' } }
          : { ok: true, status: 204, text: '' }
      },
    })
    await until(() => statuses.some((s) => s.state === 'ready'))
    controller.abort()
    await linked
    expect(statuses.map((s) => s.state)).not.toContain('no-extension')
  })

  it('names the extension once the miss repeats', async () => {
    const statuses: LinkStatus[] = []
    const controller = new AbortController()
    const linked = runLink({
      address: 'http://127.0.0.1:9',
      token: TOKEN,
      host: tabHost(),
      signal: controller.signal,
      onStatus: (status) => statuses.push(status),
      wait: () => new Promise((resolve) => setTimeout(resolve, 5)),
      transport: async () => ({ failed: { kind: 'absent' as const, reason: 'no answer' } }),
    })
    await until(() => statuses.some((s) => s.state === 'no-extension'))
    controller.abort()
    await linked
  })

  it('reports a token the bridge refuses', async () => {
    const { statuses } = await world({ token: 'x'.repeat(43) })
    await until(() => statuses.some((s) => s.state === 'bad-token'))
  })

  /*
   * The generous timeout is not padding. This one waits on three real clocks in
   * series — a poll to be answered, a socket close to be noticed, then the
   * bridge's attach budget — and it failed once in a full-suite run while
   * passing every time on its own. A time-sensitive test that is only reliable
   * when the machine is idle reports load as a defect.
   */
  it('stops when switched off, and the client is told jojo is not connected', async () => {
    const { port, statuses, controller, linked, bridge } = await world({ attachWaitMs: 300 })
    await until(() => statuses.some((s) => s.state === 'ready'))
    controller.abort()
    await linked
    /*
     * Once the bridge has SEEN the poll go. Asking before then is the orphan
     * window the bridge's header describes: a request can reach a poll the tab
     * has already let go of. The bridge now skips a poll whose connection is
     * gone rather than handing it work, and this waits for that to be the
     * state rather than racing it.
     */
    await until(() => !bridge.state().polling)
    const after = await client(port, { jsonrpc: '2.0', id: 9, method: 'tools/list' })
    expect(after.body?.error?.message).toContain('not connected')
  }, 20_000)
})
