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
 * survive a runtime that has no `Buffer`, and that each of them reaches the
 * peer WHOLE rather than being cut off by the close that follows it — see the
 * note on `FakeSocket`, which is where the second half of that lives.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { chunkPath, pairPath, writeResponse } from '@jojo/service/core/handoff'
import {
  EVICT_GRACE_MS,
  HEADER_MS,
  IDLE_MS,
  MAX_CONNECTIONS,
  startHandoffServer,
  type HandoffAnswer,
} from '@/lib/handoff-server'

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

type Listener = (arg?: unknown) => void

/**
 * A socket that behaves like the library's in the three ways this file depends on.
 *
 * `write` throws once the socket is destroyed, because the real one does
 * (`Socket.js`: `if (this._pending || this._destroyed) throw new Error('Socket
 * is closed.')`). A stub that silently accepted a late write would hide the
 * difference between "answered" and "answered into a closed socket".
 *
 * AND A WRITE IS NOT A DELIVERY. This is the part that took an audit to notice.
 * `write` hands bytes to a queue and returns; on Android they go to that
 * socket's own `writeExecutor` (`TcpSocketClient.java`), while `destroy` is
 * dispatched onto the module's SHARED pool and calls `socket.close()` from a
 * different thread (`TcpSocketModule.java`), and on iOS `destroy` is
 * `[_tcpSocket disconnect]`, which CocoaAsyncSocket documents as dropping any
 * pending writes. So a fake whose `write` delivered synchronously could not
 * tell a response that was flushed from one the close cut off — which is
 * exactly the bug this file exists to catch on a platform we cannot run here.
 * `queued` is therefore what has been handed over, `written` is what the other
 * device actually received, and only `end()` — the library's write-then-close —
 * moves bytes between them.
 */
class FakeSocket {
  destroyed = false
  written: Uint8Array[] = []
  /** Handed to the socket, not yet on the wire. */
  private queued: Uint8Array[] = []
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
    this.queued.push(payload as Uint8Array)
    return true
  }

  /** `end(data)` writes, waits for that write to complete, then closes. */
  end(payload?: unknown): void {
    if (payload !== undefined) {
      this.write(payload)
      this.written.push(...this.queued)
      this.queued = []
    }
    this.destroyed = true
  }

  /** Closes NOW. Anything still queued never reaches the peer. */
  destroy(): void {
    this.queued = []
    this.destroyed = true
  }

  /** Everything the peer received, joined — the response as it would read it. */
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
    // there is a `.then` and a `.catch` behind it. No timers are involved, so
    // draining the microtask queue is enough and nothing here has to wait on a
    // clock.
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

  /**
   * The audit's finding, as a case of its own.
   *
   * The write and the close used to be two statements — `socket.write(bytes)`
   * and then `socket.destroy()` — and they do not cross into the library on the
   * same thread, so the close could win. A payload is the route where that
   * costs the most: the other device gets a body short of its length and reads
   * it as a transfer that stalled, or authenticates a backup with a hole in it.
   *
   * Sized past a single chunk on purpose. A four-byte body would be delivered
   * by luck on a real device often enough to look fine in a hallway test, which
   * is how a truncation bug survives a demo.
   */
  it('delivers the whole payload before closing the connection', async () => {
    const body = new Uint8Array(64 * 1024)
    for (let i = 0; i < body.length; i += 1) body[i] = i & 0xff

    const socket = await exchange(`GET ${pairPath(TOKEN)}`, () =>
      Promise.resolve({ status: 200, body } as HandoffAnswer),
    )

    expect(socket.bytes()).toEqual(writeResponse(200, body))
    // And it IS closed afterwards. The responses say `Connection: close`, so a
    // server that answered and then held the socket open would leave one per
    // request on somebody's home network until the screen went away.
    expect(socket.destroyed).toBe(true)
  })
})

/**
 * sec-1: the listener is bound to every interface and checks the token only
 * once a header is whole, so a neighbour on the network could open sockets that
 * never finish one and hold them for the length of the transfer.
 */
