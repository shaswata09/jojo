/**
 * The socket. The one piece of this feature that cannot be proved in a test.
 *
 * Everything it speaks — the request parsing, the responses, the convoy, the
 * pairing — is pure and covered elsewhere. What lives here is the binding to
 * `react-native-tcp-socket`: accepting connections, feeding bytes to a parser,
 * and writing bytes back. That binding needs a phone, a network, and another
 * device, so it is written to be as thin as it can be and to put every decision
 * somewhere testable.
 *
 * ## Why the phone is the one that listens
 *
 * Because a browser cannot. There is no API in any browser for accepting an
 * inbound connection — Direct Sockets exists and is restricted to Isolated Web
 * Apps, which a static site is not. So of the two devices, only this one can be
 * the server.
 *
 * That decides who CONNECTS, not which way the records go. In `push` the
 * computer posts its backup here; in `pull` it asks this phone for the phone's
 * backup, chunk by chunk, and reads the answers (`core/handoff-pull.ts`). One
 * listener speaks one direction, chosen when it starts, and the parser refuses
 * the other direction's requests by shape.
 *
 * ## What is open, and for how long
 *
 * A port on the local network, bound to every interface, for the length of one
 * transfer. Two things bound the exposure:
 *
 *   - Every path carries a token derived from the pairing secret, which existed
 *     only as photons between one screen and one camera. Without it there is no
 *     reachable URL. See `core/handoff.ts`.
 *   - `stop()` is called when the screen goes away, and the server is never
 *     started before a code has been scanned.
 *
 * A caller that forgets `stop()` leaves a socket open on somebody's home
 * network, so it is wired to an effect cleanup rather than to a button.
 */

import TcpSocket from 'react-native-tcp-socket'
import {
  readRequest,
  requestLength,
  writeResponse,
  type HandoffDirection,
  type HandoffRequest,
} from '@jojo/service/core/handoff'

/** Bytes a single connection may buffer before it is dropped. */
const MAX_PENDING = 512 * 1024

/**
 * Connections held open at once.
 *
 * The listener is bound to every interface and the token is only checked once
 * a header is complete, so without a cap anyone on the same network could open
 * sockets that never finish a header and hold them for the whole transfer —
 * file descriptors and native socket threads the real browser then cannot get.
 * The browser's client is sequential (one request at a time, `Connection:
 * close`), so eight leaves room for a request still closing and a browser's
 * speculative pre-connects.
 *
 * A cap alone made exhaustion CHEAP rather than impossible (review 2,
 * security-5): eight sockets each trickling a header byte inside every idle
 * window held every slot for hours, and the real browser's connections were
 * destroyed on arrival. Two things close that. A header now has a deadline of
 * its own (`HEADER_MS`), which data does not reset. And a full house no longer
 * turns the newcomer away while a slot is held by a connection that has been
 * open past `EVICT_GRACE_MS` without finishing its header: the oldest such one
 * is closed to make room. A browser sends its header the moment it connects,
 * so it is never the one evicted, and an attacker has to keep opening eight
 * fresh connections every second just to stay in the way.
 */
export const MAX_CONNECTIONS = 8

/**
 * How long a connection has, from accept, to finish its request HEADER.
 *
 * Not reset by data — that is what made the idle timer alone a slot anyone
 * could hold with one byte every fourteen seconds. Shorter than `IDLE_MS`, and
 * generous beside what it measures: a browser's header is a few hundred bytes
 * written in one go. Cleared once the header is whole, so a large body that
 * keeps moving is still governed by the idle timer alone.
 */
export const HEADER_MS = 10_000

/**
 * How long a connection must have been waiting on its header before a newcomer
 * may take its slot. Long enough for any real client's header to have arrived.
 */
export const EVICT_GRACE_MS = 1_000

/** True once the bytes hold a whole request header (CRLFCRLF). */
function headerArrived(bytes: Uint8Array): boolean {
  for (let i = 3; i < bytes.byteLength; i += 1) {
    if (
      bytes[i - 3] === 0x0d &&
      bytes[i - 2] === 0x0a &&
      bytes[i - 1] === 0x0d &&
      bytes[i] === 0x0a
    )
      return true
  }
  return false
}

