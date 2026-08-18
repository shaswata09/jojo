import { useId, useState } from 'react'
import { Link as LinkIcon, Plus } from 'lucide-react'
import { draftFromUrl } from '@/components/applications/draft-from'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useDialogs } from '@/lib/dialogs-context'
import { cn } from '@/lib/utils'

/**
 * Paste a posting URL and start an application from it.
 *
 * Shared by the dashboard's quick-add panel and the Applications page header,
 * so the two cannot drift apart — the placeholder and field width differ, the
 * behaviour does not.
 *
 * Nothing is saved from here. The URL is turned into a guess and handed to the
 * application dialog, which is the only thing that writes: the employer read
 * out of a hostname is wrong often enough that a silent save would file records
 * under names nobody chose. See `draft-from.ts`.
 */
export function AddByUrl({
  className,
  fieldClassName,
  placeholder = 'Paste a job posting URL to start from',
  /**
   * Shortened where a primary "New application" button sits beside this one:
   * two adjacent buttons both reading "Add application" is a choice nobody can
   * make without clicking one to find out.
   */
  submitLabel = 'Add application',
}: {
  className?: string
  fieldClassName?: string
  placeholder?: string
  submitLabel?: string
}) {
  // Generated, not a literal: both call sites can mount at once and a duplicate
  // id would point every label at the first field.
  const id = useId()
  const { open } = useDialogs()
  const [url, setUrl] = useState('')

  const submit = () => {
    const text = url.trim()
    if (!text) return
    open('application', { mode: 'create', initial: draftFromUrl(text) })
    // Cleared, because the URL now lives in the form. Left behind, a second
    // Enter would start a duplicate record from a field that looks like it has
    // already been dealt with.
    setUrl('')
  }

  return (
    <form
      className={cn('flex flex-wrap items-center gap-2', className)}
      // `type="url"` is kept for the mobile keyboard, but its native validation
      // is not: it rejects 'boards.greenhouse.io/acme/jobs/4' outright, which is
      // exactly the scheme-less paste `draftFromUrl` is written to accept.
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <label htmlFor={id} className="sr-only">
        Job posting URL
      </label>

      <div className={cn('relative min-w-0 flex-1', fieldClassName)}>
        <LinkIcon
          aria-hidden
          strokeWidth={1.8}
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-3"
        />
        <Input
          id={id}
          type="url"
          inputMode="url"
          autoComplete="off"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={placeholder}
          className="pl-8"
        />
      </div>

      <Button
        type="submit"
        size="sm"
        // Disabled only while there is nothing to work with, and it says so.
        disabled={!url.trim()}
        title={url.trim() ? undefined : 'Paste a posting URL first'}
        className="shrink-0"
      >
        <Plus className="size-3.5" strokeWidth={2} aria-hidden />
        {submitLabel}
      </Button>
    </form>
  )
}
