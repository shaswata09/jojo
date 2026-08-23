import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { Field, FormField } from '@/components/common/Field'
import { LabelChips, LabelPicker } from '@/components/common/LabelPicker'
import { Button } from '@/components/ui/button'
import { ApplicationPicker } from '@/components/vault/ApplicationPicker'
import { normalizeUrl, parseUrl } from '@/components/vault/links/url'
import { LINK_CATEGORIES } from '@/data/vault'
import type { LinkCategory, VaultLink } from '@/data/vault'
import { useVault } from '@jojo/service/react/use-vault'
import { useToast } from '@/lib/toast-context'

/**
 * Height and border of a Field's input, which a bare `select` cannot inherit.
 */
const SELECT_CLASS =
  'h-8 w-full cursor-pointer rounded-lg border border-input bg-transparent px-2 text-sm text-text-1 transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

/**
 * Correcting a saved link, in place.
 *
 * Its own component so the fields seed from the record on mount: held in the
 * list's state they would have to be re-seeded by hand every time a different
 * row opened, which is where half-edited values leak between records.
 */
export function LinkEditor({ link, onDone }: { link: VaultLink; onDone: () => void }) {
  const { updateLink } = useVault()
  const { toast } = useToast()

  const [title, setTitle] = useState(link.title)
  const [url, setUrl] = useState(link.url)
  const [category, setCategory] = useState<LinkCategory>(link.category)
  const [note, setNote] = useState(link.note ?? '')
  const [applicationIds, setApplicationIds] = useState<string[]>(link.applicationIds)
  const [submitted, setSubmitted] = useState(false)

  const categoryId = useId()
  const appFieldId = useId()

  const cleanUrl = normalizeUrl(url)
  const parsed = parseUrl(cleanUrl)

  const titleError = submitted && !title.trim() ? 'Give the link a title.' : undefined
  const urlError =
    submitted && !parsed ? 'That needs a host, like jobs.rice.edu/postings.' : undefined

  const save = (event: FormEvent) => {
    event.preventDefault()
    setSubmitted(true)
    if (!title.trim() || !parsed) return

    // Captured before the write, so Undo restores the record rather than the
    // values it has just been given.
    const before = {
      title: link.title,
      url: link.url,
      category: link.category,
      note: link.note,
      applicationIds: link.applicationIds,
    }

    updateLink(link.id, {
      title: title.trim(),
      url: cleanUrl,
      category,
      note: note.trim() || undefined,
      applicationIds,
    })
    toast({
      title: `${title.trim()} updated`,
      description: `Filed under ${category}.`,
      action: { label: 'Undo', onClick: () => updateLink(link.id, before) },
    })
    onDone()
  }

  return (
    // `noValidate`, because `required` stays on the fields for assistive tech and
    // the browser's own bubble would fire over the message written for the field.
    <form noValidate onSubmit={save} className="grid gap-3 py-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Title"
          required
          error={titleError}
          value={title}
          autoFocus
          autoComplete="off"
          onChange={(event) => setTitle(event.target.value)}
        />
        <Field
          label="URL"
          mono
          required
          error={urlError}
          value={url}
          autoComplete="off"
          onChange={(event) => setUrl(event.target.value)}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Category" htmlFor={categoryId}>
          <select
            id={categoryId}
            value={category}
            onChange={(event) => setCategory(event.target.value as LinkCategory)}
            className={SELECT_CLASS}
          >
            {LINK_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </FormField>

        <FormField
          label="Related application"
          htmlFor={appFieldId}
          hint="Files the link under a job, so both ends know about the other."
        >
          <ApplicationPicker
            id={appFieldId}
            what="link"
            values={applicationIds}
            onChange={setApplicationIds}
          />
        </FormField>
      </div>

      <Field
        label="Note"
        hint="One line about why this is worth keeping."
        value={note}
        autoComplete="off"
        onChange={(event) => setNote(event.target.value)}
      />

      <FormField
        label="Keywords"
        hint="Shared with applications, reminders and files — filtering by one finds all of them."
      >
        <div className="flex min-h-6 flex-wrap items-center gap-1.5">
          <LabelPicker recordId={link.id} />
          <LabelChips recordId={link.id} />
        </div>
      </FormField>

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onDone}>
          Cancel
        </Button>
        {/* Left enabled with a field empty: pressing it names the problem, where
            a disabled button leaves the user hunting for which one. */}
        <Button type="submit" size="sm">
          Save changes
        </Button>
      </div>
    </form>
  )
}
