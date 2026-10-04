import { useId, useState } from 'react'
import { ArrowUpRight, Check, ChevronsUpDown, X } from 'lucide-react'
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
import { appPath, hrefOutsideRouter, isPlainLeftClick } from '@/lib/links'

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
  filedUnder = [],
  onOpen,
}: {
  applications: readonly Application[]
  applicationIds: readonly string[]
  selectedApps: readonly Application[]
  onToggle: (id: string) => void
  onClear: () => void
  /** The applications the record is saved under — each gets an "Open" link. */
  filedUnder?: readonly Application[]
  /** Closes the dialog and goes to a router path. See `closeAndGo`. */
  onOpen?: (path: string) => void
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

      {/*
       * The way back to the application, which the hint above has always
       * promised ("this leads back to any of them") and nothing delivered.
       *
       * A real anchor with a real href, so a middle or modified click opens the
       * record in a new tab and the address can be copied. A plain click is
       * intercepted and handed to the router instead: following the href would
       * reload the document, and a reload kills any agent run still working.
       * `hrefOutsideRouter` rather than `<Link>` because this renders outside
       * the router, where `<Link>` throws.
       */}
      {onOpen && filedUnder.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {filedUnder.map((app) => {
            const path = appPath(app)
            return (
              <a
                key={app.id}
                href={hrefOutsideRouter(path)}
                onClick={(event) => {
                  if (!isPlainLeftClick(event)) return
                  event.preventDefault()
                  onOpen(path)
                }}
                className="inline-flex max-w-full min-w-0 items-center gap-1 text-text-2 underline underline-offset-2 hover:text-text-1"
              >
                <ArrowUpRight aria-hidden className="size-3.5 shrink-0" />
                <span className="truncate">Open {displayName(app)}</span>
              </a>
            )
          })}
        </div>
      ) : null}
    </FormField>
  )
}
