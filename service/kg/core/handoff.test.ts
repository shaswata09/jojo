/**
 * The request parser, which is the part of the listener an attacker can reach.
 *
 * A socket open on a home network accepts bytes from every device on it, and
 * this is what those bytes hit first — before any key, before any signature. So
 * most of what follows is malformed, oversized, or subtly wrong, and the
 * assertion is always that it is REFUSED rather than interpreted.
 *
 * The parser is pure, so all of this runs without a socket. What a real socket
 * adds is delivery in arbitrary pieces, which is exactly why `readRequest` takes
 * the whole buffer each time and can answer `'incomplete'`.
 */

import { describe, expect, it } from 'vitest'
import {
  MAX_BODY_BYTES,
  chunkPath,
  pairPath,
  readRequest,
  requestLength,
  writeResponse,
} from './handoff'

const TOKEN = '0123456789abcdef0123456789abcdef'
const NL = '\r\n'

const enc = (text: string): Uint8Array =>
  new Uint8Array([...text].map((c) => c.charCodeAt(0) & 0xff))

const request = (head: string, extra: Uint8Array = new Uint8Array(0)): Uint8Array => {
  const header = enc(head)
  const out = new Uint8Array(header.byteLength + extra.byteLength)
  out.set(header, 0)
  out.set(extra, header.byteLength)
  return out
}

const get = (path: string) => request(`GET ${path} HTTP/1.1${NL}Host: x${NL}${NL}`)

const post = (path: string, payload: Uint8Array, length: string | number = payload.byteLength) =>
  request(`POST ${path} HTTP/1.1${NL}Host: x${NL}Content-Length: ${length}${NL}${NL}`, payload)

describe('the three requests it answers', () => {
  it('reads a request for the pairing response', () => {
    expect(readRequest(get(pairPath(TOKEN)), TOKEN)).toEqual({
      route: 'pair',
      body: new Uint8Array(0),
    })
  })

  it('reads a chunk, body intact', () => {
    // Arbitrary binary including nulls and bytes above 0x7f — a sealed chunk is
    // not text, and a parser that decoded the whole request as UTF-8 first would
    // mangle exactly these.
    const payload = new Uint8Array([0, 1, 0xff, 0xfe, 0x80, 0, 0x7f])
    const read = readRequest(post(chunkPath(TOKEN), payload), TOKEN)
    expect(read).not.toBe('refused')
    if (typeof read === 'string') return
    expect(read.route).toBe('chunk')
    expect([...read.body]).toEqual([...payload])
  })

  it('reads a preflight, which a browser sends before the POST', () => {
    for (const path of [pairPath(TOKEN), chunkPath(TOKEN)]) {
      const bytes = request(`OPTIONS ${path} HTTP/1.1${NL}Host: x${NL}${NL}`)
      expect(readRequest(bytes, TOKEN), path).toEqual({
        route: 'preflight',
        body: new Uint8Array(0),
      })
    }
  })

  it('says how much of the buffer one request consumed', () => {
    const payload = new Uint8Array(40).fill(7)
    const bytes = post(chunkPath(TOKEN), payload)
    const read = readRequest(bytes, TOKEN)
    if (typeof read === 'string') throw new Error('expected a request')
    expect(requestLength(bytes, read)).toBe(bytes.byteLength)
  })
})

describe('waiting for the rest, which is the normal case on a network', () => {
  it('waits for the end of the headers, at every split', () => {
    const full = `GET ${pairPath(TOKEN)} HTTP/1.1${NL}Host: x${NL}${NL}`
    for (let cut = 1; cut < full.length; cut += 1) {
      expect(readRequest(enc(full.slice(0, cut)), TOKEN), `cut ${cut}`).toBe('incomplete')
    }
    expect(readRequest(enc(full), TOKEN)).not.toBe('incomplete')
  })

  it('waits for the whole body, at every split', () => {
    const payload = new Uint8Array(64).fill(0xab)
    const bytes = post(chunkPath(TOKEN), payload)
    for (let cut = 1; cut < bytes.byteLength; cut += 1) {
      expect(readRequest(bytes.subarray(0, cut), TOKEN), `cut ${cut}`).toBe('incomplete')
    }
    expect(readRequest(bytes, TOKEN)).not.toBe('incomplete')
  })

  it('does not wait forever for a header that never ends', () => {
    // The cheapest attack on any listener: open a socket, send bytes with no
    // blank line, and let the device run out of memory.
    expect(readRequest(enc('GET /' + 'a'.repeat(9000)), TOKEN)).toBe('refused')
  })
})

