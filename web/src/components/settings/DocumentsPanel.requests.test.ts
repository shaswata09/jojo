/**
 * Q274: "Download every document" produces ONE zip holding every document, not
 * a download per file.
 *
 * The archive itself is held by `lib/document-archive.test.ts` ("round-trips
 * every document byte for byte, under the names given"). What only exists in
 * the panel is that the button saves that archive, once — so D20 leaves a narrow
 * source read of the handler.
 */

import { describe, expect, it } from 'vitest'
import panel from './DocumentsPanel.tsx?raw'

const handler = /const downloadAll = async \(\) => \{[\s\S]*?\n {2}\}\n/.exec(panel)?.[0] ?? ''

describe('Q274 — Download every document saves one zip', () => {
  it('is the button’s handler', () => {
    expect(panel).toContain('onClick={() => void downloadAll()}')
    expect(handler).not.toBe('')
  })

  it('saves exactly once, and what it saves is the archive of every entry', () => {
    expect(handler.match(/\bsaveFile\(/g)).toHaveLength(1)
    expect(handler).toContain("saveFile(buildArchive(entries), name, 'application/zip')")
  })

  it('builds one entry per document it could read, under names that cannot collide', () => {
    expect(handler).toContain('const names = uniqueEntryNames(files.map((file) => file.name))')
    expect(handler).toMatch(/const entries = await Promise\.all\(\s*files\.map\(/)
  })

  it('saves nothing inside a loop over the documents', () => {
    const loops = handler.match(/\.(?:map|forEach)\([\s\S]*?\)\)/g) ?? []
    for (const loop of loops) expect(loop).not.toContain('saveFile(')
  })
})
