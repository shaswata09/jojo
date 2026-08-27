/**
 * The phone's half of the reader, and the one thing in it that is not the
 * browser's: a document here is a `file://` URI on the handset while
 * `react-native-blob-util`'s fs takes a PATH.
 *
 * That difference is invisible until a filename contains a space, which is why
 * it is tested here rather than left to a phone: `keepLocalCopy` percent-encodes
 * what it returns, `storedName` permits spaces, and the record keeps the URI. A
 * `pathOf` that only slices the scheme off hands `My%20CV.pdf` to `stat`, gets
 * ENOENT, and reports a document that is right there as lost.
 *
 * The native module and the transport are stubbed; nothing here re-tests either.
 * The assertions are on what this file HANDS them — the path it decoded and the
 * `data:` URI it composed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Sent } from './local-service'

/** Every path blob-util's fs was asked about, in order. */
const fsCalls: { call: string; path: string }[] = []
/** Paths that exist, with the bytes each holds. */
const onDisk = new Map<string, string>()

vi.mock('react-native-blob-util', () => ({
  default: {
    fs: {
      stat: (path: string) => {
        fsCalls.push({ call: 'stat', path })
        const bytes = onDisk.get(path)
        return bytes === undefined
          ? Promise.reject(new Error('ENOENT'))
          : Promise.resolve({ size: bytes.length })
      },
      readFile: (path: string) => {
        fsCalls.push({ call: 'readFile', path })
        const bytes = onDisk.get(path)
        return bytes === undefined
          ? Promise.reject(new Error('ENOENT'))
          : Promise.resolve(Buffer.from(bytes, 'utf8').toString('base64'))
      },
    },
  },
}))

/** The bodies the transport was handed, in order. */
const sent: string[] = []

vi.mock('@/lib/local-service', () => ({
  failed: (r: Sent) => 'failed' in r,
  send: (request: { body?: string }) => {
    const body = request.body ?? ''
    sent.push(body)
    if (body.includes('"initialize"')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: JSON.stringify({ result: { serverInfo: { name: 'markitdown' } } }),
      })
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      text: JSON.stringify({ result: { content: [{ type: 'text', text: '# A CV' }] } }),
    })
  },
}))

const { convertDocument } = await import('./markitdown')

beforeEach(() => {
  fsCalls.length = 0
  sent.length = 0
  onDisk.clear()
})

describe('the path a document is read from', () => {
  it('decodes a percent-encoded URI before touching the filesystem', async () => {
    onDisk.set('/data/user/0/jojo/files/My CV.pdf', 'the bytes')

    const result = await convertDocument(
      'http://192.168.1.9:3001/mcp',
      'file:///data/user/0/jojo/files/My%20CV.pdf',
      'My CV.pdf',
    )

    // Both of the fs calls, because `stat` and `readFile` are two chances to
    // report a present file as missing.
    expect(fsCalls).toEqual([
      { call: 'stat', path: '/data/user/0/jojo/files/My CV.pdf' },
      { call: 'readFile', path: '/data/user/0/jojo/files/My CV.pdf' },
    ])
    expect(result).toEqual({ ok: true, markdown: '# A CV' })
  })

  it('does not claim a document with a space in its name is gone', async () => {
    onDisk.set('/data/user/0/jojo/files/My CV.pdf', 'the bytes')

    const result = await convertDocument(
      'http://192.168.1.9:3001/mcp',
      'file:///data/user/0/jojo/files/My%20CV.pdf',
      'My CV.pdf',
    )

    // The sentence this bug produced, about a file that is on the device.
    expect(result).not.toEqual({
      ok: false,
      reason: 'The copy of that document is no longer on this device.',
    })
  })

  it('leaves a path with nothing to decode exactly as it is', async () => {
    onDisk.set('/data/user/0/jojo/files/cv.pdf', 'the bytes')

    await convertDocument(
      'http://192.168.1.9:3001/mcp',
      'file:///data/user/0/jojo/files/cv.pdf',
      'cv.pdf',
    )

    expect(fsCalls[0]).toEqual({ call: 'stat', path: '/data/user/0/jojo/files/cv.pdf' })
  })

  it('still reports a document that really is missing', async () => {
    const result = await convertDocument(
      'http://192.168.1.9:3001/mcp',
      'file:///data/user/0/jojo/files/gone.pdf',
      'gone.pdf',
    )

    expect(result).toEqual({
      ok: false,
      reason: 'The copy of that document is no longer on this device.',
    })
  })

  it('sends the bytes as a data: URI typed from the record name', async () => {
    onDisk.set('/data/user/0/jojo/files/My CV.pdf', 'the bytes')

    await convertDocument(
      'http://192.168.1.9:3001/mcp',
      'file:///data/user/0/jojo/files/My%20CV.pdf',
      'My CV.pdf',
    )

    const convert = sent.at(-1) ?? ''
    expect(convert).toContain('data:application/pdf;base64,')
    expect(convert).toContain(Buffer.from('the bytes', 'utf8').toString('base64'))
  })
})
