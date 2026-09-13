import { useEffect } from 'react'
import { buildMonth } from '@/data/calendar'
import { type Stage } from '@/data/seed'
import { addressOf } from '@jojo/service/core/address'
import type { Addressable } from '@jojo/service/core/address'
import { TODAY_PARTS } from '@/lib/today'

/**
 * Every route the app links to, and every param those routes read.
 *
 * Eight surfaces point at the same three destinations — the dashboard, the
 * board, the vault tools, the scout, the calendar's day list — and a route
 * composed by hand at each of them is eight chances to write '?view=kanban'
 * against a page that only understands 'board'. The builders live here and
 * their readers in `link-params.ts`, which imports the same defaults and codec
 * from this file — so a param still cannot be written in a shape nothing reads.
 * The readers moved out on 2026-09-11 because they need the router and the
 * builders must not: a dialog imports a path from here, and a dialog is drawn
 * outside the router (see `lib/dialogs.tsx`).
 *
 * Params matching the default are left out of the URL: the page renders the
 * same either way, and '/applications' is a nicer thing to land on and to share
 * than '/applications?view=board&stage=all&q=&sort=daysAgo'. The readers supply
 * those defaults, so the two halves have to agree on them — hence the
 * `*_DEFAULTS` below, lifted from what the routes hardcode today.
 */

export type ApplicationsView = 'board' | 'table'
export type ApplicationsSortKey = 'role' | 'stage' | 'daysAgo'
export type SortDir = 'asc' | 'desc'

/**
 * The tools the Vault can open, named here rather than in the route so this
 * file does not reach into a route module for a type. Vault.tsx keeps the tab
 * labels and checks its list against this one with `satisfies`, so a tab no
 * builder here understands fails to compile rather than producing a link that
 * silently lands on the default tool.
 */
export const VAULT_TOOLS = ['reminders', 'links', 'files', 'snippets', 'people', 'tools'] as const
export type VaultTool = (typeof VAULT_TOOLS)[number]

const SORT_KEYS: readonly ApplicationsSortKey[] = ['role', 'stage', 'daysAgo']

export const APPLICATIONS_DEFAULTS = {
  view: 'board',
  stage: 'all',
  q: '',
  sort: 'daysAgo',
} as const

export const VAULT_DEFAULTS = { tool: 'reminders' } as const

/**
 * The calendar opens on today rather than on a literal date. It used to open on
 * the fixtures' pinned October, which was a month in the past for anyone who
 * loaded the app after it — and because a param equal to the default is omitted
 * from the URL, "go to this month" produced a link that landed on that October
 * for the next reader.
 *
 * A FUNCTION, not a `const` object, and that is the whole point of it. It was a
 * const, sampled once when this module was first imported, and `TODAY_PARTS`
 * has moved with the local midnight since the pin became live. Measured on a
 * session opened at 23:50 on 12 Oct and read at 00:10 (fake timers, 20 minutes
 * advanced): the pin said the 13th, this object still said the 12th, and both
 * halves of the calendar's URL contract were then wrong in opposite directions
 * — `calendarPath({d: 13})` kept `?d=13` in the URL because 13 was no longer
 * "the default", while a bare `/calendar` fell back to `d: 12` and opened the
 * day panel on YESTERDAY. Adding an event from that panel stamps the 12th.
 *
 * `calendarPath` and `calendarDate` below call it, and so does
 * `useCalendarParams` in `link-params.ts`, so each samples the pin at the moment
 * it builds or parses a URL rather than at import.
 */
export const calendarDefaults = () =>
  ({ y: TODAY_PARTS.year, m: TODAY_PARTS.month, d: TODAY_PARTS.day }) as const

