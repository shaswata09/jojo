import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  ArrowLeftRight,
  BellRing,
  CalendarDays,
  ChartColumn,
  CircleHelp,
  ClipboardList,
  CornerDownLeft,
  ExternalLink,
  FileText,
  LayoutDashboard,
  Link2,
  Pencil,
  Plus,
  Radar,
  Radio,
  Settings,
  Share2,
  SlidersHorizontal,
  Tag,
  TextQuote,
  Trash2,
  UserRound,
  Users,
  Waypoints,
  Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { RobotIcon } from '@/components/brand/RobotIcon'
import { DIALOG_TOOLS, useCreateActions, useRunCreateAction } from '@/lib/create-actions'
import { ToolRunDialog } from '@/components/common/ToolRunDialog'
import { planToolForm, recordCountOf } from '@/components/common/tool-form'
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
import { bucketOf, partsOf } from '@/data/timeline'
import { useGraph } from '@jojo/service/react/kg-context'
import { useApplications } from '@jojo/service/react/use-applications'
import { useScout } from '@jojo/service/react/use-scout'
import { useTimeline } from '@jojo/service/react/use-timeline'
import { useVault } from '@jojo/service/react/use-vault'
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
import { useLabels } from '@/lib/labels-context'
import { PROFILE_PLACES, SEARCH_PLACES, SETTINGS_PLACES, placeById } from '@/lib/search-places'
import type { Place, PlaceGroup } from '@/lib/search-places'
import { useDomain } from '@/i18n/domain'

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
  tools:
    'assistant agent tools permissions safety what can it do api key claude openai ollama model provider',
  'built-with': 'credits acknowledgements dependencies versions attribution',
  'control-flow':
    'control flow graph code flow graph dependency imports modules architecture layers mvc where does it go structure developer contributing faq',
  licence:
    'licence license mit free open source copyright terms disclaimer warranty nvidia microsoft markitdown legal cost commercial',
}

/**
 * The pages, named in the reader's language. A function of `t` rather than a
 * module constant, so the names follow a language change. The keywords stay
 * English: they are extra search terms, and the translated label is searched
 * as well.
 */
