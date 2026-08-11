import { useId, useState } from 'react'
import { ChevronsUpDown, X } from 'lucide-react'
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
 * The application this record is about, picked from a searchable list.
 *
 * `onSelect` rather than a plain setter: linking an application is the strongest
 * hint the form gets about what kind of record this is, and the caller is the
 * only place that knows whether the user has already chosen a kind themselves.
 */
export function ApplicationLinkField({
  applications,
  applicationId,
  selectedApp,
  onSelect,
  onClear,
}: {
  applications: readonly Application[]
  applicationId: string | undefined
  selectedApp: Application | undefined
  onSelect: (id: string) => void
  onClear: () => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const appId = useId()

  return (
    <FormField
      label="Related application"
      htmlFor={appId}
      hint="Links the two, so the application can list this and this can lead back to it."
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
                {selectedApp ? displayName(selectedApp) : 'Not linked'}
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
                      data-checked={a.id === applicationId}
                      onSelect={() => {
                        onSelect(a.id)
                        setPickerOpen(false)
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

        {applicationId ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="Clear the linked application"
            aria-label="Clear the linked application"
            onClick={onClear}
          >
            <X aria-hidden />
          </Button>
        ) : null}
      </div>
    </FormField>
  )
}