/*
 * `DEFAULTS` is gone, and what it claimed about itself is why.
 *
 * It aggregated the three constants above and its comment said "Read by the
 * param hooks below, which is the whole of its live use". Neither half held:
 * nothing outside this file imported it, and the hooks — then in this file,
 * now in `link-params.ts` — read
 * `APPLICATIONS_DEFAULTS`, `VAULT_DEFAULTS` and `calendarDefaults()` DIRECTLY —
 * never through the wrapper. So it was an export with no consumers describing a
 * use it did not have.
 *
 * The three it wrapped are all still here and all still read; only the empty
 * shell went. The paragraph it carried about `clearFilters` is worth keeping,
 * because it is about the constants and not about the wrapper: `clearFilters`
 * in `routes/Applications.tsx` spells `{ q: '', stage: 'all' }` by hand rather
 * than reading `APPLICATIONS_DEFAULTS`, so the two agree by coincidence and
 * changing a default here would leave Clear filters restoring the old one.
 */

/* ------------------------------- builders -------------------------------- */

export type ParamValue = string | number | undefined

function withQuery(path: string, params: Record<string, ParamValue>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    // An empty string in a URL carries no more information than the absent key.
    if (value === undefined || value === '') continue
    search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `${path}?${query}` : path
}

/** Drops anything the page would have shown anyway. */
function omitDefault<T>(value: T | undefined, fallback: T) {
  return value === undefined || value === fallback ? undefined : value
}

export function dashboardPath() {
  return '/'
}

export function statisticsPath() {
  return '/statistics'
}

export function profilePath() {
  return '/profile'
}

/**
 * Settings, optionally pointing at one row.
 *
 * `focus` exists for the same reason the Vault's does: a banner that says "go
 * and look in Settings" is asking the reader to find one line on a page three
 * and a half screens tall, and the unreadable-records row sits in the seventh
 * of nine panels styled exactly like the fifteen telemetry lines around it. A
 * link that lands on the row and lights it is the difference between a promise
 * kept and a promise made.
 */
export function settingsPath(p?: { focus?: string }) {
  const focus = p?.focus
  return focus ? `/settings?focus=${encodeURIComponent(focus)}` : '/settings'
}

/**
 * The assistant. The last route still linked to by a literal — the guide points
 * at it from two pages now, and one of them is the page whose whole job is
 * being accurate about where things are.
 */
export function assistantPath() {
  return '/assistant'
}

/**
 * The documentation section: five pages under one path.
 *
 * The order is part of the contract rather than a detail of whichever component
 * draws the list — the rail numbers these, the pager walks them, and a "next"
 * link that disagreed with the numbering would be a page out of sequence in two
 * places at once. Trust, then competence, then understanding, then provenance.
 *
 * The landing page is the bare '/guide', not '/guide/overview'. It is what the
 * topbar's help icon and the palette have pointed at since before there was
 * anything to split, and those links — and any bookmark on them — have to keep
 * landing somewhere real. Same rule as everywhere else in this file: the
 * default is omitted from the URL.
 */
export const GUIDE_PAGES = [
  'overview',
  'screens',
  'graph',
  'tools',
  'built-with',
  'licence',
] as const
export type GuidePage = (typeof GUIDE_PAGES)[number]

export const GUIDE_DEFAULTS = { page: 'overview' } as const

export function guidePath(page: GuidePage = GUIDE_DEFAULTS.page) {
  return page === GUIDE_DEFAULTS.page ? '/guide' : `/guide/${page}`
}

/** The knowledge-graph preview. No params — it reads the whole store. */
export function graphPath() {
  return '/graph'
}

/**
 * Moving your records to another device.
 *
 * Linked from the sidebar, the palette and Settings → Your data, which is why it
 * gets a builder rather than a literal at three call sites.
 */
export function transferPath() {
  return '/transfer'
}

/**
 * A single application.
 *
 * Takes the RECORD, not an id. It used to take a string, every one of its
 * eighteen call sites passed `a.id`, and ids are minted per session — so the URL
 * in the address bar was dead the moment the tab reloaded and the detail route
 * answered a live record with "This application no longer exists". A slug is
 * what survives a reload, a transfer to another device, and an Electron
 * `open-url` that arrives before the graph is built; `addressOf` is the only
 * thing allowed to decide which string that is.
 *
 * Still encoded, for the reason it always was: a slug is minted from a typed-in
 * employer name and `slugify` only trims, lowercases and collapses whitespace,
 * so an employer called 'A/B' yields 'a/b' and would otherwise invent a route
 * segment. React Router decodes the parameter again, so `bySlug` sees the slug
 * that was stored.
 */
