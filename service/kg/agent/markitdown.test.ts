/**
 * The MarkItDown client, without a MarkItDown.
 *
 * Everything worth testing here is shape: the handshake MCP requires before a
 * call, the two ways a streamable-HTTP server may frame one reply, and the
 * difference between a transport failure and a document the converter refused.
 * The one thing this cannot prove is that a real server answers — that is what
 * the live check against `markitdown-mcp` is for.
 */
import { describe, expect, it } from 'vitest'
import { MARKITDOWN, MAX_BYTES, convertRequest, dataUri, initializeRequest, initializedNotification, readConvertResponse, readHandshake, readerPathNotForwarded, trimForModel } from './markitdown'
import { CONTEXT_BUDGET } from './paging'

const json = (body: unknown) => ({ ok: true, status: 200, text: JSON.stringify(body) })

const result = (content: unknown, isError = false) =>
  json({ jsonrpc: '2.0', id: 3, result: { content, isError } })

const text = (t: string) => [{ type: 'text', text: t }]

describe('attribution', () => {
  it('carries the notice the licence asks for, next to the setting', () => {
    // A person deciding whether to install it deserves the terms without
    // reading a file in a repo.
    expect(MARKITDOWN.copyright).toBe('Copyright (c) Microsoft Corporation.')
    expect(MARKITDOWN.licence).toBe('MIT License')
    expect(MARKITDOWN.url).toBe('https://github.com/microsoft/markitdown')
  })

  it('names the package to install and the command to run it', () => {
    expect(MARKITDOWN.install).toContain('markitdown-mcp')
    expect(MARKITDOWN.serve).toContain('--http')
    expect(MARKITDOWN.defaultEndpoint).toContain('/mcp')
  })
})

describe('the requests', () => {
  it('accepts both framings, because streamable HTTP may use either', () => {
    // Accepting only JSON gets a 406 from the reference server before it looks
    // at the body.
    const req = initializeRequest('http://127.0.0.1:3001/mcp')
    expect(req.headers['Accept']).toContain('application/json')
    expect(req.headers['Accept']).toContain('text/event-stream')
  })

  it('sends the protocol version and no capabilities it does not have', () => {
    const body = JSON.parse(initializeRequest('http://x/mcp').body ?? '{}') as {
      method: string
      params: { capabilities: unknown; clientInfo: { name: string } }
    }
    expect(body.method).toBe('initialize')
    expect(body.params.capabilities).toEqual({})
    expect(body.params.clientInfo.name).toBe('jojo')
  })

  it('sends the initialized notification with no id, as JSON-RPC requires', () => {
    const body = JSON.parse(initializedNotification('http://x/mcp').body ?? '{}') as
      Record<string, unknown>
    expect(body).toEqual({ jsonrpc: '2.0', method: 'notifications/initialized' })
    expect('id' in body).toBe(false)
  })

  it('calls the one tool markitdown-mcp exposes, by its exact name', () => {
    const body = JSON.parse(convertRequest('http://x/mcp', 'data:text/plain;base64,aGk=').body ?? '{}') as {
      method: string
      params: { name: string; arguments: { uri: string } }
    }
    expect(body.method).toBe('tools/call')
    expect(body.params.name).toBe('convert_to_markdown')
    expect(body.params.arguments.uri).toBe('data:text/plain;base64,aGk=')
  })

  it('sends to the path with the trailing slash, whichever way it was typed', () => {
    // The opposite of the model client, and for a browser reason: markitdown-mcp
    // answers `/mcp` with a 307 to an ABSOLUTE `/mcp/`, and a browser will not
    // follow a redirect that leaves the origin. Measured through a proxy —
    // `/reader/mcp` failed and `/reader/mcp/` worked against the same server.
    expect(convertRequest('http://127.0.0.1:3001/mcp', 'data:,x').url).toBe(
      'http://127.0.0.1:3001/mcp/',
    )
    expect(convertRequest('http://127.0.0.1:3001/mcp///', 'data:,x').url).toBe(
      'http://127.0.0.1:3001/mcp/',
    )
    expect(initializeRequest('/reader/mcp').url).toBe('/reader/mcp/')
  })
})

describe('reading the reply', () => {
  it('reads Markdown out of an MCP tool result', () => {
    expect(readConvertResponse(result(text('# Posting\n\nRice, Statistics.')))).toEqual({
      ok: true,
      markdown: '# Posting\n\nRice, Statistics.',
    })
  })

  it('reads one framed as a single SSE event, which the reference server sends', () => {
    const framed = {
      ok: true,
      status: 200,
      text: `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 3, result: { content: text('hello') } })}\n\n`,
    }
    expect(readConvertResponse(framed)).toEqual({ ok: true, markdown: 'hello' })
  })

  it('treats isError as a refusal about the DOCUMENT, not a transport failure', () => {
    // A password-protected PDF arrives this way, and the reason is the useful
    // half — `mcp.ts` explains the convention from the server side.
    const out = readConvertResponse(result(text('File is encrypted'), true))
    expect(out).toEqual({ ok: false, reason: 'The reader could not read it: File is encrypted' })
  })

  it('reports a JSON-RPC error as a refusal, quoting the server', () => {
    const out = readConvertResponse(
      json({ jsonrpc: '2.0', id: 3, error: { code: -32602, message: 'Unsupported URI' } }),
    )
    expect(out.ok).toBe(false)
    if (out.ok) throw new Error('x')
    expect(out.reason).toContain('Unsupported URI')
  })

  it('quotes the status when the reader is not there at all', () => {
    const out = readConvertResponse({ ok: false, status: 404, text: 'Not Found' })
    if (out.ok) throw new Error('x')
    expect(out.reason).toContain('404')
  })

  it('never turns an empty or unreadable body into an empty document', () => {
    // An empty string presented as the document is worse than a refusal: the
    // model would answer questions about a file it never saw.
    for (const body of [result([]), result(text('   ')), json({}), { ok: true, status: 200, text: 'nonsense' }]) {
      expect(readConvertResponse(body).ok).toBe(false)
    }
  })
})

