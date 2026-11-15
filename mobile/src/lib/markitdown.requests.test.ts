/**
 * Q230 — the document reader works on Android and iOS, where no extension can
 * be installed.
 *
 * On the web a browser extension bridges to a MarkItDown on the same machine.
 * On a phone nothing can, so the owner asked for the reader to work there
 * without one: `convertDocument` reads DOCX/ODT/PPTX/text ON THE HANDSET first
 * (`on-device-reader.ts`) and only falls back to a MarkItDown it reaches over
 * the network itself (`local-service`), never through an extension.
 *
 * The two assertions that matter: a DOCX reads with NO reader address set and
 * no request sent; and a PDF, which needs MarkItDown, goes straight to the
 * configured address over the phone's own transport.
 *
 * Native filesystem and transport are stubbed; the zip is real (fflate).
 */

import { strToU8, zipSync } from 'fflate'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Paths that exist, with their bytes as base64. */
const onDisk = new Map<string, string>()
/** Every request handed to the transport. */
const sent: string[] = []

vi.mock('react-native-blob-util', () => ({
  default: {
    fs: {
      stat: (path: string) =>
        onDisk.has(path)
          ? Promise.resolve({ size: Buffer.from(onDisk.get(path) ?? '', 'base64').length })
          : Promise.reject(new Error('ENOENT')),
      readFile: (path: string, encoding: 'base64' | 'utf8') => {
        const b64 = onDisk.get(path)
        if (b64 === undefined) return Promise.reject(new Error('ENOENT'))
        return Promise.resolve(
          encoding === 'base64' ? b64 : Buffer.from(b64, 'base64').toString('utf8'),
        )
      },
    },
  },
}))

vi.mock('@/lib/local-service', () => ({
  failed: (r: object) => 'failed' in r,
  send: (request: { body?: string }) => {
    const body = request.body ?? ''
    sent.push(body)
    return Promise.resolve({
      ok: true,
      status: 200,
      text: body.includes('"initialize"')
        ? JSON.stringify({ result: { serverInfo: { name: 'markitdown' } } })
        : JSON.stringify({ result: { content: [{ type: 'text', text: '# From MarkItDown' }] } }),
    })
  },
}))

const { convertDocument } = await import('./markitdown')

/** A minimal but real DOCX: a zip whose `word/document.xml` holds two runs. */
const docx = () =>
  Buffer.from(
    zipSync({
      'word/document.xml': strToU8(
        '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
          '<w:p><w:r><w:t>Curriculum vitae</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t>Taught CS 101</w:t></w:r></w:p>' +
          '</w:body></w:document>',
      ),
    }),
  ).toString('base64')

beforeEach(() => {
  onDisk.clear()
  sent.length = 0
})

describe('reading a document on the phone', () => {
  it('reads a DOCX on the handset with no reader address and no request', async () => {
    onDisk.set('/data/user/0/jojo/files/cv.docx', docx())

    const result = await convertDocument('', 'file:///data/user/0/jojo/files/cv.docx', 'cv.docx')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.markdown).toContain('Curriculum vitae')
    expect(result.markdown).toContain('Taught CS 101')
    expect(sent).toEqual([])
  })

  it('reads a plain text file on the handset too', async () => {
    onDisk.set(
      '/data/user/0/jojo/files/notes.txt',
      Buffer.from('Referee: Dr Rao').toString('base64'),
    )

    const result = await convertDocument(
      '',
      'file:///data/user/0/jojo/files/notes.txt',
      'notes.txt',
    )

    expect(result).toEqual({
      ok: true,
      markdown: expect.stringContaining('Referee: Dr Rao') as string,
    })
    expect(sent).toEqual([])
  })

  it('sends a PDF to the configured MarkItDown over the phone transport', async () => {
    onDisk.set('/data/user/0/jojo/files/cv.pdf', Buffer.from('%PDF-1.7').toString('base64'))

    const result = await convertDocument(
      'http://192.168.1.9:3001/mcp',
      'file:///data/user/0/jojo/files/cv.pdf',
      'cv.pdf',
    )

    expect(result).toEqual({ ok: true, markdown: '# From MarkItDown' })
    expect(sent.at(-1)).toContain('data:application/pdf;base64,')
  })
})
