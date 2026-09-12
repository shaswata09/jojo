import type { ToolHost } from '@jojo/service/agent/execute'
import { handleMcp } from '@jojo/service/agent/mcp'
import type { McpOptions } from '@jojo/service/agent/mcp'

/**
 * The tab's side of the MCP link: how an outside client reaches jojo's records.
 *
 * ## The shape of it
 *
 *   Claude Code ──MCP──▶ jojo-bridge (127.0.0.1) ◀──poll── this tab ──▶ handleMcp
 *
 * The client needs something to connect to, and a web page cannot listen on a
 * port — so `web/public/jojo-bridge.mjs`, a small program the person runs, does
 * the listening, and this keeps a line open to it. Each message the client
 * sends is handed down that line, answered here by `handleMcp` against the live
 * records, and handed back. The tab stays the server because it holds the only
 * copy: the records, the undo journal and the screen showing both.
 *
 * ## Why the subscription question does not arise
 *
 * Nothing here talks to Anthropic, or to any model. The client brings its own —
 * Claude Code on the person's own plan, which is what that plan is for — and
 * jojo is one of the tool servers they chose to connect to it. That is the
 * arrangement Anthropic's terms permit; offering a Claude login inside jojo is
 * the one they do not, and this does not do it.
 *
 * ## Why this file has no React and no browser globals beyond `fetch`
 *
 * So the joined test can run the real loop against the real bridge and a real
 * graph in Node. The React half — which tab, which host, which switch — is
 * `mcp-link-provider.tsx`.
 */

/** Where `jojo-bridge` listens unless told otherwise. Mirrors its `DEFAULT_PORT`. */
export const BRIDGE_ADDRESS = 'http://127.0.0.1:3002'

export type LinkRequest = {
  url: string
  method: 'GET' | 'POST'
  headers: Record<string, string>
  body?: string
}

/**
 * What a transport hands back: an HTTP answer, or the reason there was none.
 *
 * `kind` exists because the three failures want three different sentences.
 * "The bridge is not running" is the ordinary state before somebody starts it;
 * "the extension is missing" and "the extension is too old" each have a
 * specific fix, and folding them into one message would send people to restart
 * a program that was never the problem.
 */
export type LinkAnswer =
  | { ok: boolean; status: number; text: string }
  | { failed: { reason: string; kind: 'absent' | 'stale' | 'transport' } }

export type LinkTransport = (request: LinkRequest, signal: AbortSignal) => Promise<LinkAnswer>

export type LinkStatus =
  /** Nothing is answering at the bridge's address — usually, it is not started yet. */
  | { state: 'searching'; reason?: string }
  /** The bridge is answering and this tab is attached to it. */
  | { state: 'ready' }
  /** The bridge is answering and refusing this tab's token. */
  | { state: 'bad-token' }
  /** Hosted copy, no jojo extension to carry the link past Chrome's local-network gate. */
  | { state: 'no-extension' }
  /** The extension is there but predates the link. */
  | { state: 'stale-extension' }

/** First retry, and the ceiling the doubling stops at. */
export const FIRST_RETRY_MS = 5_000
export const MAX_RETRY_MS = 60_000

/**
 * The shortest gap between one poll and the next.
 *
 * The happy path has no timer in it on purpose: the bridge holds an empty poll
 * open for twenty-five seconds, so the loop is paced by the far end rather than
 * by a clock here. That is true of the bridge in this repository and of nothing
 * else — anything that answers an empty poll immediately (an older copy, a
 * proxy, something misconfigured) turns the same loop into a hot spin that
 * saturates a core and floods the extension relay. Measured the hard way: a
 * test whose fake transport answered instantly took the worker out with it.
 */
export const MIN_POLL_GAP_MS = 250

/**
 * A plain `fetch` to the bridge — for a page served from this machine.
 *
 * Only the development server qualifies. A page served from the web is https,
 * and Chrome's Local Network Access gate will not let it reach 127.0.0.1; that
 * page goes through the extension instead. See `mcp-link-provider.tsx`.
 */
export const directTransport =
  (fetchImpl: typeof fetch = (input, init) => fetch(input, init)): LinkTransport =>
  async (request, signal) => {
    try {
      const response = await fetchImpl(request.url, {
        method: request.method,
        headers: request.headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        signal,
        // Same rule as every other loopback call in jojo: a local server asked
        // for no credentials, and sending some is how a local request stops
        // being a local one.
        credentials: 'omit',
      })
      return { ok: response.ok, status: response.status, text: await response.text().catch(() => '') }
    } catch (error) {
      return {
        failed: { kind: 'transport', reason: error instanceof Error ? error.message : String(error) },
      }
    }
  }

/**
 * A token the bridge will accept: 32 random bytes as base64url, 43 characters.
 *
 * The bridge refuses anything shorter than 32 characters or outside base64url,
 * so a token typed by hand — "password", say — cannot be the one it runs with.
 */
export function mintToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A wait that ends early when the link is switched off. */
const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })

