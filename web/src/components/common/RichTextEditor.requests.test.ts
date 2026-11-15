import { describe, expect, it } from 'vitest'
import editorSource from './RichTextEditor.tsx?raw'
import snippetEditorSource from '@/components/vault/snippets/SnippetEditor.tsx?raw'
import filesToolSource from '@/components/vault/FilesTool.tsx?raw'
import previewDialogSource from '@/components/vault/FilePreviewDialog.tsx?raw'
import fileViewerSource from '@/components/vault/FileViewer.tsx?raw'

/**
 * Q057: Vault files open in an in-app viewer, and snippets are written in a
 * rich text editor with font size, bold, italic, underline, strike, bullets,
 * a table and text colour.
 *
 * The toolbar is JSX over `document.execCommand`, which nothing in a node test
 * can run (D20), so the commands each button sends are pinned as source. What
 * the editor's HTML becomes afterwards is `lib/note-html.test.ts`'s job; what
 * a file can preview as is `vault/file-preview.test.ts`'s.
 */

const strip = (source: string) =>
  source.replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')

const editor = strip(editorSource)

describe('the rich text toolbar (Q057)', () => {
  it('has a font size control wired to the fontSize command', () => {
    expect(editor).toMatch(/onChange=\{\(e\) => exec\('fontSize', e\.target\.value\)\}/)
    expect(editor).toContain('SIZES.map(')
  })

  it.each([
    ['bold', 'Bold'],
    ['italic', 'Italic'],
    ['underline', 'Underline'],
    ['strikeThrough', 'Strikethrough'],
    ['insertUnorderedList', 'Bullet list'],
  ])('has a %s button', (cmd, label) => {
    expect(editor).toContain(`{ cmd: '${cmd}', icon: `)
    expect(editor).toContain(`label: '${label}' }`)
  })

  it('sends each mark and list button its own command', () => {
    expect(editor).toMatch(/MARKS\.map\([\s\S]*?onClick=\{\(\) => exec\(cmd\)\}/)
    expect(editor).toMatch(/LISTS\.map\([\s\S]*?onClick=\{\(\) => exec\(cmd\)\}/)
  })

  it('inserts a table', () => {
    expect(editor).toMatch(/aria-label="Insert table"\s+onClick=\{\(\) => exec\('insertHTML', TABLE_HTML\)\}/)
  })

  it('sets the text colour', () => {
    expect(editor).toContain('aria-label="Text colour"')
    expect(editor).toMatch(/exec\('foreColor', c\.value\)/)
  })
})

describe('snippets are written in it (Q057)', () => {
  it('uses the full toolbar, not the inline-only one', () => {
    const snippet = strip(snippetEditorSource)
    const element = /<RichTextEditor\b[\s\S]*?\/>/.exec(snippet)?.[0] ?? ''
    expect(element).not.toBe('')
    // `inlineOnly` drops the list and table buttons.
    expect(element).not.toContain('inlineOnly')
  })
})

describe('files open in the app (Q057)', () => {
  it('shows a picked file in the Vault’s own viewer, and the preview dialog reuses it', () => {
    expect(strip(filesToolSource)).toMatch(/<FileViewer\b/)
    expect(strip(previewDialogSource)).toMatch(/<FileViewer file=\{shown\}/)
  })

  it('draws a PDF in a frame inside the page rather than handing it off', () => {
    expect(strip(fileViewerSource)).toMatch(/<iframe\s+key=\{url\}\s+src=\{url\}/)
  })
})