export function appPath(a: Addressable) {
  return `/applications/${encodeURIComponent(addressOf(a))}`
}

/**
 * One employer's page.
 *
 * Takes the SLUG rather than the name, for the reason `appPath` does: the name
 * can be edited on the application that first supplied it, and a link built out
 * of a name breaks the day somebody fixes a typo in it.
 */
/**
 * A path as a real href, for the handful of components that live OUTSIDE the
 * router and therefore cannot use `<Link>`.
 *
 * `DialogHost` and `ApprovalHost` are mounted beside `<App />` in `main.tsx`
 * rather than inside it, because a dialog and an agent's approval both have to
 * outlive the page that raised them. The cost is that neither has router
 * context: a `<Link>` in one throws "Cannot destructure property 'basename'"
 * and takes the whole app down with it, which is not a subtle failure but is a
 * surprising one to meet in a dialog.
 *
 * The basename has to be applied by hand for the same reason — `<Link>` is what
 * usually adds it, and on GitHub Pages every path here is served under `/jojo/`.
 */
export function hrefOutsideRouter(path: string) {
  return `${import.meta.env.BASE_URL.replace(/\/$/, '')}${path}`
}

export function orgPath(slug: string) {
  return `/employers/${encodeURIComponent(slug)}`
}

/**
 * The board, with whatever the toolbar is filtering by.
 *
 * There was a fifth parameter here: `new`, composed as '?new=1' and documented
 * as "opens the page with the new-application dialog already up". Nothing ever
 * read it. `useApplicationsParams` handed back an `isNew` flag, no route
 * consumed it, and none of the twenty-odd call sites passed it — so a link
 * carrying '?new=1' landed on an ordinary board and silently did nothing, which
 * is the worst thing a URL parameter can do to the next person who links to it.
 * Removed rather than wired up: `n` and the New menu already open the dialog
 * from anywhere, so there was no behaviour missing, only a promise nothing kept.
 */
export function applicationsPath(
  p: {
    view?: ApplicationsView
    stage?: Stage | 'all'
    q?: string
    /** Wire form, from `formatSort` — 'daysAgo' or '-daysAgo'. */
    sort?: string
  } = {},
) {
  return withQuery('/applications', {
    view: omitDefault(p.view, APPLICATIONS_DEFAULTS.view),
    stage: omitDefault(p.stage, APPLICATIONS_DEFAULTS.stage),
    q: omitDefault(p.q, APPLICATIONS_DEFAULTS.q),
    sort: omitDefault(p.sort, APPLICATIONS_DEFAULTS.sort),
  })
}

export function vaultPath(p: { tool?: VaultTool; focus?: string } = {}) {
  return withQuery('/vault', {
    tool: omitDefault(p.tool, VAULT_DEFAULTS.tool),
    focus: p.focus,
  })
}

export function calendarPath(p: { y?: number; m?: number; d?: number; focus?: string } = {}) {
  const today = calendarDefaults()
  return withQuery('/calendar', {
    y: omitDefault(p.y, today.y),
    m: omitDefault(p.m, today.m),
    d: omitDefault(p.d, today.d),
    focus: p.focus,
  })
}

/**
 * Job scout holds two lists whose record ids can collide — a saved posting and
 * a match are minted from different collections, and 'stripe' is already the id
 * of six seeded records — so the focus parameter names the list as well as the
 * record: '/scout?focus=match:unt'. `useScoutParams` is the only reader.
 */
export type ScoutFocus = { kind: 'match' | 'posting'; id: string }

export function scoutPath(p: { focus?: ScoutFocus } = {}) {
  return withQuery('/scout', {
    focus: p.focus ? `${p.focus.kind}:${p.focus.id}` : undefined,
  })
}