describe('everything it must refuse', () => {
  it('refuses a path without the right token', () => {
    // The token is what stops any web page talking to a socket open on
    // somebody's home network. A refusal tells it nothing at all.
    for (const path of ['/jojo/pair', '/jojo//pair', '/pair', '/jojo/wrongtoken/pair', '/']) {
      expect(readRequest(get(path), TOKEN), path).toBe('refused')
    }
  })

  it('refuses a path that merely STARTS with the right one', () => {
    // A prefix match would admit traversal and anything appended to it.
    for (const suffix of ['/../../etc', 'x', '/', '?a=1', '/..%2f']) {
      expect(readRequest(get(pairPath(TOKEN) + suffix), TOKEN), suffix).toBe('refused')
    }
  })

  it('refuses the wrong method on the right path', () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'HEAD', 'TRACE']) {
      const bytes = request(`${method} ${pairPath(TOKEN)} HTTP/1.1${NL}${NL}`)
      expect(readRequest(bytes, TOKEN), method).toBe('refused')
    }
    expect(readRequest(get(chunkPath(TOKEN)), TOKEN)).toBe('refused')
  })

  it('refuses a Content-Length that is not plainly a number', () => {
    // `Number` accepts every one of these, and a parser built on it reads the
    // wrong number of bytes — which for a length means reading the NEXT
    // request's bytes as this one's body.
    for (const value of ['0x10', '1e3', '', '+8', '-1', '8.0', 'eight']) {
      expect(
        readRequest(post(chunkPath(TOKEN), new Uint8Array(8), value), TOKEN),
        JSON.stringify(value),
      ).toBe('refused')
    }
  })

  it('refuses a POST with no Content-Length rather than guessing', () => {
    const bytes = request(
      `POST ${chunkPath(TOKEN)} HTTP/1.1${NL}Host: x${NL}${NL}`,
      new Uint8Array(4),
    )
    expect(readRequest(bytes, TOKEN)).toBe('refused')
  })

  it('refuses a body larger than any real chunk', () => {
    const bytes = request(
      `POST ${chunkPath(TOKEN)} HTTP/1.1${NL}Content-Length: ${MAX_BODY_BYTES + 1}${NL}${NL}`,
    )
    expect(readRequest(bytes, TOKEN)).toBe('refused')
  })

  it('refuses rubbish that is not a request at all', () => {
    for (const junk of [`${NL}${NL}`, `not http${NL}${NL}`, `  ${NL}${NL}`]) {
      expect(readRequest(enc(junk), TOKEN), JSON.stringify(junk)).toBe('refused')
    }
  })

  it('is case-insensitive about the header NAME, as HTTP requires', () => {
    // Real clients differ. Getting this wrong means a POST from one browser
    // works and from another does not.
    for (const name of ['Content-Length', 'content-length', 'CONTENT-LENGTH']) {
      const bytes = request(
        `POST ${chunkPath(TOKEN)} HTTP/1.1${NL}${name}: 4${NL}${NL}`,
        new Uint8Array(4),
      )
      expect(readRequest(bytes, TOKEN), name).not.toBe('refused')
    }
  })
})

describe('what it answers with', () => {
  const textOf = (b: Uint8Array) => String.fromCharCode(...b)

  it('sends a body a browser will actually hand over', () => {
    // Without the CORS header the browser fetches this successfully and then
    // refuses to let jojo read it — a failure with nothing wrong on the wire.
    const out = textOf(writeResponse(200, new Uint8Array([1, 2, 3])))
    expect(out).toContain('HTTP/1.1 200 OK')
    expect(out).toContain('Access-Control-Allow-Origin: *')
    expect(out).toContain('Content-Length: 3')
    expect(out).toContain('Connection: close')
  })

  it('states a length that matches the body, for every status', () => {
    // A length that disagrees with the body hangs the client until it times
    // out, which reads as "the transfer froze" rather than as a bug here.
    for (const status of [200, 204, 400, 404, 409] as const) {
      const payload = new Uint8Array(status === 200 ? 17 : 0)
      const bytes = writeResponse(status, payload)
      const text = textOf(bytes)
      expect(text, String(status)).toContain(`Content-Length: ${payload.byteLength}`)
      const end = text.indexOf('\r\n\r\n') + 4
      expect(bytes.byteLength - end, String(status)).toBe(payload.byteLength)
    }
  })

  it('does not corrupt a binary body', () => {
    const payload = new Uint8Array(256)
    for (let i = 0; i < 256; i += 1) payload[i] = i
    const bytes = writeResponse(200, payload)
    // Searched over the whole response: the header alone is ~225 bytes, and a
    // prefix shorter than that finds no separator and silently reads from 3.
    const end = textOf(bytes).indexOf('\r\n\r\n') + 4
    expect([...bytes.subarray(end)]).toEqual([...payload])
  })
})
