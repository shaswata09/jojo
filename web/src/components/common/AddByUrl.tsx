import { useId } from 'react'
import { Link as LinkIcon, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * Paste a posting URL and start an application from it.
 *
 * Shared by the dashboard's quick-add panel and the Applications page header,
 * so the two cannot drift apart — the placeholder and field width differ, the
 * behaviour and the disabled reason do not.
 *
 * The button is disabled on purpose: nothing can be saved until the local store
 * lands, and an enabled button that quietly discards a URL you just pasted is
 * worse than one that says up front it cannot help yet. The field stays live so
 * the shape of the flow is legible.
 */
export function AddByUrl({
  className,
  fieldClassName,
  placeholder = 'Paste a job posting URL to start from',
}: {
  className?: string
  fieldClassName?: string
  placeholder?: string
}) {
  // Generated, not a literal: both call sites can mount at once and a duplicate
  // id would point every label at the first field.
  const id = useId()

  return (
    <form
      className={cn('flex flex-wrap items-center gap-2', className)}
      // Nothing to submit to yet; prevents a full page reload on Enter.
      onSubmit={(e) => e.preventDefault()}
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
          placeholder={placeholder}
          className="pl-8"
        />
      </div>

      <Button
        type="submit"
        size="sm"
        disabled
        title="Adding needs the local store — it is the next thing being built"
        className="shrink-0"
      >
        <Plus className="size-3.5" strokeWidth={2} aria-hidden />
        Add application
      </Button>
    </form>
  )
}