const pagesFor = (t: (key: string) => string): Result[] => [
  {
    id: 'p-dash',
    label: t('spotlight.pages.dashboard'),
    icon: LayoutDashboard,
    to: dashboardPath(),
    keywords: 'home overview',
  },
  {
    id: 'p-apps',
    label: t('spotlight.pages.applications'),
    icon: ClipboardList,
    to: applicationsPath(),
  },
  { id: 'p-cal', label: t('spotlight.pages.calendar'), icon: CalendarDays, to: calendarPath() },
  { id: 'p-vault', label: t('spotlight.pages.vault'), icon: Archive, to: vaultPath() },
  {
    id: 'p-scout',
    label: t('spotlight.pages.jobScout'),
    icon: Radar,
    to: scoutPath(),
    keywords: 'pipelines matches',
  },
  {
    id: 'p-stats',
    label: t('spotlight.pages.statistics'),
    icon: ChartColumn,
    to: statisticsPath(),
  },
  {
    id: 'p-graph',
    label: t('spotlight.pages.graph'),
    icon: Waypoints,
    to: graphPath(),
    // 'connections' and 'network' are what someone types when they remember
    // the picture rather than the page's name.
    keywords: 'knowledge graph network connections nodes edges query',
  },
  {
    id: 'p-transfer',
    label: t('spotlight.pages.transfer'),
    detail: t('spotlight.pages.transferDetail'),
    icon: Share2,
    to: transferPath(),
    keywords: 'move device pair phone laptop migrate handoff',
  },
  { id: 'p-profile', label: t('spotlight.pages.profile'), icon: UserRound, to: profilePath() },
  {
    id: 'p-assist',
    label: t('spotlight.pages.assistant'),
    icon: RobotIcon as unknown as LucideIcon,
    to: assistantPath(),
  },
  { id: 'p-set', label: t('spotlight.pages.settings'), icon: Settings, to: settingsPath() },
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

/** The icon a place is drawn with, by where it lives. */
const PLACE_ICON: Record<PlaceGroup, LucideIcon> = {
  settings: SlidersHorizontal,
  profile: UserRound,
  vault: Archive,
  scout: Radar,
  statistics: ChartColumn,
  guide: CircleHelp,
}

/**
 * The registry's places as palette rows, in the reader's language.
 *
 * Resolved here, at render, from catalog keys — the registry holds keys, not
 * words, so a language switch renames every row. The row's panel and its own
 * description are shown under it ("Model · The base URL, ending in /v1.") and
 * matched against, so "Test connection" says which of the two it is and a word
 * from the description finds the row.
 */
function placeRows(places: readonly Place[], t: (key: string) => string): Result[] {
  return places.map((place) => {
    const label = place.label ? t(place.label) : (place.text ?? place.id)
    const panel = place.panel ? placeById(place.panel) : undefined
    const where = panel?.label ? t(panel.label) : undefined
    const detail = place.detail ? t(place.detail) : undefined
    return {
      id: `s-${place.id}`,
      label,
      detail: [where, detail].filter(Boolean).join(' · ') || undefined,
      icon: PLACE_ICON[place.group],
      to: place.to,
      ...(place.keywords ? { keywords: place.keywords } : {}),
    }
  })
}

const OTHER_PLACES = SEARCH_PLACES.filter(
  (place) => place.group !== 'settings' && place.group !== 'profile',
)

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
/**
 * One group of palette rows.
 *
 * At MODULE scope, and that is the point rather than tidiness: declared inside
 * the palette it was a new function — a new element TYPE — on every render, so
 * React unmounted and remounted every group and every row beneath it. The
 * palette's body (`PaletteBody`) subscribes to the store, so any write anywhere
 * in the app re-rendered it and threw the palette's rows away mid-search.
 *
 * `go` arrives as a prop because a component cannot close over the hook state
 * of a component it no longer lives inside.
 */
function Section({
  heading,
  items,
  go,
}: {
  heading: string
  items: Result[]
  go: (to: string) => void
}) {
  return (
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
}

/**
 * Everything the open palette lists, and every subscription that feeds it.
 *
 * A component of its own so that it exists only while the palette is open —
 * `CommandDialog` renders nothing when closed. The topbar mounts the palette on
 * every page, and while these hooks lived on `SpotlightSearch` a closed palette
 * still subscribed to the graph and, on every commit, re-ran `available()` and
 * `planToolForm` for every tool and rebuilt the application, reminder and event
 * rows: about 9 ms a commit in development, the most expensive component on the
 * dashboard, for a list nobody was looking at.
 */
function PaletteBody({
  onOpenChange,
  onPickTool,
}: {
  onOpenChange: (open: boolean) => void
  /** A tool row was chosen: its form opens once the palette has closed. */
  onPickTool: (row: ToolRow) => void
}) {
  const { t, i18n } = useTranslation('layout')
  const language = i18n.language
  const domain = useDomain()
  const navigate = useNavigate()
  const { all: applications, byId } = useApplications()
  const { all: dated, reminders } = useTimeline()
  const runCreate = useRunCreateAction()
  const createActions = useCreateActions()
  const memory = useGraph()
  const vault = useVault()
  const scout = useScout()
  const { labels } = useLabels()
  // Any namespace: the registry's keys carry their own ('settings:…').
  const { t: tAny } = useTranslation()

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
    const countOf = recordCountOf(memory)
    const rows: ToolRow[] = []
    for (const name of Object.keys(TOOLS) as ToolName[]) {
      if (DIALOG_TOOLS.has(name)) continue
      const tool: AnyTool = TOOLS[name]
      /*
       * Asked the same question `/graph` asks (`GraphDetail`), which this
       * surface was not asking at all: a tool that would refuse the moment it
       * ran is not a row. With no input to hand the answer is about the store —
       * "there are no suggestions waiting for an answer" — which is precisely
       * the state the palette used to paper over.
       */
      if (!(tool.available?.(memory, undefined) ?? { ok: true }).ok) continue
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

  // Both lists word a date, so both are rebuilt when the language changes.
  const rems: Result[] = useMemo(() => {
    void language
    return reminders.map((r) => {
      const app = r.applicationIds[0] ? byId.get(r.applicationIds[0]) : undefined
      return {
        id: `r-${r.id}`,
        label: r.title,
        detail: app ? displayName(app) : r.detail,
        icon: BellRing,
        to: vaultPath({ tool: 'reminders', focus: r.id }),
        keywords: `${r.kind} ${bucketOf(r, TODAY)} ${domain.shortDate(r.date)}`,
      }
    })
  }, [reminders, byId, domain, language])

  // Everything dated that is not already listed above as a reminder — the two
  // sections read from one timeline now, so without the split the same row
  // would appear twice under two headings.
  const events: Result[] = useMemo(() => {
    void language
    return dated
      .filter((i) => !i.remind)
      .map((e) => ({
        id: `e-${e.id}`,
        label: e.title,
        detail: `${domain.shortDate(e.date)} · ${e.detail ?? ''}`,
        icon: CalendarDays,
        // The month AND the day, so the calendar opens with the item's own
        // date selected rather than on whatever month it happens to show.
        to: calendarPath({ ...partsOf(e.date), focus: e.id }),
        keywords: e.kind,
      }))
  }, [dated, domain, language])

  const pages = useMemo(() => pagesFor(t), [t])

  /*
   * The Vault's records, each to its own row — the same `focus` the graph and
   * the reminders badge link with, which every one of these tabs scrolls to and
   * lights. Matched on what the phone's search matches them on (a link's URL,
   * a file's bucket, a snippet's body), so the two find the same things.
   */
  const { links, files, snippets, people } = vault
  const vaultRows: Result[] = useMemo(() => {
    void language
    const tab = (tool: string) => tAny(`pages:vault.tools.${tool}`)
    return [
      ...links.map((l) => ({
        id: `vl-${l.id}`,
        label: l.title,
        detail: `${tab('links')} · ${l.url}`,
        icon: Link2,
        to: vaultPath({ tool: 'links', focus: l.id }),
        keywords: `${l.category} ${l.note ?? ''}`,
      })),
      ...files.map((f) => ({
        id: `vf-${f.id}`,
        label: f.name,
        detail: `${tab('files')} · ${f.bucket} · ${f.size}`,
        icon: FileText,
        to: vaultPath({ tool: 'files', focus: f.id }),
        keywords: `${f.kind} ${f.note ?? ''}`,
      })),
      ...snippets.map((s) => ({
        id: `vs-${s.id}`,
        label: s.title,
        detail: `${tab('snippets')} · ${s.tag}`,
        icon: TextQuote,
        to: vaultPath({ tool: 'snippets', focus: s.id }),
        // The body, capped: a snippet is found by a phrase in it, and a
        // ten-paragraph statement is not worth matching every keystroke against.
        keywords: s.body.slice(0, 400),
      })),
      ...people.map((p) => ({
        id: `vp-${p.id}`,
        label: p.name,
        detail: [tab('people'), p.role, p.affiliation].filter(Boolean).join(' · '),
        icon: Users,
        to: vaultPath({ tool: 'people', focus: p.id }),
        keywords: `${p.email ?? ''} ${p.note ?? ''}`,
      })),
    ]
  }, [links, files, snippets, people, tAny, language])

  /*
   * The scout's records. Matches and saved postings were already linkable
   * (`ScoutFocus`); a pipeline is now too, by its row's `data-focus-id`.
   */
  const { pipelines, matches, postings } = scout
  const scoutRows: Result[] = useMemo(() => {
    void language
    return [
      ...pipelines.map((p) => ({
        id: `sp-${p.id}`,
        label: p.name,
        detail: `${tAny('scout:pipelines.title')} · ${p.source}`,
        icon: Radio,
        to: scoutPath({ focus: { kind: 'pipeline', id: p.id } }),
        keywords: `${p.filter} ${p.schedule}`,
      })),
      ...matches.map((m) => ({
        id: `sm-${m.id}`,
        label: m.role,
        detail: `${tAny('scout:matches.title')} · ${m.detail}`,
        icon: Radar,
        to: scoutPath({ focus: { kind: 'match', id: m.id } }),
      })),
      ...postings.map((p) => ({
        id: `sv-${p.id}`,
        label: p.title,
        detail: [p.org, p.location, p.url].filter(Boolean).join(' · '),
        icon: ExternalLink,
        to: scoutPath({ focus: { kind: 'posting', id: p.id } }),
        keywords: p.summary?.slice(0, 400) ?? '',
      })),
    ]
  }, [pipelines, matches, postings, tAny, language])

  /*
   * Every setting, then every keyword — a keyword is a row in Settings with its
   * own rename, colour and delete, so "research" finds the place to manage it.
   */
  const settingRows: Result[] = useMemo(() => {
    void language
    const keywordPanel = tAny('settings:keywords.title')
    return [
      ...placeRows(SETTINGS_PLACES, tAny),
      ...labels.map((l) => ({
        id: `k-${l.id}`,
        label: l.name,
        detail: keywordPanel,
        icon: Tag,
        to: settingsPath({ focus: `keyword:${l.id}` }),
        keywords: 'keyword label tag',
      })),
    ]
  }, [labels, tAny, language])
  const profileRows = useMemo(() => {
    void language
    return placeRows(PROFILE_PLACES, tAny)
  }, [tAny, language])
  const placesRows = useMemo(() => {
    void language
    return placeRows(OTHER_PLACES, tAny)
  }, [tAny, language])

  const go = (to: string) => {
    onOpenChange(false)
    navigate(to)
  }

  // This build's CommandDialog renders Dialog > DialogContent > children with
  // no cmdk root, so the Command provider has to be supplied here — without it
  // CommandInput has no store and throws on mount.
  return (
    <Command label={t('spotlight.label')} filter={matchesQuery} data-tour="palette">
      <CommandInput placeholder={t('spotlight.placeholder')} />
      <CommandList className="max-h-[62vh]">
        <CommandEmpty>
          <div className="py-6 text-center">
            <FileText className="mx-auto size-5 text-text-3" strokeWidth={1.6} aria-hidden />
            <p className="mt-2 text-sm text-text-2">{t('spotlight.emptyTitle')}</p>
            <p className="mt-0.5 text-xs text-text-3">{t('spotlight.emptyHint')}</p>
          </div>
        </CommandEmpty>

        {/* First, and before anything typed narrows the list: the palette is
          the fastest route to "add a thing" from any page, and a create
          action buried under forty applications is not a route at all. The
          same array the topbar's menu renders, run through the same hook —
          so a row that became a link cannot still be fired as a dialog
          here. */}
        <CommandGroup heading={t('spotlight.actions')}>
          {createActions.map((action) => (
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
              <action.icon className="size-4 shrink-0 text-text-3" strokeWidth={1.7} aria-hidden />
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

        <Section heading={t('spotlight.applications')} items={apps} go={go} />
        <CommandSeparator />
        <Section heading={t('spotlight.reminders')} items={rems} go={go} />
        <CommandSeparator />
        <Section heading={t('spotlight.calendar')} items={events} go={go} />
        <CommandSeparator />
        <Section heading={t('spotlight.pages.vault')} items={vaultRows} go={go} />
        <CommandSeparator />
        <Section heading={t('spotlight.pages.jobScout')} items={scoutRows} go={go} />
        <CommandSeparator />

        {/* Below the records, above the pages. A palette is asked for a
          record far more often than for a verb, and the verbs are long
          enough a list to push everything under them off the screen — but
          they are what someone types "delete" or "snooze" hoping to find,
          and typing is what this group is reached by. */}
        <CommandGroup heading={t('spotlight.tools')}>
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
                requestAnimationFrame(() => onPickTool(row))
              }}
              className="gap-2.5"
            >
              <row.icon className="size-4 shrink-0 text-text-3" strokeWidth={1.7} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{row.plan.tool.title}</span>
                <span className="block truncate text-xs text-text-3">{row.plan.tool.summary}</span>
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />

        <Section heading={t('spotlight.goTo')} items={pages} go={go} />
        <CommandSeparator />

        {/* Last, and the longest: every setting, every profile field, and the
          places inside pages. Below the pages so an empty palette still opens
          on the short list of where to go; typing is what reaches these, and
          typing "theme" or "api key" leaves nothing above them. */}
        <Section heading={t('spotlight.pages.settings')} items={settingRows} go={go} />
        <CommandSeparator />
        <Section heading={t('spotlight.pages.profile')} items={profileRows} go={go} />
        <CommandSeparator />
        <Section heading={t('spotlight.places')} items={placesRows} go={go} />
      </CommandList>

      <div className="flex items-center justify-between border-t border-hairline px-3 py-2 text-xs text-text-3">
        <span className="flex items-center gap-1">
          <CornerDownLeft className="size-3" aria-hidden /> {t('spotlight.toOpen')}
        </span>
        <span>{t('spotlight.toClose')}</span>
      </div>
    </Command>
  )
}

export function SpotlightSearch({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  /** The tool whose generated form is open, with the plan the row was offered on. */
  const { t } = useTranslation('layout')
  const [pending, setPending] = useState<ToolRow | null>(null)

  return (
    <>
      <CommandDialog
        open={open}
        onOpenChange={onOpenChange}
        title={t('spotlight.title')}
        description={t('spotlight.label')}
        className="top-[15%] w-[min(92vw,44rem)] max-w-none sm:max-w-none"
      >
        <PaletteBody onOpenChange={onOpenChange} onPickTool={setPending} />
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
