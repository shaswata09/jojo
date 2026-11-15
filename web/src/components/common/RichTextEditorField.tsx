import { useState } from 'react'
import type { ReactNode } from 'react'
import { FormField } from '@/components/common/Field'
import { RichTextEditor } from '@/components/common/RichTextEditor'
import { noteHtml, noteValue } from '@/components/common/RichTextEditorNote'
import { rawRunsFromHtml } from '@/lib/note-runs'

/**
 * A form's Note, written in the rich text editor: size, colour, bold, italic,
 * underline and strikethrough, kept with the text when the form saves.
 *
 * The note the application panel and the snippets already had, made a field so
 * that every other form's Note — the edit dialog, the offer, a timeline item, a
 * person — is the same editor saving the same way (Q268). The form keeps
 * holding the TEXT, exactly as its `TextareaField` did, and gains the encoded
 * formatting beside it; `onChange` hands back both after every edit.
 *
 * Inline only, as the note panel is: the store keeps spans over one string, and
 * a list or a table would have nowhere to go.
 *
 * The HTML is held here, opened once from what the form was given. Rebuilding
 * it from the props on every keystroke would put the caret back at the start
 * of the box each time, which is the trap `RichTextEditor` itself documents —
 * so a form that resets its note has to remount the field (give it a `key`).
 */
export function RichNoteField({
  label,
  hint,
  text,
  format,
  onChange,
  placeholder,
  className,
}: {
  label: string
  hint?: ReactNode
  text: string
  /** `encodeFormat`'s string. Absent or `''` is a plain note. */
  format?: string | undefined
  onChange: (text: string, format: string) => void
  placeholder?: string
  className?: string
}) {
  const [html, setHtml] = useState(() => noteHtml(text, format))

  return (
    <FormField label={label} hint={hint} className={className}>
      <RichTextEditor
        value={html}
        onChange={(next) => {
          setHtml(next)
          const value = noteValue(rawRunsFromHtml(next))
          onChange(value.text, value.format)
        }}
        inlineOnly
        placeholder={placeholder}
        ariaLabel={label}
        surfaceClassName="min-h-[5.5rem]"
      />
    </FormField>
  )
}
