import { describe, expect, it } from 'vitest'
import { noteHtml, noteValue } from './RichTextEditorNote'
import fieldSource from './RichTextEditorField.tsx?raw'
import applicationFields from '@/components/applications/dialog/ApplicationFields.tsx?raw'
import transitionFields from '@/components/applications/dialog/TransitionFields.tsx?raw'
import itemForm from '@/components/timeline/dialog/ItemForm.tsx?raw'
import peopleTool from '@/components/vault/PeopleTool.tsx?raw'
import snippetEditor from '@/components/vault/snippets/SnippetEditor.tsx?raw'
import vaultEn from '@/i18n/locales/en/vault.json'

/**
 * Q268 — anywhere there is a text edit, the person can use size, colour, bold,
 * italic and the rest, and the formatting persists with the text.
 *
 * The application note and the snippets already did (`RichTextEditor.requests-g6`).
 * This holds the four Notes that were still plain textareas — the edit
 * dialog's, the offer's, a timeline item's and a person's — to the same editor
 * and the same storage: the text in the form as before, the formatting encoded
 * beside it. What the tools do with the two is `service/kg/tools/rich-notes.requests.test.ts`.
 *
 * The conversions are pure and tested as values; the JSX wiring is read as
 * source (D20), comments stripped.
 */
const strip = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

describe('the rich note field’s conversions (Q268)', () => {
  it('opens a note saved before notes could be formatted as exactly its text', () => {
    expect(noteHtml('Ask about\nthe panel', undefined)).toBe('<p>Ask about</p><p>the panel</p>')
    expect(noteHtml('Ask about', '')).toBe('<p>Ask about</p>')
    expect(noteHtml('', undefined)).toBe('<p><br></p>')
  })

  it('hands the form the text and the formatting, encoded', () => {
    expect(noteValue([{ text: 'Ask ' }, { text: 'about', bold: true }])).toEqual({
      text: 'Ask about',
      format: '4-9:b::',
    })
  })

  it('says "none" rather than nothing for a plain note, so clearing the bold clears it', () => {
    expect(noteValue([{ text: 'Ask about' }])).toEqual({ text: 'Ask about', format: '' })
  })

  it('opens again on the formatting it saved', () => {
    const saved = noteValue([{ text: 'Ask ' }, { text: 'about', bold: true }])
    expect(noteHtml(saved.text, saved.format)).toBe('<p>Ask <span style="font-weight: 700">about</span></p>')
  })
})

describe('the field itself (Q268)', () => {
  const code = strip(fieldSource)

  it('is the inline rich text editor, opened on the stored formatting', () => {
    expect(code).toMatch(/<RichTextEditor\b[\s\S]*?\binlineOnly\b/)
    expect(code).toMatch(/useState\(\(\) => noteHtml\(text, format\)\)/)
  })

  it('reports the text and the formatting on every edit', () => {
    expect(code).toMatch(/const value = noteValue\(rawRunsFromHtml\(next\)\)/)
    expect(code).toMatch(/onChange\(value\.text, value\.format\)/)
  })
})

describe('every form’s Note is the rich note field (Q268)', () => {
  it.each([
    ['the application edit dialog', applicationFields],
    ['the offer, on a stage move', transitionFields],
    ['a timeline item', itemForm],
    ['a person', peopleTool],
  ])('%s', (_name, src) => {
    const code = strip(src)
    // The label is "Note", in source or as a catalog key with a `note` segment.
    const note = String.raw`label=(?:"Note"|\{t\('[\w:.]*\bnote\b[\w.]*'\)\})`
    expect(code).not.toMatch(new RegExp(String.raw`<TextareaField\s+` + note))
    expect(code).toMatch(new RegExp(String.raw`<RichNoteField\s+` + note))
  })
})

describe('each form keeps the formatting with the text (Q268)', () => {
  it('the edit dialog sets the text and hands the formatting to the dialog', () => {
    const code = strip(applicationFields)
    expect(code).toMatch(/format=\{noteFormat\}/)
    expect(code).toMatch(/set\('note', text\)\s*onNoteFormatChange\?\.\(format\)/)
  })

  it('the offer hands both to the stage dialog', () => {
    const code = strip(transitionFields)
    expect(code).toMatch(/format=\{offerNoteFormat\}\s*onChange=\{onOfferNoteChange\}/)
  })

  it('a timeline item opens on its stored formatting and saves it, on edit and on create', () => {
    const code = strip(itemForm)
    expect(code).toMatch(/encodeFormat\(graph\.node\(editingId as NodeId, 'timelineItem'\)\?\.props\.noteFormat\)/)
    expect(code).toMatch(/const write = \{ \.\.\.patch, format: noteFormat \}/)
    expect(code).toMatch(/update\(editingId, write\)/)
    expect(code).toMatch(/saved = add\(write\)/)
  })

  it('a person opens on their stored formatting and saves it', () => {
    const code = strip(peopleTool)
    expect(code).toMatch(/encodeFormat\(graph\.node\(person\.id as NodeId, 'person'\)\?\.props\.noteFormat\)/)
    expect(code).toMatch(/onSave\(\{ \.\.\.draft, name: draft\.name\.trim\(\), format \}\)/)
  })
})

describe('the snippet editor’s hint (Q268)', () => {
  it('no longer says the formatting is thrown away, because it is saved', () => {
    const code = strip(snippetEditor)
    expect(code).not.toMatch(/the formatting buttons do not/)
    expect(code).toMatch(/hint=\{t\('snippets\.editor\.text\.hint'\)\}/)
    const hint = vaultEn.snippets.editor.text.hint
    expect(hint).not.toMatch(/the formatting buttons do not/)
    expect(hint).toMatch(/^Size, colour, bold, italic, underline and strikethrough are saved with the text\./)
  })
})
