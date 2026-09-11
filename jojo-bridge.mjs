#!/usr/bin/env node
/**
 * jojo-bridge — lets an MCP client on this computer reach the jojo tab open in
 * your browser. Claude Code is the client this was built for; anything that
 * speaks MCP over HTTP will do.
 *
 *   node jojo-bridge.mjs --token <the token jojo shows you>
 *
 * ## Why a bridge exists at all
 *
 * jojo keeps your records in the browser tab — there is no server anywhere with
 * a copy — and a web page cannot listen on a port. An MCP client needs something
 * to connect to. So this small program listens on 127.0.0.1, and the tab keeps a
 * line open to it: when the client asks for something, the tab answers from the
 * live records, with the same tools, the same undo and the same screen you use.
 *
 * Nothing here talks to the internet, stores anything, or knows what your
 * records are. It moves messages between two things on your own machine.
 *
 * ## Why it is one file with no dependencies
 *
 * So it can be fetched with one `curl` and run with the `node` you already have.
 * An `npm install` for a few hundred lines of plumbing would be a supply chain
 * for something whose whole job is to be trusted with your job search.
 *
 * ## What keeps other programs out
 *
 * - It binds to 127.0.0.1 only. Nothing on your network can reach it.
 * - Every request needs the token jojo generated, compared in constant time.
 * - It answers only when the `Host` header names this machine. That is what
 *   stops a web page from using DNS rebinding to pose as a local caller.
 * - The client side refuses any request that carries an `Origin` header.
 *   Browsers always send one and MCP clients never do, so no web page — not
 *   even one that somehow learned the token — can drive it.
 *
 * What it cannot protect against is a program already running as you, which can
 * read the token out of your MCP client's config. That is true of every local
 * MCP server, and it is why jojo withholds the two tools that cannot be undone.
 *
 * ## What it cannot know
 *
 * Whether a tab that is holding a poll is still there to read the answer. A
 * poll that closes its connection is noticed at once and skipped. One carried
 * by the jojo extension is not: the extension's request runs to completion
 * after the tab that asked for it has gone, so for up to 25 seconds after a tab
 * closes the bridge can hand a request to nobody. The client is then told "jojo
 * did not answer in time" — true, and slow. It is a narrow window, and the only
 * way to close it is for the tab to acknowledge each request separately, which
 * doubles the traffic for every request to save a wait on a rare one.
 *
 * ## The protocol, briefly
 *
 *   POST /mcp          the client's side. One JSON-RPC message in, one out.
 *   GET  /tab/next     the tab's side. Held open until there is work (or 25 s).
 *   POST /tab/reply    the tab's answer to the message it was handed.
 *
 * The tab owns MCP itself — see `handleMcp` in `@jojo/service/agent/mcp`. This
 * file owns only the hop, so the protocol stays in one tested place.
 */

import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { pathToFileURL } from 'node:url'

export const DEFAULT_PORT = 3002

/** How long the tab's poll is held before an empty answer. Under the extension relay's 120 s. */
export const POLL_MS = 25_000

/** How long a client request waits for a tab to pick it up. */
export const ATTACH_WAIT_MS = 30_000

/**
 * How long a client request waits for the tab's answer once picked up.
 *
 * Long, because some tools are slow on purpose: reading a document goes out to
 * a converter, and a PDF can take most of a minute.
 */
export const REPLY_WAIT_MS = 120_000

/** Bigger than any honest MCP request, far smaller than anything that could hurt. */
const MAX_BODY_BYTES = 1_000_000

/**
 * A bearer header against the expected token, in constant time.
 *
 * `timingSafeEqual` throws on buffers of different lengths, so the length is
 * compared first. That leaks the length and nothing else, and the length of a
 * token jojo generated is not a secret.
 */
export function tokenMatches(expected, header) {
  if (typeof expected !== 'string' || expected === '') return false
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false
  const given = Buffer.from(header.slice('Bearer '.length).trim())
  const wanted = Buffer.from(expected)
  return given.length === wanted.length && timingSafeEqual(given, wanted)
}

/** The only `Host` values this answers to. */
export function isLoopbackHost(host, port) {
  if (typeof host !== 'string') return false
  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host.toLowerCase())
}

/**
 * Origins allowed to call the tab routes directly.
 *
 * Only loopback, and only because of the development server: the hosted site is
 * https and Chrome will not let it reach 127.0.0.1 at all, so it comes through
 * the jojo extension instead — an extension request is not subject to CORS and
 * needs no entry here.
 */
export function isLoopbackOrigin(origin) {
  if (typeof origin !== 'string') return false
  try {
    const url = new URL(origin)
    return (
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
    )
  } catch {
    return false
  }
}

const rpcError = (id, message) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code: -32000, message },
})

const NOT_CONNECTED =
  'jojo is not connected. Open jojo in your browser, go to Settings, turn on "Connect from an MCP client", and try again.'

const NO_ANSWER =
  'jojo did not answer in time. The tab may have been closed or put to sleep — bring it to the front and try again.'

