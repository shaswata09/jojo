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
 * the server, and the direction of the transfer is decided by that platform
 * limit rather than by design.
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
  type HandoffRequest,
} from '@jojo/service/core/handoff'

/** Bytes a single connection may buffer before it is dropped. */
const MAX_PENDING = 512 * 1024

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
): Promise<HandoffServer> {
  return new Promise((resolve, reject) => {
    const sockets = new Set<{ destroy: () => void }>()

    const server = TcpSocket.createServer((socket) => {
      sockets.add(socket as unknown as { destroy: () => void })

      // One buffer per connection. `Connection: close` means one request per
      // socket in practice, but a client is free to send early bytes and the
      // parser is the only thing that decides when a request is whole.
      let held = new Uint8Array(0)
      let busy = false

      const shut = () => {
        sockets.delete(socket as unknown as { destroy: () => void })
        socket.destroy()
      }

      socket.on('data', (chunk) => {
        // The library types this as string | Buffer; on RN it is a Buffer-like
        // Uint8Array. Anything else is not something to guess at.
        const incoming =
          typeof chunk === 'string' ? new Uint8Array(0) : new Uint8Array(chunk as ArrayLike<number>)
        if (incoming.byteLength === 0) return

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
        if (busy) return

        const read = readRequest(held, token)
        if (read === 'incomplete') return
        if (read === 'refused') {
          socket.write(Buffer.from(writeResponse(404)))
          shut()
          return
        }

        // Latched across the await: `data` can fire again while the answer is
        // being built, and a second dispatch would run two handlers against one
        // connection and interleave their writes.
        busy = true
        held = held.slice(requestLength(held, read))

        void answer(read)
          .then((out) => {
            socket.write(Buffer.from(writeResponse(out.status, out.body)))
          })
          .catch(() => {
            // A handler that threw is this app's bug, not the client's. Say so
            // with a status rather than leaving the socket hanging until the
            // other device times out and reports "the transfer froze".
            socket.write(Buffer.from(writeResponse(400)))
          })
          .finally(shut)
      })

      socket.on('error', shut)
      socket.on('close', () => sockets.delete(socket as unknown as { destroy: () => void }))
    })

    server.on('error', reject)

    // '0.0.0.0', not 'localhost': the point is to be reachable from the other
    // device, and a loopback bind would accept only this phone's own traffic.
    server.listen({ port: 0, host: '0.0.0.0' }, () => {
      const bound = server.address()
      if (bound === null || typeof bound === 'string') {
        reject(new Error('the handoff server started without a port'))
        return
      }
      resolve({
        port: bound.port,
        stop: () => {
          for (const open of sockets) open.destroy()
          sockets.clear()
          server.close()
        },
      })
    })
  })
}
