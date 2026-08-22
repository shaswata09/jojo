import { useState } from 'react'
import { ChevronsUpDown, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { displayName } from '@/data/seed'
import { useApplications } from '@jojo/service/react/use-applications'
import { cn } from '@/lib/utils'

/**
 * Files a record under a job, or under nothing.
 *
 * The same combobox the timeline dialog uses, kept separate from it because the
 * two differ in one thing that matters: this one is inline in a list, so its
 * trigger has to survive a narrow column.
 *
 * It sits in `vault/` rather than in `vault/links/` because the files tool needs
 * exactly this control and a second copy of it is how the two rows would drift
 * into disagreeing about what clearing the field means.
 */
export function ApplicationPicker({
  id,
  value,
  onChange,
  /** What the clear button says it is unfiling — 'link', 'file'. */
  what = 'record',
  className,
}: {
  id?: string
  value?: string
  onChange: (id: string | undefined) => void
  what?: string
  className?: string
}) {
  const { all, byId } = useApplications()
  const [open, setOpen] = useState(false)
  const selected = value ? byId.get(value) : undefined

  return (
    <div className={cn('flex min-w-0 items-center gap-1', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            // Named here as well as by the field label around it: in the header
            // form there is no label, and 'No application' on its own says what
            // the value is without saying what it is the value of.
            aria-label="Related application"
            className="h-8 min-w-0 flex-1 justify-between font-normal"
          >
            <span className="truncate">{selected ? displayName(selected) : 'No application'}</span>
            <ChevronsUpDown aria-hidden className="size-3.5 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
          <Command>
            <CommandInput placeholder="Search applications…" />
            <CommandList>
              <CommandEmpty>
                {all.length === 0 ? 'No applications yet.' : 'No application matches that.'}
              </CommandEmpty>
              <CommandGroup>
                {all.map((a) => (
                  <CommandItem
                    key={a.id}
                    // cmdk matches on `value`, so the role and stage are
                    // searchable while the row still reads as one name.
                    value={`${displayName(a)} ${a.roleTag} ${a.stage}`}
                    data-checked={a.id === value}
                    onSelect={() => {
                      onChange(a.id)
                      setOpen(false)
                    }}
                  >
                    <span className="truncate">{displayName(a)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title={`Unfile this ${what}`}
          aria-label={`Unfile this ${what}`}
          onClick={() => onChange(undefined)}
        >
          <X aria-hidden />
        </Button>
      ) : null}
    </div>
  )
}
