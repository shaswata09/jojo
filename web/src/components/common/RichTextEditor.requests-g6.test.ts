import { describe, expect, it } from 'vitest'
import notePanel from '@/components/applications/detail/NotePanel.tsx?raw'
import snippetEditor from '@/components/vault/snippets/SnippetEditor.tsx?raw'
import snippetsTool from '@/components/vault/SnippetsTool.tsx?raw'

/**
 * Q268 — application notes and snippets are written in the rich text editor,
 * and the formatting is saved with the text.
 *
 * The conversion itself — editor runs to stored spans and back — is pinned in
 * `lib/note-html.test.ts` and `core/note-format.test.ts`. This pins that both
 * editors hand that conversion's formatting to the store, rather than keeping
 * only the text. Source reads (D20); comments stripped.
 */
const strip = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

describe('an application’s note (Q268)', () => {
  const code = strip(notePanel)

  it('is edited in the rich text editor, opened on its stored formatting', () => {
    expect(code).toMatch(/<RichTextEditor\b/)
    expect(code).toMatch(/useState\(\(\) => htmlFromNote\(a\.note, stored\)\)/)
  })

  it('saves the formatting with the text', () => {
    expect(code).toMatch(/const \{ text, format, dropped \} = noteFromRuns\(rawRunsFromHtml\(html\)\)/)
    expect(code).toMatch(/const encoded = encodeFormat\(format\)/)
    expect(code).toMatch(/setNote\(a\.id, text, encoded \?\? ''\)/)
  })
})

describe('a snippet (Q268)', () => {
  it('is edited in the rich text editor', () => {
    expect(strip(snippetEditor)).toMatch(/<RichTextEditor\b/)
  })

  it('saves the formatting with the text, on edit and on create', () => {
    const code = strip(snippetsTool)
    expect(code).toMatch(/noteFromRuns\(rawRunsFromHtml\(editing\.html\)\)/)
    expect(code).toMatch(/const format = encodeFormat\(saving\.format\)/)
    expect(code).toMatch(/updateSnippet\([\s\S]*?format \?\? '',\s*\)/)
    expect(code).toMatch(/addSnippet\(\{[\s\S]*?\.\.\.\(format === undefined \? \{\} : \{ format \}\)/)
  })
})
