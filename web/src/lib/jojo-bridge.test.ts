import { afterEach, describe, expect, it } from 'vitest'
import {
  createBridge,
  isLoopbackHost,
  isLoopbackOrigin,
  tokenMatches,
} from '../../public/jojo-bridge.mjs'

/**
 * `jojo-bridge`, over real HTTP on a spare port.
 *
 * Real sockets rather than a fake request object, because every rule worth
 * testing here is about what arrives on the wire: the Host header, the Origin
 * header, the bearer token, a poll held open across time. A fake would test the
 * fake's idea of HTTP.
 *
 * Timeouts are shortened to milliseconds through `createBridge`'s options. The
 * production numbers are about people and browsers; the logic is the same.
 */

/*
 * `tsconfig.app.json` grants no Node types — see `bench-payload.test.ts`, which
 * does the same for `node:fs`. Typed by hand below, with only what this uses.
 */
type Incoming = {
  statusCode?: number
  headers: Record<string, string | string[] | undefined>
  on: (event: string, listener: (chunk?: Uint8Array) => void) => void
}
type NodeServer = {
  listen: (port: number, host: string, done: () => void) => void
  address: () => { port: number } | string | null
  close: (done?: () => void) => void
  closeAllConnections: () => void
}
type NodeHttp = {
  createServer: (handler: (req: unknown, res: unknown) => void) => NodeServer
  request: (
    options: {
      host: string
      port: number
      method: string
      path: string
      headers: Record<string, string>
    },
    onResponse: (res: Incoming) => void,
  ) => { on: (event: 'error', listener: (e: Error) => void) => void; end: (body?: string) => void }
}
// @ts-expect-error TS2307 — node:http has no types under tsconfig.app.json; the socket is the whole point of these tests.
const http = (await import('node:http')) as NodeHttp

const TOKEN = 'k'.repeat(43)
const AUTH = { authorization: `Bearer ${TOKEN}` }

type Reply = { status: number; headers: Record<string, string | string[] | undefined>; text: string }
type Started = { port: number; bridge: ReturnType<typeof createBridge>; stop: () => Promise<void> }

const running: Started[] = []

afterEach(async () => {
  await Promise.all(running.splice(0).map((s) => s.stop()))
})

async function start(
  options: Partial<Omit<Parameters<typeof createBridge>[0], 'token' | 'port'>> = {},
): Promise<Started> {
  let handler: (req: unknown, res: unknown) => void = () => {}
  const server = http.createServer((req, res) => {
    handler(req, res)
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port was bound')
  const bridge = createBridge({
    token: TOKEN,
    port: address.port,
    pollMs: 300,
    attachWaitMs: 200,
    replyWaitMs: 400,
    ...options,
  })
  handler = bridge.handle
  const started: Started = {
    port: address.port,
    bridge,
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => {
          resolve()
        })
      }),
  }
  running.push(started)
  return started
}

/** One HTTP request with full control of the headers — `fetch` will not set Host or Origin. */
function raw(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: { host: `127.0.0.1:${String(port)}`, ...headers },
      },
      (res) => {
        const chunks: Uint8Array[] = []
        res.on('data', (chunk) => {
          if (chunk !== undefined) chunks.push(chunk)
        })
        res.on('end', () => {
          const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
          let at = 0
          for (const c of chunks) {
            all.set(c, at)
            at += c.length
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text: new TextDecoder().decode(all) })
        })
      },
    )
    req.on('error', reject)
    req.end(body)
  })
}

const rpc = (id: number | undefined, method: string, params?: unknown) =>
  JSON.stringify({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, ...(params === undefined ? {} : { params }) })

const ask = (port: number, body: string) =>
  raw(port, 'POST', '/mcp', { ...AUTH, 'content-type': 'application/json' }, body)

const poll = async (port: number, headers: Record<string, string> = {}) => {
  const reply = await raw(port, 'GET', '/tab/next', { ...AUTH, ...headers })
  return {
    ...reply,
    handed: reply.status === 200 ? (JSON.parse(reply.text) as { seq: number; message: { id: number; method: string } }) : null,
  }
}

const answer = (port: number, seq: number, response: unknown) =>
  raw(port, 'POST', '/tab/reply', { ...AUTH, 'content-type': 'application/json' }, JSON.stringify({ seq, response }))

/* ---------------------------------------------------------------------------- */