describe('the handshake check', () => {
  it('passes when a server names itself', () => {
    const out = readHandshake(json({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'markitdown' } } }))
    expect(out).toEqual({ ok: true, markdown: 'markitdown' })
  })

  it('says what to check when something else answers on that port', () => {
    const out = readHandshake({ ok: true, status: 200, text: '<html>hello</html>' }, 'http://x:3001')
    if (out.ok) throw new Error('x')
    expect(out.reason).toContain('/mcp')
  })

  it('does not lecture someone whose path is already right', () => {
    // The same correction the model client needed: a 500 from a correct address
    // is not an invitation to explain the address.
    const out = readHandshake({ ok: false, status: 500, text: 'boom' }, 'http://x:3001/mcp')
    if (out.ok) throw new Error('x')
    expect(out.reason).not.toContain('ends in /mcp')
  })

  it('names the path on a 404, which is what a wrong one gives', () => {
    const out = readHandshake({ ok: false, status: 404, text: '' }, 'http://x:5199/')
    if (out.ok) throw new Error('x')
    expect(out.reason).toContain('404')
    expect(out.reason).toContain('/mcp')
  })
})

describe('the bytes', () => {
  it('builds a data URI, defaulting the type rather than sending an empty one', () => {
    expect(dataUri('application/pdf', 'AAA=')).toBe('data:application/pdf;base64,AAA=')
    expect(dataUri('', 'AAA=')).toBe('data:application/octet-stream;base64,AAA=')
  })

  it('caps what will be sent, since base64 is built in memory on a phone', () => {
    expect(MAX_BYTES).toBe(8 * 1024 * 1024)
  })
})

describe('what reaches the model', () => {
  it('passes a short document through untouched', () => {
    expect(trimForModel('short')).toBe('short')
  })

  it('announces a cut, so a partial answer is never presented as a whole one', () => {
    const long = 'x'.repeat(CONTEXT_BUDGET + 500)
    const out = trimForModel(long)
    expect(out).toContain('Cut off here')
    expect(out).toContain(String(long.length))
  })
})

describe('a path nothing is forwarding', () => {
  /*
   * The report this exists for: markitdown-mcp running fine on 127.0.0.1:3001,
   * the dev server proxying it, and the DEPLOYED copy answering
   *
   *   The reader answered 405 — <html> <head><title>405 Not Allowed</title>…
   *
   * That is the file server hosting jojo refusing a POST, quoted verbatim at
   * somebody who asked about a PDF. True, and useless.
   */
  const html =
    '<html>\r\n<head><title>405 Not Allowed</title></head>\r\n<body bgcolor="white">\r\n<center><h1>405 Not Allowed</h1></center>\r\n</body>\r\n</html>\r\n'

  it('names the real problem instead of quoting the web server', () => {
    const said = readerPathNotForwarded(405, html, '/jojo/reader/mcp')
    expect(said).not.toBeNull()
    expect(said).toContain('Nothing is forwarding /jojo/reader/mcp')
    // The two things a reader can actually do about it.
    expect(said).toMatch(/run jojo on the same machine/i)
    expect(said).toMatch(/https:\/\/ address/i)
    // And not the markup.
    expect(said).not.toContain('<html')
  })

  it('covers 404 as well as 405, because it depends who is refusing', () => {
    expect(readerPathNotForwarded(404, 'Not Found', '/reader/mcp')).not.toBeNull()
    expect(readerPathNotForwarded(405, '', '/reader/mcp')).not.toBeNull()
  })

  it('fires on an HTML body whatever the status, since the reader speaks JSON-RPC', () => {
    expect(readerPathNotForwarded(500, html, '/reader/mcp')).not.toBeNull()
  })

  it('stays out of the way when the address is a real URL', () => {
    /*
     * A full address reaches something specific and that something answered.
     * Telling its owner about proxy forwarding would be a guess about a setup
     * this cannot see — the raw status is the honest answer there.
     */
    expect(readerPathNotForwarded(405, html, 'http://127.0.0.1:3001/mcp')).toBeNull()
    expect(readerPathNotForwarded(404, 'Not Found', 'https://reader.example.com/mcp')).toBeNull()
  })

  it('leaves a genuine reader error alone', () => {
    // A real MCP server having a bad day answers JSON, not markup. That status
    // is worth quoting, and the old message is still the right one.
    expect(readerPathNotForwarded(500, '{"error":{"message":"boom"}}', '/reader/mcp')).toBeNull()
    expect(readerPathNotForwarded(400, '{"jsonrpc":"2.0"}', '/reader/mcp')).toBeNull()
  })

  it('is what readHandshake actually says on a hosted copy', () => {
    const out = readHandshake({ ok: false, status: 405, text: html }, '/jojo/reader/mcp')
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.reason).toContain('Nothing is forwarding')
      expect(out.reason).not.toContain('<html')
    }
  })

  it('and readConvertResponse says it too, for an address saved before the move', () => {
    const out = readConvertResponse({ ok: false, status: 405, text: html }, '/reader/mcp')
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('Nothing is forwarding')
  })
})
