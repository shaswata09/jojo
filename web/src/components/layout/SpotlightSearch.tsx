import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  Archive,
  ArrowLeftRight,
  BellRing,
  CalendarDays,
  ChartColumn,
  CircleHelp,
  ClipboardList,
  CornerDownLeft,
  FileText,
  LayoutDashboard,
  Pencil,
  Plus,
  Radar,
  Settings,
  Share2,
  Trash2,
  UserRound,
  Waypoints,
  Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { RobotIcon } from '@/components/brand/RobotIcon'
import { isTypingTarget } from '@/components/common/typing-target'
import { CREATE_ACTIONS, DIALOG_TOOLS, useRunCreateAction } from '@/components/layout/NewMenu'
import { ToolRunDialog } from '@/components/common/ToolRunDialog'
import { planToolForm } from '@/components/common/tool-form'
import { GUIDE_PAGE_META } from '@/components/guide/pages'
import type { FormPlan } from '@/components/common/tool-form'
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
import { bucketOf, partsOf, shortDate } from '@/data/timeline'
import type { NodeType } from '@jojo/service/core/model'
import { useGraph } from '@jojo/service/react/kg-context'
import { useApplications } from '@jojo/service/react/use-applications'
import { useTimeline } from '@jojo/service/react/use-timeline'
import { TOOLS } from '@jojo/service/tools/index'
import type { ToolName } from '@jojo/service/tools/index'
import type { AnyTool } from '@jojo/service/tools/tool'
import { TODAY } from '@/lib/today'
import {
  appPath,
  applicationsPath,
  assistantPath,
  calendarPath,
  dashboardPath,
  graphPath,
  guidePath,
  profilePath,
  scoutPath,
  settingsPath,
  statisticsPath,
  transferPath,
  vaultPath,
} from '@/lib/links'
import type { GuidePage } from '@/lib/links'

type Result = {
  id: string
  label: string
  detail?: string
  icon: LucideIcon
  to: string
  /** Extra text matched against but not displayed. */
  keywords?: string
}

/** What someone types when they want a guide page but do not know its name. */
const GUIDE_KEYWORDS: Record<GuidePage, string> = {
  overview: 'getting started first steps checklist onboarding storage backup shortcuts undo',
  screens: 'reference pages screens routes what does this do not connected disabled',
  graph: 'nodes edges query records model relationships architecture',
  'built-with': 'licence license credits acknowledgements open source dependencies versions',
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
    to: assistantPath(),
  },
  { id: 'p-set', label: 'Settings', icon: Settings, to: settingsPath() },
  // The guide's four pages, each its own row rather than one row for the
  // section. Outside the palette it is reachable from a single unlabelled
  // question mark in the topbar, so this is where someone who has never found
  // it will find it — and they will be typing what they want to know
  // ('licence', 'shortcut', 'backup'), not the name of a page they have never
  // seen. The keywords are what those questions look like.
  ...GUIDE_PAGE_META.map((page) => ({
    id: `p-guide-${page.id}`,
    label: page.label,
    detail: page.blurb,
    icon: CircleHelp,
    to: guidePath(page.id),
    keywords: `guide help documentation how to use manual ${GUIDE_KEYWORDS[page.id]}`,
  })),
]

/** What the verb does to your records, at a glance, before you read the row. */
const EFFECT_ICON: Record<string, LucideIcon> = {
  create: Plus,
  update: Pencil,
  delete: Trash2,
  move: ArrowLeftRight,
  admin: Wrench,
}

type ToolRow = { name: ToolName; plan: FormPlan; icon: LucideIcon }

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
  const memory = useGraph()
  /** The tool whose generated form is open, with the plan the row was offered on. */
  const [pending, setPending] = useState<ToolRow | null>(null)

  /**
   * Every registered tool that can be given an honest form, in registry order.
   *
   * Registry order is domain order — applications, then the timeline, then the
   * vault — which reads as a menu; alphabetical by title would interleave five
   * unrelated things under 'D'. The list is recomputed against the snapshot
   * because a tool whose only picker would be empty is not offered: "Delete
   * link" with no links to delete is a row that can only disappoint.
   */
  const tools: ToolRow[] = useMemo(() => {
    const countOf = (type: NodeType) => memory.ofType(type).length
    const rows: ToolRow[] = []
    for (const name of Object.keys(TOOLS) as ToolName[]) {
      if (DIALOG_TOOLS.has(name)) continue
      const tool: AnyTool = TOOLS[name]
      const plan = planToolForm(tool, { countOf })
      if (!plan) continue
      rows.push({ name, plan, icon: EFFECT_ICON[tool.effect] ?? Wrench })
    }
    return rows
  }, [memory])

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
        to: appPath(a),
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
    <>
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
                <p className="mt-0.5 text-xs text-text-3">
                  Try a role, an organisation or a stage.
                </p>
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

            {/* Below the records, above the pages. A palette is asked for a
              record far more often than for a verb, and the verbs are long
              enough a list to push everything under them off the screen — but
              they are what someone types "delete" or "snooze" hoping to find,
              and typing is what this group is reached by. */}
            <CommandGroup heading="Tools">
              {tools.map((row) => (
                <CommandItem
                  key={row.name}
                  // The tool's own name is in here as well: it is what the
                  // architecture document and the audit log call it, and someone
                  // who has read either should be able to type it.
                  value={`${row.plan.tool.title} ${row.plan.tool.summary} ${row.name}`}
                  onSelect={() => {
                    onOpenChange(false)
                    // A frame later, for the same reason the create rows defer:
                    // this dialog hands focus back to its trigger as it unmounts,
                    // and a dialog mounted in the same commit loses it again.
                    requestAnimationFrame(() => setPending(row))
                  }}
                  className="gap-2.5"
                >
                  <row.icon className="size-4 shrink-0 text-text-3" strokeWidth={1.7} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{row.plan.tool.title}</span>
                    <span className="block truncate text-xs text-text-3">
                      {row.plan.tool.summary}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
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

      {/* Outside the palette, and only while a tool is pending: the palette is
          already closed by the time this mounts, and a form nested inside a
          dialog that is unmounting would go with it. */}
      {pending ? (
        <ToolRunDialog
          key={pending.name}
          name={pending.name}
          plan={pending.plan}
          onOpenChange={(next) => {
            if (!next) setPending(null)
          }}
        />
      ) : null}
    </>
  )
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
