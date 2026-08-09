import { useMemo, useState } from 'react'
import { Check, ListFilter, X } from 'lucide-react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { ROLES, type RoleTag } from '@/data/seed'
import { useRoles } from '@/lib/roles-context'
import { useApplications } from '@/lib/store-context'
import { cn } from '@/lib/utils'

/** Chips shown inline before collapsing to "+N". */
const INLINE = 2

/**
 * Faceted role filter.
 *
 * A searchable command list rather than a plain dropdown: it scales past a
 * handful of roles, is keyboard-first (type to narrow, Enter to toggle), and
 * keeps the popover open across multiple selections — picking three roles
 * should be three keystrokes, not three round trips.
 *
 * Selected roles also render as removable chips beside the trigger, so the
 * active filter is legible without opening anything.
 */
export function RoleFilter() {
  const [open, setOpen] = useState(false)
  const { selected, toggle, setAll, clear } = useRoles()
  const { all } = useApplications()

  /**
   * How many applications carry each role — shown so the filter is informative
   * before you apply it, not just after. Counted in render: computed once at
   * module load, the figures froze at whatever the seed held and an application
   * added this session was filterable but uncounted.
   */
  const counts = useMemo(
    () =>
      ROLES.reduce(
        (acc, role) => {
          acc[role] = all.filter((a) => a.roleTag === role).length
          return acc
        },
        {} as Record<RoleTag, number>,
      ),
    [all],
  )

  const chosen = ROLES.filter((r) => selected.has(r))
  const inline = chosen.slice(0, INLINE)
  const overflow = chosen.length - inline.length

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Filter by job role"
            className={cn(
              'flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors',
              selected.size > 0
                ? 'border-info-border bg-info-soft text-info'
                : 'border-hairline bg-well text-text-2 hover:text-text-1',
            )}
          >
            <ListFilter className="size-3.5" strokeWidth={1.8} aria-hidden />
            <span className="hidden sm:inline">
              {selected.size === 0 ? 'All roles' : `${selected.size} selected`}
            </span>
          </button>
        </PopoverTrigger>

        <PopoverContent align="end" className="w-64 p-0">
          <Command>
            <CommandInput placeholder="Find a role…" className="h-9" />
            <CommandList>
              <CommandEmpty>No role matches.</CommandEmpty>
              <CommandGroup>
                {ROLES.map((role) => {
                  const on = selected.has(role)
                  return (
                    <CommandItem
                      key={role}
                      value={role}
                      // Toggling must not close the popover — picking several
                      // roles should be one visit, not one visit each.
                      onSelect={() => toggle(role)}
                      className="gap-2"
                    >
                      <span
                        className={cn(
                          'grid size-4 shrink-0 place-items-center rounded-[4px] border',
                          on
                            ? 'border-info bg-info text-white'
                            : 'border-hairline-strong bg-transparent',
                        )}
                      >
                        {on ? <Check className="size-3" strokeWidth={3} aria-hidden /> : null}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{role}</span>
                      <span className="tabular shrink-0 font-mono text-xs text-text-3">
                        {counts[role]}
                      </span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>

              <Separator />
              <CommandGroup>
                <CommandItem onSelect={() => setAll([...ROLES])} className="justify-center text-xs">
                  Select all
                </CommandItem>
                {selected.size > 0 ? (
                  <CommandItem onSelect={clear} className="justify-center text-xs">
                    Clear filter
                  </CommandItem>
                ) : null}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Active roles as removable chips — the filter state is readable
          without opening the popover, and each is dismissible in one click. */}
      {inline.map((role) => (
        <button
          key={role}
          type="button"
          onClick={() => toggle(role)}
          title={`Remove ${role}`}
          className="hidden h-8 max-w-[9rem] items-center gap-1 rounded-md border border-hairline bg-panel px-2 text-xs text-text-2 transition-colors hover:text-text-1 lg:flex"
        >
          <span className="truncate">{role}</span>
          <X className="size-3 shrink-0" strokeWidth={2} aria-hidden />
        </button>
      ))}
      {overflow > 0 ? (
        <span className="hidden h-8 items-center rounded-md border border-hairline bg-panel px-2 text-xs text-text-3 lg:flex">
          +{overflow}
        </span>
      ) : null}
    </div>
  )
}