/* --------------------------------- sort ---------------------------------- */

/**
 * Sort travels as one token so it costs one param rather than two that can
 * disagree — a '-' prefix means descending, matching the convention most APIs
 * already use.
 */
export function formatSort(key: ApplicationsSortKey, dir: SortDir) {
  return dir === 'desc' ? `-${key}` : key
}

/** Anything unrecognised falls back whole: '-nonsense' is not "descending by nothing". */
export function parseSort(token: string): { key: ApplicationsSortKey; dir: SortDir } {
  const desc = token.startsWith('-')
  const key = desc ? token.slice(1) : token
  if (!SORT_KEYS.includes(key as ApplicationsSortKey)) {
    return { key: APPLICATIONS_DEFAULTS.sort, dir: 'asc' }
  }
  return { key: key as ApplicationsSortKey, dir: desc ? 'desc' : 'asc' }
}

/* -------------------------------- readers -------------------------------- */

/**
 * Applies a patch to the current query string.
 *
 * A key absent from the patch is left alone; a key present but undefined, empty
 * or equal to the page default is removed. That last rule is what keeps the URL
 * back at a clean '/applications' when you clear a filter, rather than
 * accumulating the fossil of every control you have touched.
 */
export function patched(
  prev: URLSearchParams,
  patch: Record<string, ParamValue>,
  defaults: Readonly<Record<string, string | number>>,
) {
  const next = new URLSearchParams(prev)
  for (const key of Object.keys(patch)) {
    const value = patch[key]
    if (value === undefined || value === '' || value === defaults[key]) next.delete(key)
    else next.set(key, String(value))
  }
  return next
}

/**
 * Filter, view and sort changes replace the history entry instead of pushing
 * one. Back should step between pages, not unwind eight keystrokes of a search
 * box one character at a time. Anything that opens a record can pass
 * `{ replace: false }` so Back closes it again.
 */
export type SetOptions = { replace?: boolean }

/** No defaults of its own: `focus` is the only param the scout reads. */
export const SCOUT_DEFAULTS: Readonly<Record<string, string | number>> = {}

/**
 * Reads a whole number, falling back when it is missing or not one, and
 * clamping when it is out of range — '?m=99' should land on December rather
 * than render a month with no days in it.
 *
 * THE FALLBACK IS CLAMPED TOO, and that is not tidiness. It used to return
 * early — `if (raw === null) return fallback` — and the day's fallback is
 * today's date, which is a number between 1 and 31 chosen by the wall clock and
 * not by the month on screen. So '/calendar?y=2026&m=2' opened on the 31st gave
 * the Calendar d=31 in a February with 28 days: no cell in the grid is lit,
 * because none of them is the 31st, and the day panel beside it builds its date
 * through `isoOf`, which normalises 2026-02-31 to 2026-03-03. Adding an event
 * from a page headed February stamped it in March.
 *
 * Measured by `calendarDate` in links.test.ts, which pins a fallback of 31
 * against February rather than waiting for the month to come round again.
 */
function readInt(raw: string | null, fallback: number, min: number, max: number) {
  const parsed = raw === null || raw.trim() === '' ? Number.NaN : Number(raw)
  const value = Number.isInteger(parsed) ? parsed : fallback
  return Math.min(Math.max(value, min), max)
}

/**
 * The three numbers the calendar pages by, read out of a query string.
 *
 * A plain function here rather than inside `useCalendarParams` (now in
 * `link-params.ts`), because the clamping
 * is the part that can be wrong and D20 leaves no way to mount the hook and
 * look: the day is clamped against a month length that depends on the OTHER two
 * params, so the interesting cases are combinations, not values.
 *
 * `defaults` is a parameter so a test can pin them. The live ones come from the
 * wall clock (`TODAY_PARTS`), so a test that used them would assert something
 * different on the 31st than on the 1st — and the bug this signature exists to
 * pin was exactly a fallback of 31 landing in February.
 */
