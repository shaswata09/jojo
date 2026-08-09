import { useId, useState } from 'react'
import { Pencil, Plus, Tag, Trash2 } from 'lucide-react'
import { Chip } from '@/components/common/Chip'
import { EmptyState } from '@/components/common/EmptyState'
import { SettingRow } from '@/components/common/Field'
import { DeleteKeywordDialog, ToneSwatches } from '@/components/common/LabelFilter'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Label } from '@/data/labels'
import { useLabels } from '@/lib/labels-context'

/** Whether two names are the same keyword. Folded, so case is not a difference. */
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

function usage(n: number) {
  return n === 0 ? 'Not on any record yet' : n === 1 ? 'Used on 1 record' : `Used on ${n} records`
}

/** One keyword: what it is called, what it costs to delete, and its colour. */
function KeywordRow({
  label,
  onRequestDelete,
}: {
  label: Label
  onRequestDelete: (id: string) => void
}) {
  const { countFor, renameLabel, setTone } = useLabels()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(label.name)
  const [error, setError] = useState<string | null>(null)
  const fieldId = useId()
  const errorId = `${fieldId}-error`
  const used = countFor(label.id)

  // Reset on the way in rather than on the way out: an abandoned edit should
  // not still be sitting in the box the next time the pencil is pressed.
  const startEditing = () => {
    setDraft(label.name)
    setError(null)
    setEditing(true)
  }

  const save = () => {
    const next = draft.trim()
    if (next !== label.name && !renameLabel(label.id, next)) {
      setError(next ? 'Another keyword already has that name.' : 'A keyword needs a name.')
      return
    }
    setEditing(false)
  }

  return (
    <SettingRow
      label={
        editing ? (
          <div className="space-y-1.5">
            <label htmlFor={fieldId} className="sr-only">
              Rename {label.name}
            </label>
            <div className="flex items-center gap-1.5">
              <Input
                id={fieldId}
                autoFocus
                value={draft}
                autoComplete="off"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                className="h-7 w-44"
                onChange={(e) => {
                  setDraft(e.target.value)
                  setError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    save()
                  }
                  if (e.key === 'Escape') setEditing(false)
                }}
              />
              <Button size="xs" onClick={save} disabled={!draft.trim()}>
                Save
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
            {error ? (
              <p id={errorId} role="alert" className="text-xs text-danger">
                {error}
              </p>
            ) : null}
          </div>
        ) : (
          <Chip tone={label.tone} shape="capsule">
            {label.name}
          </Chip>
        )
      }
      description={usage(used)}
      control={
        <div className="flex items-center gap-1.5">
          <ToneSwatches
            label={label.name}
            value={label.tone}
            onChange={(tone) => setTone(label.id, tone)}
            className="mr-1"
          />
          {/* Rendered in both states rather than swapped out: SettingRow's
              control cell is shrink-0, so a button appearing and disappearing
              would shunt the swatches sideways every time an edit started. */}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-pressed={editing}
            aria-label={`Rename ${label.name}`}
            title="Rename"
            onClick={() => (editing ? setEditing(false) : startEditing())}
          >
            <Pencil className="size-3.5" strokeWidth={1.9} aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${label.name}`}
            title="Delete"
            className="text-text-3 hover:bg-danger-soft hover:text-danger"
            onClick={() => onRequestDelete(label.id)}
          >
            <Trash2 className="size-3.5" strokeWidth={1.9} aria-hidden />
          </Button>
        </div>
      }
    />
  )
}

/**
 * The one screen where the keyword set itself can be edited.
 *
 * Every other surface tags a record: pickers add keywords and the filter selects
 * them, so the list could only ever grow and a typo was permanent. This is where
 * a keyword gets renamed, recoloured or taken off everything at once — which is
 * why the usage count sits beside each one. Deleting "Research" is a different
 * decision at 0 records and at 24.
 *
 * Mounted at the foot of Settings, under "Your data" — which is the panel that
 * says keywords are not in the JSON export. They are the one collection the
 * export and the demo-data controls there do not touch, so the place to manage
 * them is the place that admits it.
 */
export function KeywordManager() {
  const { labels, addLabel } = useLabels()
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const newId = useId()
  const errorId = `${newId}-error`

  const add = () => {
    const name = draft.trim()
    if (!name) return
    // `addLabel` quietly hands back the existing id for a name that is taken,
    // which is right in a picker — it selects what you meant — and wrong here,
    // where the row would not move and nothing would appear to have happened.
    if (labels.some((l) => sameName(l.name, name))) {
      setError('That keyword already exists.')
      return
    }
    addLabel(name)
    setDraft('')
    setError(null)
  }

  return (
    <Panel>
      <PanelTitle hint="shared by every record">Keywords</PanelTitle>
      <p className="mb-3 text-sm text-text-2">
        One set across applications, reminders and the vault. Renaming one carries everywhere it is
        shown; deleting one takes it off every record that carries it.
      </p>

      {labels.length === 0 ? (
        <EmptyState
          icon={Tag}
          title="No keywords yet"
          description="Add one below, or from the keyword filter above any list. Keywords are yours — they are not the fixed role tags in the top bar."
        />
      ) : (
        // Wrapped, so SettingRow's `first:border-t-0` matches. Left as direct
        // children of the Panel the heading holds :first-child and every row
        // draws its divider, including a stray one under the title.
        <div>
          {labels.map((l) => (
            <KeywordRow key={l.id} label={l} onRequestDelete={setPendingDelete} />
          ))}
        </div>
      )}

      <form
        className="mt-4 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <label htmlFor={newId} className="sr-only">
          New keyword
        </label>
        <Input
          id={newId}
          value={draft}
          autoComplete="off"
          placeholder="e.g. Referral"
          className="w-52"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => {
            setDraft(e.target.value)
            setError(null)
          }}
        />
        <Button type="submit" size="sm" disabled={!draft.trim()}>
          <Plus className="size-3.5" strokeWidth={2} aria-hidden />
          Add keyword
        </Button>
        {error ? (
          <p id={errorId} role="alert" className="w-full text-xs text-danger">
            {error}
          </p>
        ) : null}
      </form>

      <DeleteKeywordDialog
        id={pendingDelete}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null)
        }}
      />
    </Panel>
  )
}
