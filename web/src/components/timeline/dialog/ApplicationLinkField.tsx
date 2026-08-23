import { useId, useState } from 'react'
import { Check, ChevronsUpDown, X } from 'lucide-react'
import { FormField } from '@/components/common/Field'
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
import type { Application } from '@/data/seed'

/**
 * The applications this record is about, picked from a searchable list.
 *
 * `onToggle` rather than a plain setter: linking an application is the strongest
 * hint the form gets about what kind of record this is, and the caller is the
 * only place that knows whether the user has already chosen a kind themselves.
 *
 * MULTI-SELECT, and the popover stays open while you pick — a reference deadline
 * covers three applications, and a control that closed on the first would teach
 * people it holds one.
 */
export function ApplicationLinkField({
  applications,
  applicationIds,
  selectedApps,
  onToggle,
  onClear,
}: {
  applications: readonly Application[]
  applicationIds: readonly string[]
  selectedApps: readonly Application[]
  onToggle: (id: string) => void
  onClear: () => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const appId = useId()

  return (
    <FormField
      label="Related application"
      htmlFor={appId}
      hint="Links them, so each application lists this and this leads back to any of them."
    >
      <div className="flex items-center gap-1.5">
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              id={appId}
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={pickerOpen}
              className="h-8 min-w-0 flex-1 justify-between font-normal"
            >
              <span className="truncate">
                {selectedApps.length === 0
                  ? 'Not linked'
                  : selectedApps.length === 1 && selectedApps[0]
                    ? displayName(selectedApps[0])
                    : `${String(selectedApps.length)} applications`}
              </span>
              <ChevronsUpDown aria-hidden className="size-3.5 opacity-60" />
            </Button>
          </PopoverTrigger>
          {/* Matched to the trigger so the longest name is readable, and padding
              dropped because Command brings its own. */}
          <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
            <Command>
              <CommandInput placeholder="Search applications…" />
              <CommandList>
                <CommandEmpty>
                  {applications.length === 0
                    ? 'No applications yet.'
                    : 'No application matches that.'}
                </CommandEmpty>
                <CommandGroup>
                  {applications.map((a) => (
                    <CommandItem
                      key={a.id}
                      // cmdk matches on `value`, so the role and stage are
                      // searchable while the row still reads as one name.
                      value={`${displayName(a)} ${a.roleTag} ${a.stage}`}
                      data-checked={applicationIds.includes(a.id)}
                      // Deliberately does NOT close: see the note above.
                      onSelect={() => {
                        onToggle(a.id)
                      }}
                    >
                      <Check
                        aria-hidden
                        className={`size-3.5 shrink-0 ${applicationIds.includes(a.id) ? 'opacity-100' : 'opacity-0'}`}
                      />
                      <span className="truncate">{displayName(a)}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {applicationIds.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="Clear the linked applications"
            aria-label="Clear the linked applications"
            onClick={onClear}
          >
            <X aria-hidden />
          </Button>
        ) : null}
      </div>
    </FormField>
  )
}
