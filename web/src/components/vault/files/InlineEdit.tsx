import { useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { Field } from '@/components/common/Field'
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
  onSave,
  onCancel,
}: {
  label: string
  value: string
  mono?: boolean
  /** Set where an empty value would leave the record unusable — a file's name. */
  required?: boolean
  onSave: (next: string) => void
  onCancel: () => void
}) {
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
    if (event.key !== 'Escape') return
    event.preventDefault()
    onCancel()
  }

  return (
    <form onSubmit={submit} onKeyDown={onKeyDown} className="flex flex-wrap items-end gap-2">
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
      <Button
        type="submit"
        size="sm"
        disabled={blocked}
        title={blocked ? 'A file needs a name' : undefined}
      >
        Save
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  )
}
