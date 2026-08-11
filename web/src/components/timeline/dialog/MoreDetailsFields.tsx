import { FormField, TextareaField } from '@/components/common/Field'
import { KeywordPicker } from '@/components/common/KeywordPicker'

/**
 * Folded, not deleted. These two are the fields nobody fills in on the way to
 * saving a reminder, and open they pushed Save off a 900px screen. `<details>`
 * rather than state, so the browser handles the expanded/collapsed semantics and
 * find-in-page still reaches inside.
 */
export function MoreDetailsFields({
  note,
  onNoteChange,
  keywords,
  onKeywordsChange,
}: {
  note: string
  onNoteChange: (next: string) => void
  keywords: string[]
  onKeywordsChange: (next: string[]) => void
}) {
  return (
    <details className="group rounded-lg border border-hairline">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-text-2 transition-colors hover:text-text-1">
        More details
        <span className="text-xs text-text-3">
          {[note.trim() ? 'note' : null, keywords.length > 0 ? 'keywords' : null]
            .filter(Boolean)
            .join(' · ') || 'note, keywords'}
        </span>
      </summary>
      <div className="grid gap-3.5 border-t border-hairline px-3 py-3">
        <TextareaField
          label="Note"
          hint="Your own scribble. Kept apart from the detail, so an edit never clobbers it."
          rows={2}
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
        />

        <FormField
          label="Keywords"
          hint="Shared with applications, files and links — filtering by one finds all of them."
        >
          <KeywordPicker value={keywords} onChange={onKeywordsChange} />
        </FormField>
      </div>
    </details>
  )
}
