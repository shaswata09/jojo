/**
 * Q094 — "when user provides the URL … save the URL html to keep the job
 * posting for later use … open that link html file in an in-built page preview
 * panel", and the follow-up: it showed "No preview for this type".
 * Q232 — From link must save the page through the extension, filed with the
 * posting.
 *
 * A posting read from a link is kept one of two ways. Through the extension it
 * is filed by `useFileCapture`, the Capture button's own hook — its record is
 * `captureFileRecord`, pinned in `file-capture.test.ts` as a `page` in "Job
 * postings". Through the document reader it is `readerPageFile`, lifted out of
 * `useSavePage` for this test. Both must come out as an HTML `page` record the
 * Vault's viewer previews as a page — the joined path is asserted, not each
 * half on its own.
 */
import { describe, expect, it } from 'vitest'
import { previewKind } from '@/components/vault/file-preview'
import { readerPageFile } from './posting-agent'
import source from './posting-agent.ts?raw'

const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

describe('Q094 a posting read from its link is kept as an HTML page the viewer previews', () => {
  const url = 'https://jobs.rice.edu/postings/29411'
  const text = '# Assistant Professor\n\nRice University, Houston.\n\n- Teach <two> courses'
  const kept = readerPageFile(url, text, 'Rice University — Assistant Professor', '2026-08-22', '2026-08-22T10:00:00.000Z')

  it('is a page record in the postings drawer, named as an .html file, with its address', () => {
    expect(kept.record.kind).toBe('page')
    expect(kept.record.bucket).toBe('Job postings')
    expect(kept.name).toBe('Rice University — Assistant Professor.html')
    expect(kept.record.name).toBe(kept.name)
    expect(kept.record.sourceUrl).toBe(url)
  })

  it('stores an HTML document holding the posting, escaped, every line kept', () => {
    const html = new TextDecoder().decode(kept.bytes)
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('Rice University, Houston.')
    expect(html).toContain('Teach &lt;two&gt; courses')
    expect(html).toContain('white-space:pre-wrap')
  })

  it('opens in the page preview, not "No preview for this type"', () => {
    expect(previewKind(kept.record, new Blob([kept.bytes], { type: 'text/html' }))).toBe('page')
  })
})

describe('Q232 a page the extension opened is kept the way its Capture button keeps one', () => {
  it('files the extension’s capture through the capture inbox’s own hook', () => {
    expect(code).toMatch(
      /if \(page\.via === 'extension'\) \{\s*const filed = await fileCapture\(page\.capture\)/,
    )
  })

  it('keeps the page before the model is asked, and hands its id back with the draft', () => {
    const kept = code.indexOf("const file = already ?? (await savePage(page, target, ''))")
    const asked = code.indexOf("onStep?.('asking')")
    expect(kept).toBeGreaterThan(-1)
    expect(asked).toBeGreaterThan(kept)
    expect(code).toMatch(/file: named,/)
  })
})
