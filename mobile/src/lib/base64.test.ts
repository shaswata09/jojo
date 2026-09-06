import { strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { textFrom } from '@jojo/service/agent/documents'
import { bytesFromBase64 } from '@/lib/base64'

/**
 * The chain, minus the filesystem.
 *
 * `readOnDevice` itself needs `ReactNativeBlobUtil`, which needs a device. What
 * it does BETWEEN the file and the text is testable here in full — base64 in,
 * bytes out, unzip, extract — and that is where every failure worth catching
 * lives. The filesystem call it wraps is one line and the same one
 * `markitdown.ts` has been making since before this existed.
 */

/** Node has `Buffer`; the app deliberately does not. That asymmetry is the test. */
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')

describe('decoding base64 into exact bytes', () => {
  it('round-trips every byte value', () => {
    // A zip is binary from its second byte. "Nearly right" is not a category
    // that exists here.
    const all = new Uint8Array(256)
    for (let i = 0; i < 256; i += 1) all[i] = i
    expect([...bytesFromBase64(base64(all))]).toEqual([...all])
  })

  it.each([0, 1, 2, 3, 4, 5, 6, 7])('gets the length right at %i bytes of padding', (n) => {
    /*
     * THE off-by-one that matters. `(length * 3) >> 2` over-allocates whenever
     * the input was padded, and a trailing zero byte is not harmless in a zip:
     * the central directory is located from the END of the file, so one extra
     * byte moves it and `unzipSync` reports the archive as corrupt.
     */
    const bytes = new Uint8Array(n).fill(0xab)
    expect(bytesFromBase64(base64(bytes)).length).toBe(n)
  })

  it('ignores the line breaks a base64 payload may carry', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5])
    const wrapped = base64(bytes).replace(/(.{2})/g, '$1\n')
    expect([...bytesFromBase64(wrapped)]).toEqual([...bytes])
  })
})

describe('a real archive, end to end', () => {
  /** A DOCX is a zip with `word/document.xml` in it. This is one. */
  const docx = (body: string) =>
    zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
      ),
    })

  it('goes from a base64 DOCX to the text inside it', () => {
    const archive = docx(
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Publications</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t xml:space="preserve">A paper about </w:t></w:r><w:r><w:t>rice.</w:t></w:r></w:p>',
    )
    const files = unzipSync(bytesFromBase64(base64(archive)))
    const parts = new Map([['word/document.xml', new TextDecoder().decode(files['word/document.xml'])]])

    expect(textFrom('ooxml-word', parts)).toBe('# Publications\nA paper about rice.')
  })

  it('survives an archive big enough to need real offsets', () => {
    // A one-entry toy zip can hide a length bug that a realistic one exposes,
    // because small archives keep every offset inside a single byte.
    const filler = 'x'.repeat(200_000)
    const archive = docx(`<w:p><w:r><w:t>${filler}</w:t></w:r></w:p>`)
    const files = unzipSync(bytesFromBase64(base64(archive)))
    expect(new TextDecoder().decode(files['word/document.xml'])).toContain(filler)
  })
})
