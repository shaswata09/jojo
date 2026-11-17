import { useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  ArrowLeftRight,
  BellRing,
  CalendarDays,
  ChartColumn,
  ChevronsDown,
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
import { hasWords, haystackOf, searchWords } from '@jojo/service/core/word-match'
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
 * arrow-key navigation come from Radix rather than being re-implemented. The
 * FILTERING is ours (`shouldFilter={false}`), and that is the point of the next
 * two notes.
 */

/**
 * Rows a group shows before it offers the rest: with nothing typed, and while
 * typing.
 *
 * Every row is a cmdk item, and cmdk ran its filter over every item on every
 * keystroke and then re-appended each visible one to sort the DOM. With 2,700
 * records the palette mounted 2,373 items, took over half a second to open,
 * and a keystroke cost up to 180 ms — for a list nobody can read past its first
 * screen. The phone caps each group at twenty for the same reason
 * (`GROUP_ROWS` in its SearchScreen); this is the web's twin of that, with a
 * Show all row so nothing is out of reach. With nothing typed, five a group:
 * the empty palette is a menu of where to go, not an index of everything.
 */
const IDLE_ROWS = 5
const GROUP_ROWS = 20

/**
 * The words typed, matched the way the phone matches them — `core/word-match`.
 *
 * Every word must appear somewhere in the row (label, detail and keywords taken
 * together), case and accents aside: "rice stat" finds "Rice — Statistics", and
 * in French "theme" finds "Thème". The palette had its own copy of this rule
 * that did not fold accents, and the phone had one that did but needed the
 * whole query inside one field; both now call the same function.
 *
 * Substring rather than cmdk's fuzzy scorer, which is subsequence-based: it
 * scored "rice" against "Databri(c)ks — ML (e)ngineer", so with twelve
 * applications every query matched all twelve and typing narrowed nothing. A
 * match is yes or no — presentation order (Actions first, then by type) is more
 * use here than a relevance ranking that reshuffles rows as you type.
 */
function useMatches<T>(
  items: readonly T[],
  fields: (item: T) => (string | undefined)[],
  words: readonly string[],
): readonly T[] {
  // Folded once per list, not once per keystroke: only the query is folded
  // as the person types.
  const hays = useMemo(() => items.map((item) => haystackOf(...fields(item))), [items, fields])
  return useMemo(
    () => (words.length === 0 ? items : items.filter((_, i) => hasWords(words, hays[i] ?? ''))),
    [items, hays, words],
  )
}

/** Which groups were opened past their cap, for which query. */
type Opened = { query: string; groups: ReadonlySet<string> }

/**
 * The "Show all" row at the foot of a capped group.
 *
 * An item rather than a button, so it is reached with the arrow keys like
 * everything above it and Enter opens it.
 */
function ShowAll({
  group,
  count,
  onOpen,
}: {
  group: string
  count: number
  onOpen: (group: string) => void
}) {
  const { t } = useTranslation('layout')
  return (
    <CommandItem value={`show-all:${group}`} onSelect={() => onOpen(group)} className="gap-2.5">
      <ChevronsDown className="size-4 shrink-0 text-text-3" strokeWidth={1.7} aria-hidden />
      <span className="text-text-2">{t('spotlight.showAll', { count })}</span>
    </CommandItem>
  )
}

const resultFields = (r: Result) => [r.label, r.detail, r.keywords]
const actionFields = (a: { label: string; hint?: string }) => [a.label, a.hint]
const toolFields = (row: ToolRow) => [row.plan.tool.title, row.plan.tool.summary, row.name]

/**
 * Keeps the input's `aria-activedescendant` on the row Enter will open.
 *
 * cmdk marks the first match `aria-selected` as the person types, but sets
 * `aria-activedescendant` only on its arrow-key path — its first-match
 * selection looks for the selected row before the row has re-rendered as
 * selected, and finds none. So a screen-reader user who typed "stripe" and
 * pressed Enter opened a row that was never announced. This watches the list
 * for the selected row changing and points the input (and the listbox) at it.
 * React leaves the attribute alone between cmdk's own updates, and when cmdk
 * does set it, it sets the same id.
 */
function useActiveDescendant(root: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const element = root.current
    const list = element?.querySelector('[cmdk-list]')
    if (!element || !list) return
    const point = () => {
      const selected = list.querySelector('[cmdk-item][aria-selected="true"]')
      for (const owner of [element.querySelector('[cmdk-input]'), list]) {
        if (!owner) continue
        if (selected?.id) owner.setAttribute('aria-activedescendant', selected.id)
        else owner.removeAttribute('aria-activedescendant')
      }
    }
    point()
    const observer = new MutationObserver(point)
    observer.observe(list, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-selected'],
    })
    return () => observer.disconnect()
  }, [root])
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
  words,
  group,
  opened,
  onOpen,
  capped = true,
}: {
  heading: string
  items: Result[]
  go: (to: string) => void
  /** The query, folded and split (`searchWords`); empty when nothing is typed. */
  words: readonly string[]
  /** This group's name in `opened`. */
  group: string
  opened: boolean
  onOpen: (group: string) => void
  /** False for the short fixed list of pages, which is always shown whole. */
  capped?: boolean
}) {
  const matched = useMatches(items, resultFields, words)
  // A group with nothing to show is not drawn at all — heading included. cmdk
  // used to hide it; with the filtering ours, so is that.
  if (matched.length === 0) return null
  const cap = words.length === 0 ? IDLE_ROWS : GROUP_ROWS
  const shown = !capped || opened ? matched : matched.slice(0, cap)
  return (
    <>
      <CommandGroup heading={heading} data-group={group}>
        {shown.map((r) => (
          <CommandItem
            key={r.id}
            // The row's own id: unique, which a label is not, and what the
            // selection is kept by. The filtering is ours, so cmdk no longer
            // needs every searchable word in here.
            value={r.id}
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
        {shown.length < matched.length ? (
          <ShowAll group={group} count={matched.length} onOpen={onOpen} />
        ) : null}
      </CommandGroup>
      <CommandSeparator />
    </>
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

  const [search, setSearch] = useState('')
  const words = useMemo(() => searchWords(search), [search])
  /** The row Enter opens, by its `value` — held here so Show all can move it. */
  const [selected, setSelected] = useState('')
  const [opened, setOpened] = useState<Opened>({ query: '', groups: new Set() })
  const isOpen = (group: string) => opened.query === search && opened.groups.has(group)
  const root = useRef<HTMLDivElement>(null)
  useActiveDescendant(root)

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

  const actions = useMatches(createActions, actionFields, words)
  const toolRows = useMatches(tools, toolFields, words)
  const toolsShown =
    isOpen('tools') || toolRows.length <= (words.length === 0 ? IDLE_ROWS : GROUP_ROWS)
      ? toolRows
      : toolRows.slice(0, words.length === 0 ? IDLE_ROWS : GROUP_ROWS)

  /*
   * Opens a group past its cap and moves the selection onto the first row it
   * revealed, so a keyboard user who pressed Enter on Show all carries on from
   * where they were rather than being thrown back to the top. A frame later:
   * the Show all row unmounting makes cmdk re-select the first row of the
   * whole list, and this has to land after that.
   */
  const open = (group: string) => {
    setOpened((was) => ({
      query: search,
      groups: new Set([...(was.query === search ? was.groups : []), group]),
    }))
    const shownBefore = words.length === 0 ? IDLE_ROWS : GROUP_ROWS
    requestAnimationFrame(() => {
      const items = root.current?.querySelectorAll<HTMLElement>(
        `[cmdk-group][data-group="${group}"] [cmdk-item]`,
      )
      const next = items?.[shownBefore]
      const value = next?.getAttribute('data-value')
      if (!next || !value) return
      setSelected(value)
      next.scrollIntoView({ block: 'nearest' })
    })
  }

  /** What every record group is handed besides its heading and rows. */
  const section = (group: string) => ({
    go,
    words,
    group,
    opened: isOpen(group),
    onOpen: open,
  })

  // This build's CommandDialog renders Dialog > DialogContent > children with
  // no cmdk root, so the Command provider has to be supplied here — without it
  // CommandInput has no store and throws on mount.
  return (
    <Command
      ref={root}
      label={t('spotlight.label')}
      shouldFilter={false}
      value={selected}
      onValueChange={setSelected}
      data-tour="palette"
    >
      <CommandInput
        placeholder={t('spotlight.placeholder')}
        value={search}
        onValueChange={setSearch}
      />
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
        {actions.length > 0 ? (
          <CommandGroup heading={t('spotlight.actions')}>
            {actions.map((action) => (
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
        ) : null}
        {actions.length > 0 ? <CommandSeparator /> : null}

        <Section heading={t('spotlight.applications')} items={apps} {...section('applications')} />
        <Section heading={t('spotlight.reminders')} items={rems} {...section('reminders')} />
        <Section heading={t('spotlight.calendar')} items={events} {...section('calendar')} />
        <Section heading={t('spotlight.pages.vault')} items={vaultRows} {...section('vault')} />
        <Section heading={t('spotlight.pages.jobScout')} items={scoutRows} {...section('scout')} />

        {/* Below the records, above the pages. A palette is asked for a
          record far more often than for a verb, and the verbs are long
          enough a list to push everything under them off the screen — but
          they are what someone types "delete" or "snooze" hoping to find,
          and typing is what this group is reached by. */}
        {toolRows.length > 0 ? (
          <CommandGroup heading={t('spotlight.tools')} data-group="tools">
            {toolsShown.map((row) => (
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
                  <span className="block truncate text-xs text-text-3">
                    {row.plan.tool.summary}
                  </span>
                </span>
              </CommandItem>
            ))}
            {toolsShown.length < toolRows.length ? (
              <ShowAll group="tools" count={toolRows.length} onOpen={open} />
            ) : null}
          </CommandGroup>
        ) : null}
        {toolRows.length > 0 ? <CommandSeparator /> : null}

        <Section heading={t('spotlight.goTo')} items={pages} {...section('pages')} capped={false} />

        {/* Last, and the longest: every setting, every profile field, and the
          places inside pages. Below the pages so an empty palette still opens
          on the short list of where to go; typing is what reaches these, and
          typing "theme" or "api key" leaves nothing above them. */}
        <Section
          heading={t('spotlight.pages.settings')}
          items={settingRows}
          {...section('settings')}
        />
        <Section
          heading={t('spotlight.pages.profile')}
          items={profileRows}
          {...section('profile')}
        />
        <Section heading={t('spotlight.places')} items={placesRows} {...section('places')} />
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