export function calendarDate(
  params: URLSearchParams,
  defaults: { y: number; m: number; d: number } = calendarDefaults(),
) {
  const y = readInt(params.get('y'), defaults.y, 1, 9999)
  const m = readInt(params.get('m'), defaults.m, 1, 12)
  // Clamped against the month actually on screen, the same way Calendar clamps
  // the selected day when you page between months — '?m=2&d=31' is a URL a
  // person can type, and February has to answer it with something real.
  const d = readInt(params.get('d'), defaults.d, 1, buildMonth(y, m).days)
  return { y, m, d }
}

/**
 * Names the browser tab after what is on screen.
 *
 * Every route shared one title, so a person with jojo open in three tabs — the
 * board, a record they are mid-edit, next month's calendar — saw three
 * identical strips and had to click each one to find out which was which. The
 * document title is the only label a background tab gets.
 *
 * Restores the previous title on unmount so a route that unmounts without a
 * successor (a dialog route, a redirect) cannot leave its name behind.
 *
 * `null` means "not mine to name". A parent that renders a child route INSIDE
 * itself cannot simply pass a different string: effects run child-first, so the
 * parent's would land last and overwrite the record's name with the list's on
 * every cold load. Standing down is the only way to let the child win.
 */
export function useTitle(title: string | null) {
  useEffect(() => {
    if (title === null) return
    const previous = document.title
    document.title = title ? `${title} · jojo` : BASE_TITLE
    return () => {
      document.title = previous
    }
  }, [title])
}

/**
 * The document title with no route-specific one set. Matches `index.html`.
 *
 * "So the two cannot drift" is what this used to claim, and nothing made it so —
 * it is a string literal copied into a file no test read. `links.test.ts` now
 * reads `index.html` and asserts they are equal, which is what that sentence
 * was promising.
 */
export const BASE_TITLE = 'jojo — agentic job-search assistant'

/* -------------------------------------------------------------------------- */

/**
 * The PAGE a path belongs to — the identity that survives opening a record.
 *
 * `AppShell` asks this twice, and both answers were wrong when the pathname
 * stood in for them:
 *
 *   - It is the key on the route's ErrorBoundary. A key change makes React
 *     discard the subtree and build a new one, which is what made the recovery
 *     real — and it also meant that opening an application from the board threw
 *     the board away and rebuilt it. Measured: tag the six column scrollers,
 *     click a card, and every tag is gone, with the new columns at scrollTop 0
 *     and identical heights. That is the bug somebody reported as "the board
 *     goes back to the top when I close a record" — it went back on OPEN, and
 *     the sheet covered the evidence until they closed it.
 *   - It decides whether to scroll the new page to the top.
 *
 * `/applications/:key` is therefore the same page as `/applications`: the route
 * table already says so — the detail is a child "so the board or table stays
 * mounted beside it" — and this is what makes that true rather than intended.
 *
 * The guide is the counter-example and stays whole. `/guide/licence` and
 * `/guide/tools` are genuinely different pages reached from a pager, nothing is
 * meant to stay mounted between them, and arriving at one halfway down is the
 * thing the scroll reset exists to prevent. So is `/employers/:key`, a sibling
 * route rather than a child.
 *
 * ## What keying by page costs
 *
 * A throw inside an open record no longer clears itself when the record closes.
 * `RouteFailure` never offered that: it says "going somewhere else and coming
 * back will reload it" and links to the dashboard, and going somewhere else is
 * exactly a page change. The sidebar is up the whole time, because this
 * boundary is inside the shell.
 */
export function pageKey(pathname: string): string {
  const clean = pathname.replace(/\/+$/, '') || '/'
  return /^\/applications(\/.+)?$/.test(clean) ? '/applications' : clean
}

/**
 * Whether moving between these two paths stays on the same page.
 *
 * A pure function so it can be tested, because `AppShell` cannot be (D20).
 */
export const isSamePage = (from: string, to: string): boolean => pageKey(from) === pageKey(to)