describe('the checks, on their own', () => {
  it('accepts the exact token and nothing near it', () => {
    expect(tokenMatches(TOKEN, `Bearer ${TOKEN}`)).toBe(true)
    expect(tokenMatches(TOKEN, `Bearer ${'j'.repeat(43)}`)).toBe(false)
    expect(tokenMatches(TOKEN, `Bearer ${TOKEN}x`)).toBe(false)
    expect(tokenMatches(TOKEN, TOKEN)).toBe(false)
    expect(tokenMatches(TOKEN, undefined)).toBe(false)
    // A bridge started with no token must not treat "no token" as a match.
    expect(tokenMatches('', 'Bearer ')).toBe(false)
  })

  it('answers only to names for this machine, on its own port', () => {
    expect(isLoopbackHost('127.0.0.1:3002', 3002)).toBe(true)
    expect(isLoopbackHost('localhost:3002', 3002)).toBe(true)
    expect(isLoopbackHost('LOCALHOST:3002', 3002)).toBe(true)
    expect(isLoopbackHost('[::1]:3002', 3002)).toBe(true)
    // DNS rebinding: a page's own hostname resolved to 127.0.0.1.
    expect(isLoopbackHost('evil.example:3002', 3002)).toBe(false)
    expect(isLoopbackHost('127.0.0.1:3003', 3002)).toBe(false)
    expect(isLoopbackHost('127.0.0.1', 3002)).toBe(false)
    expect(isLoopbackHost(undefined, 3002)).toBe(false)
  })

  it('lets only a loopback page call the tab side directly', () => {
    expect(isLoopbackOrigin('http://localhost:5173')).toBe(true)
    expect(isLoopbackOrigin('http://127.0.0.1:5173')).toBe(true)
    // The hosted site goes through the extension, which needs no CORS entry.
    expect(isLoopbackOrigin('https://shaswata09.github.io')).toBe(false)
    expect(isLoopbackOrigin('http://evil.example')).toBe(false)
    expect(isLoopbackOrigin('null')).toBe(false)
    expect(isLoopbackOrigin(undefined)).toBe(false)
  })
})

describe('who may call the client side', () => {
  it('refuses a request naming another host, before looking at the token', async () => {
    const { port } = await start()
    const r = await raw(port, 'POST', '/mcp', { ...AUTH, host: `evil.example:${String(port)}` }, rpc(1, 'ping'))
    expect(r.status).toBe(421)
  })

  it('refuses anything a browser sent, even with the right token', async () => {
    /*
     * Browsers always send Origin and MCP clients never do. A page that had
     * somehow learned the token still cannot drive the bridge — and the
     * sequence it would try, preflight then POST, fails at the first step.
     */
    const { port } = await start()
    const r = await raw(port, 'POST', '/mcp', { ...AUTH, origin: 'https://evil.example' }, rpc(1, 'ping'))
    expect(r.status).toBe(403)
    expect((await raw(port, 'OPTIONS', '/mcp', { origin: 'https://evil.example' })).status).toBe(403)
  })

  it('refuses a wrong token', async () => {
    const { port } = await start()
    const r = await raw(port, 'POST', '/mcp', { authorization: 'Bearer nope' }, rpc(1, 'ping'))
    expect(r.status).toBe(401)
  })

  it('offers no server stream', async () => {
    const { port } = await start()
    expect((await raw(port, 'GET', '/mcp', AUTH)).status).toBe(405)
  })

  it('accepts a notification without troubling the tab', async () => {
    const { port, bridge } = await start()
    const r = await ask(port, rpc(undefined, 'notifications/initialized'))
    expect(r.status).toBe(202)
    expect(r.text).toBe('')
    expect(bridge.state().queued).toBe(0)
  })

  it('refuses what is not one JSON-RPC message', async () => {
    const { port } = await start()
    expect((await ask(port, '{not json')).status).toBe(400)
    // MCP dropped batching in 2025-06-18; an array is not a message.
    expect((await ask(port, `[${rpc(1, 'ping')}]`)).status).toBe(400)
  })
})