/**
 * Keeps the line to the bridge open until `signal` aborts.
 *
 * ## The loop
 *
 * Ask the bridge for work. It holds the question open for up to 25 seconds and
 * answers 204 if nothing came, which is the idle state and costs one request a
 * poll. When a client message arrives it is answered by `handleMcp` and posted
 * back. There is no timer between polls on the happy path: a background tab's
 * timers are throttled, a held request is not.
 *
 * ## When the bridge is not there
 *
 * Which is most of the time the link is on — until somebody starts the bridge,
 * it is just a switch that has been flipped. So a failure backs off from five
 * seconds to a minute, says why through `onStatus`, and writes nothing to the
 * console: a line per retry in a tab left open all day would bury every real
 * diagnostic this app has.
 *
 * ## It never throws
 *
 * `handleMcp` is built never to reject, but it runs tools, and a tool is code
 * somebody will change. A throw here would end the loop silently with the
 * switch still reading "on", so it becomes a JSON-RPC error the client can show.
 */
export async function runLink({
  address = BRIDGE_ADDRESS,
  token,
  transport,
  host,
  allow,
  signal,
  onStatus,
  onServed,
  wait = pause,
}: {
  address?: string
  token: string
  transport: LinkTransport
  host: ToolHost
  allow?: McpOptions['allow']
  signal: AbortSignal
  onStatus: (status: LinkStatus) => void
  /** Called with the method of each client message answered, for the status line. */
  onServed?: (method: string) => void
  wait?: (ms: number, signal: AbortSignal) => Promise<void>
}): Promise<void> {
  const authorization = `Bearer ${token}`
  let delay = FIRST_RETRY_MS
  /*
   * Two strikes before naming a culprit.
   *
   * "The extension did not answer" and "the extension is not installed" are the
   * same silence, and the first one happens on its own: an MV3 service worker
   * is evicted when idle, and the poll that wakes it can miss. Reported at once,
   * that put "Needs the extension" under a working link — which is exactly what
   * somebody hit, with the extension installed and the bridge printing "jojo
   * connected" in the next window.
   *
   * So a single miss is reported as the neutral state and a retry follows a
   * moment later. Only a failure that repeats gets to name the extension, which
   * is the case where naming it is true.
   */
  let strikes = 0

  const backOff = async () => {
    await wait(delay, signal)
    delay = Math.min(delay * 2, MAX_RETRY_MS)
  }

  onStatus({ state: 'searching' })

  while (!signal.aborted) {
    const askedAt = Date.now()
    const next = await transport(
      { url: `${address}/tab/next`, method: 'GET', headers: { authorization } },
      signal,
    )
    if (signal.aborted) return

    if ('failed' in next) {
      strikes += 1
      const named =
        next.failed.kind === 'absent'
          ? ({ state: 'no-extension' } as const)
          : next.failed.kind === 'stale'
            ? ({ state: 'stale-extension' } as const)
            : null
      onStatus(
        named !== null && strikes >= 2 ? named : { state: 'searching', reason: next.failed.reason },
      )
      await backOff()
      continue
    }
    // Deterministic rather than transient: a token is wrong or it is not.
    if (next.status === 401) {
      strikes = 0
      onStatus({ state: 'bad-token' })
      await backOff()
      continue
    }
    if (next.status === 204) {
      // Idle, and attached. The next poll goes straight out — unless the answer
      // came back too fast to have been held, in which case pace it here.
      strikes = 0
      onStatus({ state: 'ready' })
      delay = FIRST_RETRY_MS
      if (Date.now() - askedAt < MIN_POLL_GAP_MS) await wait(MIN_POLL_GAP_MS, signal)
      continue
    }
    if (next.status !== 200) {
      onStatus({ state: 'searching', reason: `jojo-bridge answered ${String(next.status)}.` })
      await backOff()
      continue
    }

    delay = FIRST_RETRY_MS
    strikes = 0
    onStatus({ state: 'ready' })

    let handed: { seq?: unknown; message?: unknown }
    try {
      handed = JSON.parse(next.text) as { seq?: unknown; message?: unknown }
    } catch {
      continue
    }
    const message = handed.message as { id?: unknown; method?: unknown } | undefined

    let response: unknown
    try {
      response = await handleMcp(host, message, allow === undefined ? {} : { allow })
    } catch {
      response = {
        jsonrpc: '2.0',
        id: message?.id ?? null,
        error: { code: -32603, message: 'jojo could not answer that — the tool failed unexpectedly.' },
      }
    }
    onServed?.(typeof message?.method === 'string' ? message.method : 'unknown')

    // Posted and not retried. If this fails the bridge times the request out
    // and says so to the client, which is the honest outcome — a retry could
    // deliver a write's answer twice.
    await transport(
      {
        url: `${address}/tab/reply`,
        method: 'POST',
        headers: { authorization, 'content-type': 'application/json' },
        body: JSON.stringify({ seq: handed.seq, response }),
      },
      signal,
    )
  }
}

/** The line that starts the bridge, with this tab's token in it. */
export const bridgeCommand = (scriptUrl: string, token: string) =>
  `curl -fsSL ${scriptUrl} -o jojo-bridge.mjs && node jojo-bridge.mjs --token ${token}`

/** The line that connects Claude Code to it. Double quotes, so it pastes into PowerShell too. */
export const clientCommand = (token: string, address = BRIDGE_ADDRESS) =>
  `claude mcp add --transport http jojo ${address}/mcp --header "Authorization: Bearer ${token}"`