/**
 * The bridge as a request handler, with no socket.
 *
 * Separate from `main` so the tests can drive it over a real HTTP server on a
 * spare port without starting the command-line program.
 */
export function createBridge({
  token,
  port = DEFAULT_PORT,
  pollMs = POLL_MS,
  attachWaitMs = ATTACH_WAIT_MS,
  replyWaitMs = REPLY_WAIT_MS,
  log = () => {},
}) {
  /** Client requests no tab has picked up yet. */
  const queue = []
  /** Picked up, awaiting the tab's reply, by sequence number. */
  const inflight = new Map()
  /** The tab's held poll, if one is waiting. At most one: the last tab to attach wins. */
  let parked = null
  let lastPoll = 0
  let seq = 0
  let wasAttached = false

  const attached = () => parked !== null || Date.now() - lastPoll < pollMs + 5_000

  const noteAttach = () => {
    if (!wasAttached) log('jojo connected.')
    wasAttached = true
  }

  /** Hands the next queued request to a parked poll, if both exist. */
  const deliver = () => {
    if (parked === null || queue.length === 0) return
    const { res, timer, cors } = parked
    clearTimeout(timer)
    parked = null
    /*
     * A poll whose connection has already gone cannot carry anything. Handing it
     * work would move the request out of the queue and into a socket nobody is
     * reading, and the client would wait out the whole reply budget to be told
     * the tab did not answer. Left queued, it goes to the next poll — or, if no
     * tab ever comes back, the client is told plainly that jojo is not
     * connected.
     */
    if (res.destroyed || res.socket?.destroyed === true) return
    const item = queue.shift()
    clearTimeout(item.attachTimer)
    inflight.set(item.seq, item)
    item.replyTimer = setTimeout(() => {
      inflight.delete(item.seq)
      item.resolve(rpcError(item.message.id, NO_ANSWER))
    }, replyWaitMs)
    /*
     * WITH the poll's CORS headers, and this was the bug the first real client
     * found. A tab on the development server reads this across origins, and a
     * browser discards a cross-origin answer that does not name its origin. The
     * idle 204s carried the header, so the link looked connected; this answer —
     * the only one carrying work — did not, so every request was delivered into
     * a response the browser threw away, and Claude Code timed out at 30 s.
     */
    send(res, 200, { seq: item.seq, message: item.message }, cors)
  }

  const send = (res, status, body, headers = {}) => {
    if (res.writableEnded) return
    const text = body === undefined ? '' : JSON.stringify(body)
    res.writeHead(status, {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      'cache-control': 'no-store',
      ...headers,
    })
    res.end(text)
  }

  const readJson = (req) =>
    new Promise((resolve) => {
      const chunks = []
      let size = 0
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > MAX_BODY_BYTES) {
          resolve({ ok: false, status: 413 })
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        try {
          resolve({ ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
        } catch {
          resolve({ ok: false, status: 400 })
        }
      })
      req.on('error', () => resolve({ ok: false, status: 400 }))
    })

  /* ----------------------------- the client side ---------------------------- */

  async function onMcp(req, res) {
    // A browser always sends Origin; an MCP client never does. See the header.
    if (req.headers.origin !== undefined) return send(res, 403, { error: 'Browsers may not call this.' })
    if (!tokenMatches(token, req.headers.authorization)) {
      return send(res, 401, { error: 'The token does not match the one jojo shows in Settings.' })
    }
    // No server-to-client stream and no sessions: every answer comes back on
    // the POST that asked. Streamable HTTP allows exactly this, and 405 is how a
    // server says it offers no GET stream.
    if (req.method !== 'POST') return send(res, 405, undefined, { allow: 'POST' })

    const body = await readJson(req)
    if (!body.ok) return send(res, body.status, rpcError(null, 'That was not a JSON-RPC message.'))
    const message = body.value
    if (typeof message !== 'object' || message === null || Array.isArray(message)) {
      return send(res, 400, rpcError(null, 'One JSON-RPC message per request.'))
    }

    // Notifications and responses expect no answer, and the tab needs to see
    // neither: jojo sends the client no requests of its own.
    const isRequest = typeof message.method === 'string' && message.id !== undefined
    if (!isRequest) return send(res, 202, undefined)

    const name =
      message.method === 'tools/call' && typeof message.params?.name === 'string'
        ? ` ${message.params.name}`
        : ''
    // The method and the tool, never the arguments: those are the person's records.
    log(`→ ${message.method}${name}`)

    const answer = await new Promise((resolve) => {
      const item = { seq: ++seq, message, resolve }
      item.attachTimer = setTimeout(() => {
        const at = queue.indexOf(item)
        if (at !== -1) {
          queue.splice(at, 1)
          resolve(rpcError(message.id, NOT_CONNECTED))
        }
      }, attachWaitMs)
      queue.push(item)
      deliver()
    })

    send(res, 200, answer)
  }

  /* ------------------------------ the tab side ------------------------------ */

  const corsFor = (req) =>
    isLoopbackOrigin(req.headers.origin)
      ? { 'access-control-allow-origin': req.headers.origin, vary: 'Origin' }
      : {}

  function onTabPreflight(req, res) {
    if (!isLoopbackOrigin(req.headers.origin)) return send(res, 403, undefined)
    send(res, 204, undefined, {
      ...corsFor(req),
      'access-control-allow-methods': 'GET, POST',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-private-network': 'true',
      'access-control-max-age': '600',
    })
  }

  function onTabNext(req, res) {
    const cors = corsFor(req)
    if (!tokenMatches(token, req.headers.authorization)) return send(res, 401, undefined, cors)

    lastPoll = Date.now()
    noteAttach()

    // The last tab to attach wins. An earlier one still holding a poll gets an
    // empty answer and polls again, which is how two open tabs settle without
    // either being told anything.
    if (parked !== null) {
      clearTimeout(parked.timer)
      send(parked.res, 204, undefined, parked.cors)
    }

    const timer = setTimeout(() => {
      if (parked?.res === res) parked = null
      send(res, 204, undefined, cors)
    }, pollMs)
    parked = { res, timer, cors }
    res.on('close', () => {
      if (parked?.res === res) {
        clearTimeout(parked.timer)
        parked = null
      }
    })
    deliver()
  }

  async function onTabReply(req, res) {
    const cors = corsFor(req)
    if (!tokenMatches(token, req.headers.authorization)) return send(res, 401, undefined, cors)
    const body = await readJson(req)
    if (!body.ok) return send(res, body.status, undefined, cors)
    const item = inflight.get(body.value?.seq)
    // A reply for something no longer waiting — timed out, or from a tab that
    // lost the race to attach. Accepted and dropped; the client already has its
    // answer.
    if (item === undefined) return send(res, 204, undefined, cors)
    inflight.delete(item.seq)
    clearTimeout(item.replyTimer)
    const response = body.value.response
    item.resolve(
      typeof response === 'object' && response !== null
        ? response
        : rpcError(item.message.id, 'jojo sent back an empty answer.'),
    )
    send(res, 204, undefined, cors)
  }

  /* --------------------------------- routing -------------------------------- */

  function handle(req, res) {
    // Before anything else, including the token: a request naming another host
    // is DNS rebinding until proved otherwise, and it should learn nothing.
    if (!isLoopbackHost(req.headers.host, port)) return send(res, 421, undefined)

    const path = (req.url ?? '').split('?')[0]
    if (path === '/mcp') return void onMcp(req, res)
    if (path === '/tab/next' || path === '/tab/reply') {
      if (req.method === 'OPTIONS') return onTabPreflight(req, res)
      if (path === '/tab/next' && req.method === 'GET') return onTabNext(req, res)
      if (path === '/tab/reply' && req.method === 'POST') return void onTabReply(req, res)
      return send(res, 405, undefined)
    }
    send(res, 404, undefined)
  }

  /**
   * For the command line's status line, and for the tests.
   *
   * `polling` is the stricter of the two: a poll is being held open right now.
   * `attached` also counts a tab that polled a moment ago and is between polls.
   */
  function state() {
    const now = attached()
    if (wasAttached && !now) {
      wasAttached = false
      log('jojo disconnected — the tab was closed, or the link was turned off.')
    }
    return { attached: now, polling: parked !== null, queued: queue.length, inflight: inflight.size }
  }

  return { handle, state }
}

