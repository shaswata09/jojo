import { useId, useState } from 'react'
import { Link as LinkIcon, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { addByUrlDialog } from '@/components/applications/add-by-url'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useDialogs } from '@/lib/dialogs-context'
import { isConfigured } from '@/lib/llm'
import { useModelSettings } from '@/lib/model-settings-context'
import { cn } from '@/lib/utils'

/**
 * Paste a posting URL and start an application from it.
 *
 * Shared by the dashboard's quick-add panel and the Applications page header,
 * so the two cannot drift apart — the placeholder and field width differ, the
 * behaviour does not.
 *
 * With a model connected, the page is READ: "From link" opens the reader
 * dialog on this URL and starts it, so the model fills the form from the
 * posting and the extension keeps the page. Without one, the URL is turned into
 * a guess — employer from the hostname, role from the last path segment — and
 * handed straight to the form. The button used to do only the second whatever
 * was connected, so a person with a model running pasted a link, pressed the
 * button labelled for it, and got a guess from the address; the model path
 * existed only behind a create-menu item they had no reason to look for.
 *
 * Nothing is saved as an application from here either way. The form is the
 * only thing that writes one: the employer read out of a hostname is wrong
 * often enough that a silent save would file records under names nobody chose.
 * See `draft-from.ts`.
 */
export function AddByUrl({
  className,
  fieldClassName,
  placeholder,
  /**
   * Shortened where a primary "New application" button sits beside this one:
   * two adjacent buttons both reading "Add application" is a choice nobody can
   * make without clicking one to find out.
   */
  submitLabel,
}: {
  className?: string
  fieldClassName?: string
  placeholder?: string
  submitLabel?: string
}) {
  // Generated, not a literal: both call sites can mount at once and a duplicate
  // id would point every label at the first field.
  const id = useId()
  const { t } = useTranslation('applications')
  const { open } = useDialogs()
  const { settings } = useModelSettings()
  const connected = isConfigured(settings)
  const [url, setUrl] = useState('')

  const submit = () => {
    const next = addByUrlDialog(url, connected)
    if (!next) return
    open(next.name, next.props)
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
        {t('addByUrl.fieldLabel')}
      </label>

      {/* `dir="ltr"` on the box, not just the input: a URL reads left to
          right in every locale, and in ar/ur an rtl box clipped its start
          (':tps://…') instead of its end (finding responsive-4). On the box so
          the icon and the input's `ps-8` gutter flip together. */}
      <div dir="ltr" className={cn('relative min-w-0 flex-1', fieldClassName)}>
        <LinkIcon
          aria-hidden
          strokeWidth={1.8}
          className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-3"
        />
        <Input
          id={id}
          type="url"
          inputMode="url"
          autoComplete="off"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={placeholder ?? t('addByUrl.placeholder')}
          className="ps-8"
        />
      </div>

      <Button
        type="submit"
        size="sm"
        // Disabled only while there is nothing to work with, and it says so.
        disabled={!url.trim()}
        title={
          !url.trim() ? t('addByUrl.pasteFirst') : connected ? t('addByUrl.modelReads') : undefined
        }
        className="shrink-0"
      >
        <Plus className="size-3.5" strokeWidth={2} aria-hidden />
        {submitLabel ?? t('addByUrl.submit')}
      </Button>
    </form>
  )
}
