import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  Archive,
  BellRing,
  CalendarDays,
  ChartColumn,
  CircleHelp,
  ClipboardList,
  CornerDownLeft,
  FileText,
  LayoutDashboard,
  Radar,
  Settings,
  UserRound,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { RobotIcon } from '@/components/brand/RobotIcon'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { calendarEvents, months } from '@/data/calendar'
import { reminders } from '@/data/reminders'
import { applications } from '@/data/seed'

type Result = {
  id: string
  label: string
  detail?: string
  icon: LucideIcon
  to: string
  /** Extra text matched against but not displayed. */
  keywords?: string
}

const PAGES: Result[] = [
  { id: 'p-dash', label: 'Dashboard', icon: LayoutDashboard, to: '/', keywords: 'home overview' },
  { id: 'p-apps', label: 'Applications', icon: ClipboardList, to: '/applications' },
  { id: 'p-cal', label: 'Calendar', icon: CalendarDays, to: '/calendar' },
  { id: 'p-vault', label: 'Vault', icon: Archive, to: '/vault' },
  { id: 'p-scout', label: 'Job scout', icon: Radar, to: '/scout', keywords: 'pipelines matches' },
  { id: 'p-stats', label: 'Statistics', icon: ChartColumn, to: '/statistics' },
  { id: 'p-profile', label: 'My profile', icon: UserRound, to: '/profile' },
  {
    id: 'p-assist',
    label: 'Assistant',
    icon: RobotIcon as unknown as LucideIcon,
    to: '/assistant',
  },
  { id: 'p-set', label: 'Settings', icon: Settings, to: '/settings' },
  { id: 'p-guide', label: 'How to use', icon: CircleHelp, to: '/guide' },
]

/**
 * Spotlight-style search.
 *
 * Built on CommandDialog, so the overlay, focus trap, Escape handling and
 * arrow-key navigation come from Radix rather than being re-implemented —
 * and cmdk does the filtering, which is what keeps the results list matching
 * on every field rather than just the visible label.
 */
export function SpotlightSearch({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()

  const apps: Result[] = useMemo(
    () =>
      applications.map((a) => ({
        id: `a-${a.id}`,
        label: a.role,
        detail: a.note,
        icon: ClipboardList,
        to: '/applications',
        keywords: `${a.roleTag} ${a.stage} ${a.lastAction}`,
      })),
    [],
  )

  const rems: Result[] = useMemo(
    () =>
      reminders.map((r) => ({
        id: `r-${r.id}`,
        label: r.title,
        detail: r.related,
        icon: BellRing,
        to: '/vault',
        keywords: `${r.kind} ${r.status} ${r.due}`,
      })),
    [],
  )

  const events: Result[] = useMemo(
    () =>
      calendarEvents.map((e) => {
        const m = months.find((mm) => mm.month === e.month)
        return {
          id: `e-${e.id}`,
          label: e.title,
          detail: `${m?.label ?? ''} ${e.day} · ${e.detail}`,
          icon: CalendarDays,
          to: '/calendar',
          keywords: e.kind,
        }
      }),
    [],
  )

  const go = (to: string) => {
    onOpenChange(false)
    navigate(to)
  }

  const Section = ({ heading, items }: { heading: string; items: Result[] }) => (
    <CommandGroup heading={heading}>
      {items.map((r) => (
        <CommandItem
          key={r.id}
          // cmdk matches on `value`, so everything searchable goes in here
          // while the row still renders a clean label.
          value={`${r.label} ${r.detail ?? ''} ${r.keywords ?? ''}`}
          onSelect={() => go(r.to)}
          className="gap-2.5"
        >
          <r.icon className="size-4 shrink-0 text-text-3" strokeWidth={1.7} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{r.label}</span>
            {r.detail ? (
              <span className="block truncate text-xs text-text-3">{r.detail}</span>
            ) : null}
          </span>
        </CommandItem>
      ))}
    </CommandGroup>
  )

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Search applications, reminders, events and pages"
      className="top-[15%] w-[min(92vw,44rem)] max-w-none sm:max-w-none"
    >
      {/* This build's CommandDialog renders Dialog > DialogContent > children
          with no cmdk root, so the Command provider has to be supplied here —
          without it CommandInput has no store and throws on mount. */}
      <Command>
        <CommandInput placeholder="Search applications, reminders, events…" />
        <CommandList className="max-h-[62vh]">
          <CommandEmpty>
            <div className="py-6 text-center">
              <FileText className="mx-auto size-5 text-text-3" strokeWidth={1.6} aria-hidden />
              <p className="mt-2 text-sm text-text-2">Nothing matches that.</p>
              <p className="mt-0.5 text-xs text-text-3">Try a role, an organisation or a stage.</p>
            </div>
          </CommandEmpty>

          <Section heading="Applications" items={apps} />
          <CommandSeparator />
          <Section heading="Reminders" items={rems} />
          <CommandSeparator />
          <Section heading="Calendar" items={events} />
          <CommandSeparator />
          <Section heading="Go to" items={PAGES} />
        </CommandList>

        <div className="flex items-center justify-between border-t border-hairline px-3 py-2 text-xs text-text-3">
          <span className="flex items-center gap-1">
            <CornerDownLeft className="size-3" aria-hidden /> to open
          </span>
          <span>esc to close</span>
        </div>
      </Command>
    </CommandDialog>
  )
}

/** Opens on ⌘K / Ctrl-K, and ignores the shortcut while you are typing. */
export function useSpotlight() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'k' || !(e.metaKey || e.ctrlKey)) return
      e.preventDefault()
      setOpen((prev) => !prev)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return { open, setOpen }
}