/* --------------------------------- the program ------------------------------- */

function argument(args, name) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === `--${name}`) return args[i + 1]
    if (arg?.startsWith(`--${name}=`)) return arg.slice(name.length + 3)
  }
  return undefined
}

function main() {
  const args = process.argv.slice(2)
  const token = argument(args, 'token') ?? process.env.JOJO_BRIDGE_TOKEN
  const port = Number(argument(args, 'port') ?? DEFAULT_PORT)

  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,}$/.test(token)) {
    console.error('jojo-bridge needs the token jojo generated for you.')
    console.error('Copy the whole command from jojo → Settings → "Connect from an MCP client".')
    process.exit(1)
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`"${String(port)}" is not a port number.`)
    process.exit(1)
  }

  const bridge = createBridge({ token, port, log: (line) => console.log(line) })
  const server = createServer(bridge.handle)
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${String(port)} is already in use — is jojo-bridge already running?`)
      console.error('Stop the other copy, or start this one with --port <another port>.')
    } else {
      console.error(error.message)
    }
    process.exit(1)
  })
  server.listen(port, '127.0.0.1', () => {
    console.log(`jojo-bridge is listening on http://127.0.0.1:${String(port)}/mcp`)
    console.log('Waiting for jojo — open it in your browser and turn on "Connect from an MCP client" in Settings.')
    console.log('Leave this window open while you use it. Ctrl+C stops it.')
  })
  // Notices a tab that went away, so the status line above stays true.
  setInterval(() => bridge.state(), 5_000).unref()
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main()
