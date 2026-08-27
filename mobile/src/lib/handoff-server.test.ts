/**
 * The one thing about the socket binding that a test on Node CAN see.
 *
 * `handoff-server.ts` says at the top that it is the piece "that cannot be
 * proved in a test", and that is true of the socket itself: accepting a
 * connection needs a phone, a network and another device. It is not true of the
 * globals the file reaches for. Those are decided at import time on whatever
 * runtime is underneath, and Node's runtime has a much bigger global table than
 * Hermes does — which is precisely how a file can compile, pass a review, and
 * then throw `ReferenceError` on the first response it ever writes.
 *
 * So the socket is a stub and the assertions are on the BYTES this file hands
 * it, with `Buffer` deleted from `globalThis` for the length of the exchange so
 * that the runtime under the test is the runtime on the phone. Nothing here
 * re-tests `react-native-tcp-socket`, and nothing here re-tests
 * `core/handoff.ts`'s parser or `writeResponse` — those have their own suite in
 * `@jojo/service`. What is being checked is only that all three response paths
 * survive a runtime that has no `Buffer`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { pairPath, writeResponse } from '@jojo/service/core/handoff'
import { startHandoffServer, type HandoffAnswer } from '@/lib/handoff-server'

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

type Listener = (arg?: unknown) => void

/**
 * A socket that behaves like the library's in the two ways this file depends on.
 *
 * `write` throws once the socket is destroyed, because the real one does
 * (`Socket.js`: `if (this._pending || this._destroyed) throw new Error('Socket
 * is closed.')`). A stub that silently accepted a late write would hide the
 * difference between "answered" and "answered into a closed socket".
 */
class FakeSocket {
  destroyed = false
  written: Uint8Array[] = []
  private listeners = new Map<string, Listener[]>()

  on(event: string, fn: Listener): void {
    const held = this.listeners.get(event) ?? []
    held.push(fn)
    this.listeners.set(event, held)
  }

  emit(event: string, arg?: unknown): void {
    for (const fn of this.listeners.get(event) ?? []) fn(arg)
  }

  write(payload: unknown): boolean {
    if (this.destroyed) throw new Error('Socket is closed.')
    this.written.push(payload as Uint8Array)
    return true
  }

  destroy(): void {
    this.destroyed = true
  }

  /** Everything written, joined — the response as the other device would read it. */
  bytes(): Uint8Array {
    const total = this.written.reduce((n, part) => n + part.byteLength, 0)
    const out = new Uint8Array(total)
    let at = 0
    for (const part of this.written) {
      out.set(part, at)
      at += part.byteLength
    }
    return out
  }
}

class FakeServer {
  private listeners = new Map<string, Listener[]>()
  closed = false

  on(event: string, fn: Listener): void {
    const held = this.listeners.get(event) ?? []
    held.push(fn)
    this.listeners.set(event, held)
  }

  listen(_options: unknown, ready: () => void): void {
    ready()
  }

  address(): { address: string; family: string; port: number } {
    return { address: '0.0.0.0', family: 'IPv4', port: 51234 }
  }

  close(): void {
    this.closed = true
  }
}

/** Set by `createServer`, so a test can hand the server a connection. */
let connect: ((socket: FakeSocket) => void) | null = null

vi.mock('react-native-tcp-socket', () => ({
  default: {
    createServer: (onConnection: (socket: unknown) => void) => {
      connect = onConnection as (socket: FakeSocket) => void
      return new FakeServer()
    },
  },
}))

const original = Object.getOwnPropertyDescriptor(globalThis, 'Buffer')

afterEach(() => {
  // Every case here deletes a global. Without this the next test FILE in the
  // run inherits a Node with no `Buffer`, and vitest itself needs one.
  if (original) Object.defineProperty(globalThis, 'Buffer', original)
  connect = null
})

/** Bytes of a request, exactly as a browser would put them on the wire. */
const request = (line: string): Uint8Array => {
  const text = `${line} HTTP/1.1\r\nHost: 192.168.1.9:51234\r\n\r\n`
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff
  return out
}

/**
 * Runs one exchange on a runtime with no `Buffer`, which is React Native's.
 *
 * Deleted rather than assigned `undefined`: Hermes' state is a MISSING binding,
 * so a bare `Buffer.from(...)` there throws `ReferenceError` rather than reading
 * a property off `undefined`. Defining it as a read-only `undefined` would be
 * testing an artefact of this file instead of the platform.
 *
 * Restored in a `finally` before any assertion runs, so a failure reports itself
 * on a Node that still works.
 */
const exchange = async (
  line: string,
  answer: (route: string) => Promise<HandoffAnswer>,
): Promise<FakeSocket> => {
  const socket = new FakeSocket()
  Reflect.deleteProperty(globalThis, 'Buffer')
  try {
    await startHandoffServer(TOKEN, (read) => answer(read.route))
    connect?.(socket)
    socket.emit('data', request(line))
    // The response is written a few microtasks later — `answer` is awaited, and
    // there is a `.then`, a `.catch` and a `.finally` behind it. No timers are
    // involved, so draining the microtask queue is enough and nothing here has
    // to wait on a clock.
    for (let i = 0; i < 16; i += 1) await Promise.resolve()
  } finally {
    if (original) Object.defineProperty(globalThis, 'Buffer', original)
  }
  return socket
}

describe('on a runtime with no Buffer global, which is the phone', () => {
  it('writes the answer a handler produced', async () => {
    const body = new Uint8Array([0x00, 0xff, 0x7f, 0x00])
    const socket = await exchange(`GET ${pairPath(TOKEN)}`, () =>
      Promise.resolve({ status: 200, body } as HandoffAnswer),
    )
    expect(socket.bytes()).toEqual(writeResponse(200, body))
  })

  it('refuses a path that carries the wrong token', async () => {
    // The synchronous path: this response is written from inside the `data`
    // handler, so a `ReferenceError` here escapes into the native event
    // dispatch rather than into a promise.
    const socket = await exchange('GET /jojo/not-the-token/pair', () => {
      throw new Error('a refused request must never reach the handler')
    })
    expect(socket.bytes()).toEqual(writeResponse(404))
  })

  it('reports a handler that threw as 400 rather than hanging up silently', async () => {
    const socket = await exchange(`GET ${pairPath(TOKEN)}`, () =>
      Promise.reject(new Error('the handler is this app’s bug')),
    )
    expect(socket.bytes()).toEqual(writeResponse(400))
  })
})
