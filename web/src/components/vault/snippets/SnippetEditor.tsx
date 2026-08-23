import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { X } from 'lucide-react'
import { Field, FormField } from '@/components/common/Field'
import { ApplicationPicker } from '@/components/vault/ApplicationPicker'
import { ExpandButton, FullScreenDialog } from '@/components/common/FullScreen'
import { KeywordPicker } from '@/components/common/KeywordPicker'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { RichTextEditor } from '@/components/common/RichTextEditor'
import { Segment } from '@/components/common/Segment'
import { Button } from '@/components/ui/button'
import type { Draft } from '@/components/vault/snippets/model'
import { SNIPPET_TAGS } from '@/data/vault'
import { cn } from '@/lib/utils'

const TAG_OPTIONS = SNIPPET_TAGS.map((t) => ({ value: t, label: t }))

/**
 * One form, rendered either in the side panel or full screen.
 *
 * Everything the card offers — title, kind, keywords, delete, save — goes with
 * it, because an editor that drops half its controls when it gets bigger is the
 * wrong way round. The draft lives in the tool above this, so moving between
 * the two costs the caret and nothing else.
 */
export function SnippetEditor({
  editing,
  setEditing,
  dirty,
  full,
  setFullText,
  titleError,
  bodyError,
  save,
  requestClose,
  onDelete,
}: {
  editing: Draft
  setEditing: Dispatch<SetStateAction<Draft | null>>
  /** Drives the "Unsaved changes" hint — the tool owns the comparison. */
  dirty: boolean
  /** Whether the snippet text is being written full screen. */
  full: boolean
  setFullText: (next: boolean) => void
  titleError?: string
  bodyError?: string
  save: (event: FormEvent) => void
  /** Goes through the discard check, which is why it is not `closeEditor`. */
  requestClose: () => void
  onDelete: (id: string) => void
}) {
  const form = (
    /* noValidate: `required` stays on the fields for assistive tech,
       and without it the browser's own bubble fires over the message
       written for the field. */
    <form
      noValidate
      onSubmit={save}
      className={cn('flex min-h-0 flex-col gap-3', full && 'flex-1 overflow-y-auto')}
    >
      <div className="flex items-start justify-between gap-3">
        <PanelTitle className="mb-0" hint={dirty ? 'Unsaved changes' : undefined}>
          {editing.id ? 'Edit snippet' : 'New snippet'}
        </PanelTitle>
        {/* Dropped full screen, where the dialog already puts an X in
            the same corner — two dismissals stacked on top of each
            other read as two different scopes when the one below is
            just the way out. Kept in the side panel, which has no
            chrome of its own and would otherwise have no exit but
            Cancel at the foot of the form. */}
        {full ? null : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={requestClose}
            className="shrink-0"
          >
            <X className="size-3.5" strokeWidth={2} aria-hidden />
            Close
          </Button>
        )}
      </div>

      <Field
        label="Title"
        required
        error={titleError}
        value={editing.title}
        autoComplete="off"
        placeholder="e.g. Why this department"
        onChange={(event) =>
          setEditing((prev) => (prev ? { ...prev, title: event.target.value } : prev))
        }
      />

      <FormField label="Kind" hint="Where it files, and which chip the list shows.">
        <Segment
          label="Kind"
          options={TAG_OPTIONS}
          value={editing.tag}
          onChange={(next) => setEditing((prev) => (prev ? { ...prev, tag: next } : prev))}
          className="flex-wrap gap-1 rounded-xl"
        />
      </FormField>

      <FormField
        label="Related application"
        hint="One job per snippet. It then shows on that application's page."
      >
        <ApplicationPicker
          what="snippet"
          value={editing.applicationId}
          onChange={(id) =>
            setEditing((prev) => (prev ? { ...prev, applicationId: id } : prev))
          }
        />
      </FormField>

      <FormField
        label="Text"
        required
        error={bodyError}
        hint="Stored as plain text — line breaks survive, the formatting buttons do not."
      >
        <div className="relative">
          {/* Over the toolbar's right end rather than beside the field
          label: it acts on the editor, and the editor is what it sits
          on. z-[1] clears the toolbar's own background. Hidden once
          expanded — the dialog's own close is the way back. */}
          {full ? null : (
            <ExpandButton
              onClick={() => setFullText(true)}
              label="Write full screen"
              className="absolute top-1.5 right-1.5 z-[1]"
            />
          )}
          <RichTextEditor
            value={editing.html}
            onChange={(html) => setEditing((prev) => (prev ? { ...prev, html } : prev))}
            placeholder="Write the paragraph you keep rewriting…"
            className={full ? 'min-h-0 flex-1' : undefined}
          />
        </div>
      </FormField>

      <FormField
        label="Keywords"
        hint="Shared with applications, reminders and files — filtering by one finds all of them."
      >
        <KeywordPicker
          value={editing.keywords}
          onChange={(next) => setEditing((prev) => (prev ? { ...prev, keywords: next } : prev))}
        />
      </FormField>

      <div
        className={cn(
          'flex flex-wrap items-center gap-2 border-t border-hairline pt-3',
          editing.id ? 'justify-between' : 'justify-end',
        )}
      >
        {editing.id ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => onDelete(editing.id as string)}
          >
            Delete
          </Button>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={requestClose}>
            Cancel
          </Button>
          {/* Left enabled with a field empty: pressing it names the missing
          one, where a disabled button leaves the user hunting. */}
          <Button type="submit" size="sm">
            Save
          </Button>
        </div>
      </div>

      {/* Was "saved snippets live in this tab only — a reload puts
          the seeded set back", written when they did. They are
          records in the store now and a reload brings back what you
          wrote, so the line that is worth the space is the one about
          where they are usable. */}
      <p className="text-xs text-text-3">
        Saved to the database in this browser — it is here when you come back.
      </p>
    </form>
  )

  return full ? (
    <FullScreenDialog
      open
      onOpenChange={(next) => setFullText(next)}
      title={editing.title.trim() || 'New snippet'}
      description="Editing the snippet full screen. Press Escape to go back."
    >
      {form}
    </FullScreenDialog>
  ) : (
    <Panel className="flex min-w-0 flex-1 basis-[380px] flex-col">{form}</Panel>
  )
}