/**
 * How long a connection may go without sending a byte before it has handed
 * over a whole request.
 *
 * Reset by every chunk that arrives, so a slow upload that keeps moving is never
 * cut off — only silence is. Disarmed once a request is dispatched: a handler
 * that takes a while to answer is this app's time, not the peer's.
 */
export const IDLE_MS = 15_000

export type HandoffAnswer = {
  status: 200 | 204 | 400 | 404 | 409
  body?: Uint8Array
}

export type HandoffServer = {
  /** The port actually bound, which the operating system chooses. */
  port: number
  stop: () => void
}

/**
 * Starts listening, and hands every complete request to `answer`.
 *
 * `port: 0` asks the OS for a free one rather than picking a number that might
 * be taken — the port travels to the other device in the typed code anyway, so
 * there is nothing to gain from it being memorable.
 */
export function startHandoffServer(
  token: string,
  answer: (request: HandoffRequest) => Promise<HandoffAnswer>,
  direction: HandoffDirection = 'push',
): Promise<HandoffServer> {
  return new Promise((resolve, reject) => {
    const sockets = new Set<{ destroy: () => void }>()
    /**
     * Connections still waiting on their header, oldest first (a Map keeps
     * insertion order), each with whether it is past the eviction grace and
     * how to close it. Left once the header is whole or the socket is gone.
     */
    const waiting = new Map<object, { stale: boolean; shut: () => void }>()

    const server = TcpSocket.createServer((socket) => {
      if (sockets.size >= MAX_CONNECTIONS) {
        let oldest: { stale: boolean; shut: () => void } | undefined
        for (const entry of waiting.values()) {
          if (entry.stale) {
            oldest = entry
            break
          }
        }
        if (oldest === undefined) {
          socket.destroy()
          return
        }
        oldest.shut()
      }
      sockets.add(socket as unknown as { destroy: () => void })

      // One buffer per connection. `Connection: close` means one request per
      // socket in practice, but a client is free to send early bytes and the
      // parser is the only thing that decides when a request is whole.
      let held = new Uint8Array(0)
      let busy = false

      let idle: ReturnType<typeof setTimeout> | null = null
      const disarm = () => {
        if (idle !== null) clearTimeout(idle)
        idle = null
      }

      // The header's own clocks: the deadline, and the grace after which this
      // connection may be evicted for a newcomer. Both end with the header.
      let headerDeadline: ReturnType<typeof setTimeout> | null = null
      let graceOver: ReturnType<typeof setTimeout> | null = null
      const headed = () => {
        if (headerDeadline !== null) clearTimeout(headerDeadline)
        if (graceOver !== null) clearTimeout(graceOver)
        headerDeadline = null
        graceOver = null
        waiting.delete(socket)
      }

      const shut = () => {
        disarm()
        headed()
        sockets.delete(socket as unknown as { destroy: () => void })
        socket.destroy()
      }

      const entry = { stale: false, shut }
      waiting.set(socket, entry)
      headerDeadline = setTimeout(shut, HEADER_MS)
      graceOver = setTimeout(() => {
        entry.stale = true
      }, EVICT_GRACE_MS)

      const arm = () => {
        disarm()
        idle = setTimeout(shut, IDLE_MS)
      }
      arm()

      /**
       * One response, and a close that waits for it to have gone out.
       *
       * This used to be `socket.write(bytes)` followed by `shut()` on the next
       * line, and those two calls do NOT reach the socket on the same thread.
       * Read down the library:
       *
       *   - JS `write()` calls `NativeModules.TcpSockets.write(...)`, and
       *     Android's `TcpSocketClient.write` posts the bytes to that socket's
       *     own single-threaded `writeExecutor` (`TcpSocketClient.java`).
       *   - JS `destroy()` calls `NativeModules.TcpSockets.destroy(...)`, which
       *     is `end()`, which posts to the MODULE's shared two-thread
       *     `executorService` and calls `socket.close()` from there
       *     (`TcpSocketModule.java`). Different pool, no ordering against the
       *     write that was queued a microsecond earlier.
       *   - iOS is blunter still: `destroy` is `[_tcpSocket disconnect]`, which
       *     CocoaAsyncSocket documents as disconnecting immediately and
       *     DROPPING any pending writes, where `end` is
       *     `disconnectAfterWriting`.
       *
       * So the answer could be cut off — worst of all on the payload route,
       * where the other device would authenticate a truncated backup or, more
       * likely, sit on a stalled transfer. `end(bytes)` is the library's own
       * fix for exactly this: it writes, waits for the native 'written' event
       * for THAT message, and only then closes (`Socket.js`).
       *
       * The socket stays in `sockets` until its 'close' event rather than being
       * deleted here, which is what keeps `stop()` able to tear down a
       * connection whose write never completes because the peer walked away.
       */
      const reply = (bytes: Uint8Array) => {
        try {
          socket.end(bytes)
        } catch {
          // `write`/`end` throw 'Socket is closed.' when the connection has
          // already gone (`Socket.js` checks `_pending || _destroyed`). That is
          // not an error worth reporting — the client is not there to be told —
          // but it MUST not escape: this is called from a promise chain, and an
          // unhandled rejection on the phone is a red box over a transfer that
          // has otherwise finished.
          shut()
        }
      }

      socket.on('data', (chunk) => {
        // The library types this as string | Buffer; on RN it is a Buffer-like
        // Uint8Array. Anything else is not something to guess at.
        const incoming =
          typeof chunk === 'string' ? new Uint8Array(0) : new Uint8Array(chunk as ArrayLike<number>)
        if (incoming.byteLength === 0) return
        // Progress: the clock restarts, unless a request is already being
        // answered, in which case there is no clock.
        if (!busy) arm()

        const merged = new Uint8Array(held.byteLength + incoming.byteLength)
        merged.set(held, 0)
        merged.set(incoming, held.byteLength)
        held = merged

        // A connection that sends and sends without ever completing a request is
        // the cheapest way to exhaust a phone. The parser refuses an endless
        // header on its own; this bounds the body case too.
        if (held.byteLength > MAX_PENDING) {
          shut()
          return
        }
        if (headerDeadline !== null && headerArrived(held)) headed()
        if (busy) return

        const read = readRequest(held, token, direction)
        if (read === 'incomplete') return
        if (read === 'refused') {
          // Bytes, handed over as bytes. All three of the responses this file
          // writes used to go through `Buffer.from(...)` first, which typechecks —
          // @types/node is hoisted into this workspace — and is a
          // `ReferenceError` on the phone: Hermes has no `Buffer`, React Native
          // installs none, and nothing in `polyfills.ts` supplies one. It threw
          // on the FIRST byte this server ever tried to write, so the browser
          // saw the connection drop rather than a response and the transfer
          // could not have worked on a device at all.
          // `react-native-tcp-socket` takes a `Uint8Array` and does the
          // conversion itself, behind its own import of the shim.
          reply(writeResponse(404))
          return
        }

        // Latched across the await: `data` can fire again while the answer is
        // being built, and a second dispatch would run two handlers against one
        // connection and interleave their writes.
        busy = true
        disarm()
        held = held.slice(requestLength(held, read))

        void answer(read)
          .then((out) => {
            reply(writeResponse(out.status, out.body))
          })
          .catch(() => {
            // A handler that threw is this app's bug, not the client's. Say so
            // with a status rather than leaving the socket hanging until the
            // other device times out and reports "the transfer froze".
            reply(writeResponse(400))
          })
      })

      socket.on('error', shut)
      socket.on('close', () => {
        disarm()
        headed()
        sockets.delete(socket as unknown as { destroy: () => void })
      })
    })

    server.on('error', reject)

    // '0.0.0.0', not 'localhost': the point is to be reachable from the other
    // device, and a loopback bind would accept only this phone's own traffic.
    let closed = false
    server.listen({ port: 0, host: '0.0.0.0' }, () => {
      const bound = server.address()
      if (bound === null || typeof bound === 'string') {
        reject(new Error('the handoff server started without a port'))
        return
      }
      resolve({
        port: bound.port,
        // Idempotent: the watcher closes after its grace and the panel closes
        // when it goes away, and either may come first.
        stop: () => {
          if (closed) return
          closed = true
          for (const open of waiting.values()) open.shut()
          for (const open of sockets) open.destroy()
          sockets.clear()
          waiting.clear()
          server.close()
        },
      })
    })
  })
}
