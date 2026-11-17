import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FormEvent, KeyboardEvent } from 'react'
import { Field, TextareaField } from '@/components/common/Field'
import { Button } from '@/components/ui/button'

/**
 * One field, edited where it is read.
 *
 * Renaming a file and correcting its note are the same interaction with a
 * different label, and neither is worth a dialog — the value being changed is
 * already on screen, and a modal would cover the row it came from.
 */
export function InlineEdit({
  label,
  value,
  mono,
  required,
  multiline,
  onSave,
  onCancel,
}: {
  label: string
  value: string
  mono?: boolean
  /** Set where an empty value would leave the record unusable — a file's name. */
  required?: boolean
  /**
   * A textarea rather than an input — for a file's note. Notes are written in
   * the viewer's block editor and can hold paragraph breaks; an <input> strips
   * the line feeds from its value, so the first keystroke here ran the
   * paragraphs together and Save stored "Line oneLine two".
   */
  multiline?: boolean
  onSave: (next: string) => void
  onCancel: () => void
}) {
  const { t } = useTranslation('vault')
  const [draft, setDraft] = useState(value)
  const blocked = Boolean(required) && !draft.trim()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (blocked) return
    onSave(draft.trim())
  }

  // Escape backs out of an inline editor everywhere else in this app; a row that
  // could only be left with the mouse would be the odd one out.
  const onKeyDown = (event: KeyboardEvent) => {
    // Enter is a new line in a textarea, so ⌘/Ctrl+Enter is its Save.
    if (multiline && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      if (!blocked) onSave(draft.trim())
      return
    }
    if (event.key !== 'Escape') return
    event.preventDefault()
    onCancel()
  }

  return (
    <form onSubmit={submit} onKeyDown={onKeyDown} className="flex flex-wrap items-end gap-2">
      {multiline ? (
        <TextareaField
          label={label}
          value={draft}
          mono={mono}
          autoFocus
          rows={Math.min(6, Math.max(2, draft.split('\n').length))}
          className="min-w-[12rem] flex-1"
          onChange={(event) => setDraft(event.target.value)}
        />
      ) : (
        <Field
          label={label}
          value={draft}
          mono={mono}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          className="min-w-[12rem] flex-1"
          onChange={(event) => setDraft(event.target.value)}
        />
      )}
      <Button
        type="submit"
        size="sm"
        disabled={blocked}
        title={blocked ? t('files.inlineEdit.needsName') : undefined}
      >
        {t('common.save')}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        {t('common.cancel')}
      </Button>
    </form>
  )
}