describe('a listener that strangers on the network cannot tie up', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  /**
   * A whole header for a chunk upload, and the body it promises.
   *
   * The idle cases below are about a request whose HEADER is in and whose
   * BODY is still arriving: since review 2 (security-5) a header has its own
   * deadline from accept, which trickled bytes do not extend, so a header sent
   * slowly is no longer "a slow request" this listener waits on.
   */
  const BODY = 64
  const upload = (): { head: Uint8Array; body: Uint8Array } => {
    const text = `POST ${chunkPath(TOKEN)} HTTP/1.1\r\nHost: 192.168.1.9:51234\r\nContent-Length: ${String(BODY)}\r\n\r\n`
    const head = new Uint8Array(text.length)
    for (let i = 0; i < text.length; i += 1) head[i] = text.charCodeAt(i) & 0xff
    const body = new Uint8Array(BODY)
    for (let i = 0; i < BODY; i += 1) body[i] = i
    return { head, body }
  }

  it('closes connections past the cap on arrival', async () => {
    await startHandoffServer(TOKEN, () => Promise.resolve({ status: 204 }))
    const held = Array.from({ length: MAX_CONNECTIONS }, () => new FakeSocket())
    for (const socket of held) connect?.(socket)
    const extra = new FakeSocket()
    connect?.(extra)
    expect(held.every((socket) => !socket.destroyed)).toBe(true)
    expect(extra.destroyed).toBe(true)
  })

  it('takes a new connection once an earlier one has closed', async () => {
    await startHandoffServer(TOKEN, () => Promise.resolve({ status: 204 }))
    const held = Array.from({ length: MAX_CONNECTIONS }, () => new FakeSocket())
    for (const socket of held) connect?.(socket)
    held[0]!.emit('close')
    const next = new FakeSocket()
    connect?.(next)
    expect(next.destroyed).toBe(false)
  })

  it('drops a connection that goes quiet before finishing a request', async () => {
    vi.useFakeTimers()
    await startHandoffServer(TOKEN, () => Promise.resolve({ status: 204 }))
    const socket = new FakeSocket()
    connect?.(socket)
    const { head, body } = upload()
    socket.emit('data', head)
    socket.emit('data', body.slice(0, 8))
    vi.advanceTimersByTime(IDLE_MS - 1)
    expect(socket.destroyed).toBe(false)
    vi.advanceTimersByTime(1)
    expect(socket.destroyed).toBe(true)
  })

  it('drops a connection that never sends a byte', async () => {
    vi.useFakeTimers()
    await startHandoffServer(TOKEN, () => Promise.resolve({ status: 204 }))
    const socket = new FakeSocket()
    connect?.(socket)
    vi.advanceTimersByTime(IDLE_MS)
    expect(socket.destroyed).toBe(true)
  })

  it('never cuts off a slow request that keeps sending', async () => {
    vi.useFakeTimers()
    const seen: string[] = []
    await startHandoffServer(TOKEN, (read) => {
      seen.push(read.route)
      return Promise.resolve({ status: 204 })
    })
    const socket = new FakeSocket()
    connect?.(socket)
    // The header at once, as a browser sends it; then the body one byte just
    // inside the idle window each time, for several windows' worth.
    const { head, body } = upload()
    socket.emit('data', head)
    for (let i = 0; i < body.length; i += 1) {
      vi.advanceTimersByTime(IDLE_MS - 1)
      expect(socket.destroyed).toBe(false)
      socket.emit('data', body.slice(i, i + 1))
    }
    await vi.runAllTimersAsync()
    expect(seen).toHaveLength(1)
    expect(socket.bytes()).toEqual(writeResponse(204))
  })

  it('does not time out a request while its answer is being built', async () => {
    vi.useFakeTimers()
    let finish: (answer: HandoffAnswer) => void = () => {}
    await startHandoffServer(
      TOKEN,
      () =>
        new Promise<HandoffAnswer>((resolve) => {
          finish = resolve
        }),
    )
    const socket = new FakeSocket()
    connect?.(socket)
    socket.emit('data', request(`GET ${pairPath(TOKEN)}`))
    vi.advanceTimersByTime(IDLE_MS * 4)
    expect(socket.destroyed).toBe(false)
    finish({ status: 204 })
    await vi.runAllTimersAsync()
    expect(socket.bytes()).toEqual(writeResponse(204))
  })
})

/**
 * Review 2, security-5: the cap made exhaustion cheap. Eight sockets trickling a
 * header byte inside every idle window held every slot for hours, and the real
 * browser was turned away on arrival.
 */
describe('a header that is trickled to hold a slot', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const header = (): Uint8Array => request(`GET ${pairPath(TOKEN)}`)

  it('has a deadline from accept that more bytes do not extend', async () => {
    vi.useFakeTimers()
    expect(HEADER_MS).toBeLessThan(IDLE_MS)
    await startHandoffServer(TOKEN, () => Promise.resolve({ status: 204 }))
    const socket = new FakeSocket()
    connect?.(socket)
    const whole = header()
    let at = 0
    // A byte every second: well inside the idle window, every time.
    for (let elapsed = 0; elapsed < HEADER_MS - 1000; elapsed += 1000) {
      socket.emit('data', whole.slice(at, at + 1))
      at += 1
      vi.advanceTimersByTime(1000)
    }
    expect(socket.destroyed).toBe(false)
    vi.advanceTimersByTime(1000)
    expect(socket.destroyed).toBe(true)
  })

  it('still lets the real browser in when every slot is held by a trickler', async () => {
    vi.useFakeTimers()
    const seen: string[] = []
    await startHandoffServer(TOKEN, (read) => {
      seen.push(read.route)
      return Promise.resolve({ status: 204 })
    })
    const held = Array.from({ length: MAX_CONNECTIONS }, () => new FakeSocket())
    for (const socket of held) {
      connect?.(socket)
      socket.emit('data', header().slice(0, 1))
    }
    vi.advanceTimersByTime(EVICT_GRACE_MS)
    const browser = new FakeSocket()
    connect?.(browser)
    expect(browser.destroyed).toBe(false)
    // The oldest trickler made the room, and only that one.
    expect(held[0]!.destroyed).toBe(true)
    expect(held.slice(1).every((socket) => !socket.destroyed)).toBe(true)
    browser.emit('data', header())
    await vi.runAllTimersAsync()
    expect(seen).toEqual(['pair'])
    expect(browser.bytes()).toEqual(writeResponse(204))
  })

  it('never evicts a connection whose request is being answered', async () => {
    vi.useFakeTimers()
    await startHandoffServer(TOKEN, () => new Promise<HandoffAnswer>(() => {}))
    const held = Array.from({ length: MAX_CONNECTIONS }, () => new FakeSocket())
    for (const socket of held) {
      connect?.(socket)
      socket.emit('data', header())
    }
    vi.advanceTimersByTime(EVICT_GRACE_MS * 5)
    const extra = new FakeSocket()
    connect?.(extra)
    expect(extra.destroyed).toBe(true)
    expect(held.every((socket) => !socket.destroyed)).toBe(true)
  })
})
