import { useState } from 'react'
import { Check, ChevronsUpDown, X } from 'lucide-react'
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
import { applicationsLabel, displayName } from '@/data/seed'
import { useApplications } from '@jojo/service/react/use-applications'
import { cn } from '@/lib/utils'

/**
 * Files a record under any number of jobs.
 *
 * The same combobox the timeline dialog uses, kept separate from it because the
 * two differ in one thing that matters: this one is inline in a list, so its
 * trigger has to survive a narrow column.
 *
 * MULTI-SELECT, and the popover stays open while you pick. One CV goes to every
 * job you send it to, so choosing the second should not mean reopening the
 * control — and a picker that closes on the first choice teaches people it holds
 * one. Closing is the Done button and clicking away.
 *
 * The trigger says the count rather than listing names past one: three
 * `displayName`s do not fit a column narrow enough for the Vault's rows, and a
 * truncated list of three is less use than the number.
 */
export function ApplicationPicker({
  id,
  values,
  onChange,
  /** What the clear button says it is unfiling — 'link', 'file'. */
  what = 'record',
  className,
}: {
  id?: string
  values: readonly string[]
  onChange: (ids: string[]) => void
  what?: string
  className?: string
}) {
  const { all, byId } = useApplications()
  const [open, setOpen] = useState(false)

  const chosen = values.map((v) => byId.get(v)).filter((a) => a !== undefined)
  // `applicationsLabel` is the shared rule for how many names fit before a
  // count reads better — the same one the phone's picker and every filing
  // toast use, so the three cannot disagree about where two becomes 'three
  // applications'.
  const label = chosen.length === 0 ? 'No application' : applicationsLabel(chosen)

  const toggle = (appId: string) => {
    onChange(
      values.includes(appId) ? values.filter((v) => v !== appId) : [...values, appId],
    )
  }

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
            aria-label="Related applications"
            className="h-8 min-w-0 flex-1 justify-between font-normal"
          >
            <span className="truncate">{label}</span>
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
                {all.map((a) => {
                  const on = values.includes(a.id)
                  return (
                    <CommandItem
                      key={a.id}
                      // cmdk matches on `value`, so the role and stage are
                      // searchable while the row still reads as one name.
                      value={`${displayName(a)} ${a.roleTag} ${a.stage}`}
                      data-checked={on}
                      // Deliberately does NOT close: see the note above.
                      onSelect={() => {
                        toggle(a.id)
                      }}
                    >
                      {/* A tick rather than a checkbox: cmdk rows are already
                          one click-target, and a second one inside it is two
                          things to hit for one decision. */}
                      <Check
                        aria-hidden
                        className={cn('size-3.5 shrink-0', on ? 'opacity-100' : 'opacity-0')}
                      />
                      <span className="truncate">{displayName(a)}</span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {values.length > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title={`Unfile this ${what}`}
          aria-label={`Unfile this ${what}`}
          onClick={() => onChange([])}
        >
          <X aria-hidden />
        </Button>
      ) : null}
    </div>
  )
}
