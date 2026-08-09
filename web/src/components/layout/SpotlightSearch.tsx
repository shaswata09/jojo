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
  Share2,
  UserRound,
  Waypoints,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { RobotIcon } from '@/components/brand/RobotIcon'
import { CREATE_ACTIONS, useRunCreateAction } from '@/components/common/NewMenu'
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
import { displayName } from '@/data/seed'
import { TODAY, bucketOf, partsOf, shortDate } from '@/data/timeline'
import {
  appPath,
  applicationsPath,
  calendarPath,
  dashboardPath,
  graphPath,
  profilePath,
  scoutPath,
  settingsPath,
  statisticsPath,
  transferPath,
  vaultPath,
} from '@/lib/links'
import { useApplications, useTimeline } from '@/lib/store-context'

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
  {
    id: 'p-dash',
    label: 'Dashboard',
    icon: LayoutDashboard,
    to: dashboardPath(),
    keywords: 'home overview',
  },
  { id: 'p-apps', label: 'Applications', icon: ClipboardList, to: applicationsPath() },
  { id: 'p-cal', label: 'Calendar', icon: CalendarDays, to: calendarPath() },
  { id: 'p-vault', label: 'Vault', icon: Archive, to: vaultPath() },
  {
    id: 'p-scout',
    label: 'Job scout',
    icon: Radar,
    to: scoutPath(),
    keywords: 'pipelines matches',
  },
  { id: 'p-stats', label: 'Statistics', icon: ChartColumn, to: statisticsPath() },
  {
    id: 'p-graph',
    label: 'Graph',
    icon: Waypoints,
    to: graphPath(),
    // 'connections' and 'network' are what someone types when they remember
    // the picture rather than the page's name.
    keywords: 'knowledge graph network connections nodes edges query',
  },
  {
    id: 'p-transfer',
    label: 'Transfer',
    detail: 'Move your records to another device',
    icon: Share2,
    to: transferPath(),
    keywords: 'move device pair phone laptop migrate handoff',
  },
  { id: 'p-profile', label: 'My profile', icon: UserRound, to: profilePath() },
  {
    id: 'p-assist',
    label: 'Assistant',
    icon: RobotIcon as unknown as LucideIcon,
    // No builder for these two: they are placeholders rather than destinations
    // the app links to from anywhere else.
    to: '/assistant',
  },
  { id: 'p-set', label: 'Settings', icon: Settings, to: settingsPath() },
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

/**
 * Substring matching, replacing cmdk's default fuzzy scorer.
 *
 * The default is subsequence-based: it scores "rice" against "Databri(c)ks — ML
 * (e)ngineer" because r-i-c-e appear in order somewhere in the string. With
 * twelve applications every query matched all twelve, so typing did not narrow
 * anything — which is worse than a search that finds too little, because the
 * user cannot tell it is working at all.
 *
 * Words are matched independently so "rice stat" still finds "Rice —
 * Statistics", and the score is only ever 1 or 0: this list is short enough
 * that presentation order (Actions first, then by type) is more useful than a
 * relevance ranking that reshuffles rows as you type.
 */
function matchesQuery(value: string, search: string, keywords?: string[]) {
  if (!search.trim()) return 1
  const haystack = `${value} ${keywords?.join(' ') ?? ''}`.toLowerCase()
  return search
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word))
    ? 1
    : 0
}
export function SpotlightSearch({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const { all: applications, byId } = useApplications()
  const { all: dated, reminders } = useTimeline()
  const runCreate = useRunCreateAction()

  // Every result goes to the record itself, not to the page it lives on.
  // Landing on the board with no idea which of forty rows you picked is the
  // same as not having searched at all.
  const apps: Result[] = useMemo(
    () =>
      applications.map((a) => ({
        id: `a-${a.id}`,
        label: displayName(a),
        detail: a.note,
        icon: ClipboardList,
        to: appPath(a.id),
        keywords: `${a.roleTag} ${a.stage} ${a.lastAction}`,
      })),
    [applications],
  )

  const rems: Result[] = useMemo(
    () =>
      reminders.map((r) => {
        const app = r.applicationId ? byId.get(r.applicationId) : undefined
        return {
          id: `r-${r.id}`,
          label: r.title,
          detail: app ? displayName(app) : r.detail,
          icon: BellRing,
          to: vaultPath({ tool: 'reminders', focus: r.id }),
          keywords: `${r.kind} ${bucketOf(r, TODAY)} ${shortDate(r.date)}`,
        }
      }),
    [reminders, byId],
  )

  // Everything dated that is not already listed above as a reminder — the two
  // sections read from one timeline now, so without the split the same row
  // would appear twice under two headings.
  const events: Result[] = useMemo(
    () =>
      dated
        .filter((i) => !i.remind)
        .map((e) => ({
          id: `e-${e.id}`,
          label: e.title,
          detail: `${shortDate(e.date)} · ${e.detail ?? ''}`,
          icon: CalendarDays,
          // The month AND the day, so the calendar opens with the item's own
          // date selected rather than on whatever month it happens to show.
          to: calendarPath({ ...partsOf(e.date), focus: e.id }),
          keywords: e.kind,
        })),
    [dated],
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
      <Command filter={matchesQuery}>
        <CommandInput placeholder="Search applications, reminders, events…" />
        <CommandList className="max-h-[62vh]">
          <CommandEmpty>
            <div className="py-6 text-center">
              <FileText className="mx-auto size-5 text-text-3" strokeWidth={1.6} aria-hidden />
              <p className="mt-2 text-sm text-text-2">Nothing matches that.</p>
              <p className="mt-0.5 text-xs text-text-3">Try a role, an organisation or a stage.</p>
            </div>
          </CommandEmpty>

          {/* First, and before anything typed narrows the list: the palette is
              the fastest route to "add a thing" from any page, and a create
              action buried under forty applications is not a route at all. The
              same array the topbar's menu renders, run through the same hook —
              so a row that became a link cannot still be fired as a dialog
              here. */}
          <CommandGroup heading="Actions">
            {CREATE_ACTIONS.map((action) => (
              <CommandItem
                key={action.id}
                value={`${action.label} ${action.hint ?? ''}`}
                onSelect={() => {
                  onOpenChange(false)
                  // Deferred a frame: this dialog returns focus to its trigger
                  // as it unmounts, and a dialog mounted in the same commit
                  // would have that focus pulled straight back out of it.
                  requestAnimationFrame(() => runCreate(action))
                }}
                className="gap-2.5"
              >
                <action.icon
                  className="size-4 shrink-0 text-text-3"
                  strokeWidth={1.7}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{action.label}</span>
                  {action.hint ? (
                    <span className="block truncate text-xs text-text-3">{action.hint}</span>
                  ) : null}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />

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

/** Fields that own the keystroke, because the keystroke is text you meant to type. */
function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  // Inherited, so a caret anywhere inside a rich-text region counts too.
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** Opens on ⌘K / Ctrl-K, and ignores the shortcut while you are typing. */
export function useSpotlight() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'k' || !(e.metaKey || e.ctrlKey)) return
      // The docstring above has always claimed this guard and the check was
      // never written, so ⌘K fired over the applications search box and over
      // the note editor, where it is the browser's or the field's to handle.
      // The trade is that the palette no longer toggles shut from inside its
      // own input — Escape is what closes it.
      if (isTypingTarget(e.target)) return
      if (e.isComposing || e.defaultPrevented) return
      e.preventDefault()
      setOpen((prev) => !prev)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return { open, setOpen }
}
