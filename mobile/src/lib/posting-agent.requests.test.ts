/**
 * Q094 on the phone — "the application across three platforms should save the
 * URL html … open that link html file in an in-built page preview."
 *
 * The phone keeps a posting read from its link the way web does: the reader's
 * text wrapped into an HTML document (`postingDocument`, tested in the
 * service), recorded as a `page` in "Job postings" and written to disk under
 * the record's id; the create sheet files it under the new application; and
 * the viewer opens a `page` in-app rather than handing it off. These files
 * import React Native, which this runner does not load, so they are read as
 * text with comments removed. Web's half is
 * `web/src/lib/posting-agent.requests.test.ts`.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) =>
  readFileSync(path.join(SRC, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

describe('Q094 a posting read from its link is kept on the phone and opens in-app', () => {
  it('saves the page as an HTML page record in the postings drawer, with its bytes on disk', () => {
    const agent = read('lib/posting-agent.ts')
    expect(agent).toMatch(/const html = postingDocument\(target, page\.markdown\)/)
    expect(agent).toMatch(/addFile\(\{\s*name,\s*kind: 'page',\s*bucket: 'Job postings',/)
    expect(agent).toMatch(/const uri = await writeCapture\(file\.id, html\)\s*updateFile\(file\.id, \{ uri \}\)/)
  })

  it('files the kept page under the application the sheet creates', () => {
    expect(read('sheets/ApplicationSheet.tsx')).toMatch(
      /if \(posting\) \{\s*vault\.updateFile\(posting\.id, \{\s*applicationIds: \[\.\.\.new Set\(\[\.\.\.posting\.applicationIds, created\.id\]\)\],/,
    )
  })

  it('offers to read a kept page in the app instead of handing it to another one', () => {
    expect(read('screens/vault/FileViewer.tsx')).toMatch(
      /file\.kind === 'page' \? \(\s*<EmptyState[\s\S]{0,400}?onPress=\{\(\) => setReading\(true\)\}/,
    )
  })
})