describe('a request, handed to the tab and answered', () => {
  it('carries the message to the tab and the answer back', async () => {
    const { port } = await start()
    const polled = poll(port)
    const asked = ask(port, rpc(1, 'tools/list'))

    const { handed } = await polled
    expect(handed?.message).toMatchObject({ id: 1, method: 'tools/list' })

    const response = { jsonrpc: '2.0', id: 1, result: { tools: [] } }
    expect((await answer(port, handed?.seq ?? -1, response)).status).toBe(204)

    const r = await asked
    expect(r.status).toBe(200)
    expect(JSON.parse(r.text)).toEqual(response)
  })

  it('holds a request that arrives first until a tab polls for it', async () => {
    const { port } = await start({ attachWaitMs: 1_000 })
    const asked = ask(port, rpc(2, 'ping'))
    const { handed } = await poll(port)
    expect(handed?.message.method).toBe('ping')
    await answer(port, handed?.seq ?? -1, { jsonrpc: '2.0', id: 2, result: {} })
    expect((await asked).status).toBe(200)
  })

  it('says jojo is not connected when no tab ever comes', async () => {
    const { port } = await start()
    const r = await ask(port, rpc(3, 'tools/list'))
    // A JSON-RPC error inside a 200, which is what a client shows the person.
    expect(r.status).toBe(200)
    expect(JSON.parse(r.text)).toMatchObject({ id: 3, error: { message: expect.stringContaining('not connected') } })
  })

  it('says so when the tab took the request and never answered', async () => {
    const { port } = await start()
    const polled = poll(port)
    const asked = ask(port, rpc(4, 'tools/list'))
    await polled
    const r = await asked
    expect(JSON.parse(r.text)).toMatchObject({ id: 4, error: { message: expect.stringContaining('did not answer') } })
  })

  it('drops a reply for a request that has already been answered', async () => {
    const { port } = await start()
    const polled = poll(port)
    const asked = ask(port, rpc(5, 'ping'))
    const { handed } = await polled
    await asked // timed out
    expect((await answer(port, handed?.seq ?? -1, { jsonrpc: '2.0', id: 5, result: {} })).status).toBe(204)
  })

  it('lets the last tab to attach win', async () => {
    // Two open tabs settle without either being told anything: the earlier
    // poll gets an empty answer and the later one gets the work.
    const { port } = await start({ attachWaitMs: 1_000 })
    const first = poll(port)
    await new Promise((resolve) => setTimeout(resolve, 30))
    const second = poll(port)
    expect((await first).status).toBe(204)

    const asked = ask(port, rpc(6, 'ping'))
    const { handed } = await second
    expect(handed?.message.id).toBe(6)
    await answer(port, handed?.seq ?? -1, { jsonrpc: '2.0', id: 6, result: {} })
    await asked
  })

  it('answers an idle poll with nothing, and counts the tab as attached', async () => {
    const { port, bridge } = await start()
    expect((await poll(port)).status).toBe(204)
    expect(bridge.state().attached).toBe(true)
  })
})

describe('the tab side, from the development server', () => {
  it('answers a loopback preflight and names the private-network allowance', async () => {
    const { port } = await start()
    const r = await raw(port, 'OPTIONS', '/tab/next', { origin: 'http://localhost:5173' })
    expect(r.status).toBe(204)
    expect(r.headers['access-control-allow-origin']).toBe('http://localhost:5173')
    expect(r.headers['access-control-allow-private-network']).toBe('true')
  })

  it('refuses a preflight from anywhere else', async () => {
    const { port } = await start()
    expect((await raw(port, 'OPTIONS', '/tab/next', { origin: 'https://evil.example' })).status).toBe(403)
  })

  it('hands work to a development-server tab with the header its browser needs to read it', async () => {
    /*
     * THE BUG the real Claude Code found, on its first connection.
     *
     * A tab on the development server calls the bridge across origins, so its
     * browser lets it read a response only if the response names its origin.
     * The idle answers did — which is why the link read "connected" — and the
     * one answer that carried work did not. The browser threw that answer
     * away, the request it held was lost, and Claude Code's health check timed
     * out at thirty seconds.
     *
     * Every other test here polls from Node, whose `fetch` does not enforce
     * CORS, so none of them could see it. This asserts the header itself, on
     * the answer that matters.
     */
    const { port } = await start({ attachWaitMs: 1_000 })
    const polled = poll(port, { origin: 'http://localhost:5173' })
    const asked = ask(port, rpc(7, 'initialize'))
    const reply = await polled
    expect(reply.status).toBe(200)
    expect(reply.headers['access-control-allow-origin']).toBe('http://localhost:5173')
    await answer(port, reply.handed?.seq ?? -1, { jsonrpc: '2.0', id: 7, result: {} })
    await asked
  })

  it('needs the token on the tab side too', async () => {
    const { port } = await start()
    expect((await raw(port, 'GET', '/tab/next', {})).status).toBe(401)
  })
})
