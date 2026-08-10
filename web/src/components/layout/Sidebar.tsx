import { BrandCard } from '@/components/brand/BrandCard'
import { bucketOf } from '@/data/timeline'
import type { DotStatus } from '@/components/common/StatusDot'
import {
  applicationsPath,
  calendarPath,
  dashboardPath,
  graphPath,
  scoutPath,
  settingsPath,
  statisticsPath,
  transferPath,
  vaultPath,
} from '@/lib/links'
import { useStoreStatus } from '@/kg/react/status-context'
import type { StoreStatus } from '@/kg/react/status-context'
import { useBoot } from '@/lib/boot-context'
import { useApplications } from '@/kg/react/use-applications'
import { useScout } from '@/kg/react/use-scout'
import { useTimeline } from '@/kg/react/use-timeline'
import { TODAY } from '@/lib/today'
import { useFocusTrap } from '@/lib/use-focus-trap'
import { DESKTOP_QUERY, useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'
import {
  Archive,
  Cable,
  CalendarDays,
  ChartColumn,
  Cpu,
  Database,
  ClipboardList,
  LayoutDashboard,
  Radar,
  Share2,
  X,
} from 'lucide-react'
import { useEffect, useRef } from 'react'
import { NavLink, useNavigate } from 'react-router'

type Badge = { text: string; tone: 'red' | 'accent'; title: string }

type NavEntry = {
  to: string
  label: string
  icon: LucideIcon
  badge?: Badge
}

/**
 * Live counts for the nav.
 *
 * Every one of these was a frozen string — '3 due' stayed at three however many
 * you cleared, which teaches people to stop believing the number. Each counts
 * something visible on the page it sits beside, so following the link answers
 * the question the badge raises rather than opening a page where the count is
 * nowhere to be seen.
 */
function useNavEntries(): NavEntry[] {
  const { all } = useApplications()
  const { reminders, thisWeek } = useTimeline()
  const { matches } = useScout()

  const flagged = all.filter((a) => a.flagged).length
  const overdue = reminders.filter((r) => !r.completedOn && bucketOf(r, TODAY) === 'overdue').length
  const week = thisWeek.length
  // A match nobody has turned into an application yet — the only ones there is
  // anything left to do about.
  const fresh = matches.filter((m) => !m.applicationId).length

  return [
    { to: dashboardPath(), label: 'Dashboard', icon: LayoutDashboard },
    {
      to: applicationsPath(),
      label: 'Applications',
      icon: ClipboardList,
      badge:
        flagged > 0
          ? { text: `${flagged} flagged`, tone: 'red', title: 'Flagged for follow-up' }
          : undefined,
    },
    {
      to: calendarPath(),
      label: 'Calendar',
      icon: CalendarDays,
      badge:
        week > 0
          ? { text: String(week), tone: 'accent', title: 'Scheduled in the next seven days' }
          : undefined,
    },
    {
      to: vaultPath(),
      label: 'Vault',
      icon: Archive,
      badge:
        overdue > 0
          ? { text: String(overdue), tone: 'red', title: 'Reminders past their date' }
          : undefined,
    },
    {
      to: scoutPath(),
      label: 'Job scout',
      icon: Radar,
      badge:
        fresh > 0
          ? { text: `${fresh} new`, tone: 'accent', title: 'Matches not yet added to applications' }
          : undefined,
    },
    { to: statisticsPath(), label: 'Statistics', icon: ChartColumn },
  ]
}

// Profile, Assistant, Settings and How to use moved to the topbar's utility
// row — ten flat peers mixed workflow destinations with account and support
// pages, which every design system treats as a different class.

type RuntimeTile = {
  label: string
  meta: string
  status: DotStatus
  icon: LucideIcon
  to: string
  /** The tooltip's version, where there is room for the whole sentence. */
  detail?: string
}

/**
 * The storage tile, read off the live store rather than written down.
 *
 * It used to be the constant `{ meta: 'in memory', status: 'warn' }` — true
 * while the store was compiled into memory on every load, and flatly false from
 * the moment it went to IndexedDB. It rendered on every page in every state,
 * including a perfectly healthy durable one, and this is the first place a
 * person looks to find out whether their work is safe: a permanent amber dot
 * saying "in memory" tells them it is not, and they would have been right to
 * believe it.
 *
 * The three not-saving cases collapse into one reading on purpose. Which of
 * them it is — another tab holding the database, no room left, a browser that
 * refuses storage — is `StorageBanner`'s job, and it is already on screen above
 * the route with the sentence and the fix in it. A 50px tile repeating a
 * distinction it has no room to explain would only compete with that.
 */
function storageTile(status: StoreStatus, interrupted: boolean): RuntimeTile {
  // Storage opens the Graph rather than Settings. The tile says where your
  // records are being held, and the graph is the honest answer to that — the
  // records themselves, drawn. Settings only has a notice about the same thing.
  const tile = { label: 'Browser storage', icon: Database, to: graphPath() }

  if (interrupted || status.boot.phase === 'unavailable' || status.health.state === 'off') {
    return {
      ...tile,
      meta: 'not saving',
      status: 'warn',
      detail: 'your records are not being saved — the banner above the page says why',
    }
  }

  if (status.health.state === 'degraded') {
    return {
      ...tile,
      meta: 'retrying',
      status: 'warn',
      detail: `${status.health.pending} change${status.health.pending === 1 ? '' : 's'} could not be saved yet, and jojo is still retrying`,
    }
  }

  // 'saved here', not 'saving' or a byte count. The tense is the point: what a
  // person wants from this tile is whether their work is already safe, and a
  // present participle answers a different question. It is also honest while
  // the queue is draining — `writing` means one batch is in flight behind a
  // commit that has already landed in memory, which is a millisecond, not a
  // state worth flickering the sidebar for.
  return {
    ...tile,
    meta: 'saved here',
    status: 'on',
    detail: "your records are written to this browser's database as you work",
  }
}

/**
 * What the four runtime pieces are actually doing.
 *
 * These read '14.2 MB', '2m ago' and a green dot on the bridge — numbers for a
 * sync that has never run and a store that is not on disk. A status strip whose
 * figures are invented is worse than none: it is the one place a reader looks
 * to find out whether their data is safe. Each now states the real state, and
 * the tile still opens Settings, where each is configured.
 */
function runtimeTiles(status: StoreStatus, interrupted: boolean): RuntimeTile[] {
  return [
    storageTile(status, interrupted),
    // 'no bridge', not 'not connected': at four across a tile is ~50px, and
    // 'connected' neither fits on one line nor breaks anywhere useful, so it
    // ran straight through the tile's borders on both sides. Every meta on this
    // row is now two short words at most, and the full state is in the tooltip
    // and the accessible name.
    {
      label: 'Localhost bridge',
      meta: 'no bridge',
      status: 'off',
      icon: Cable,
      to: settingsPath(),
    },
    { label: 'Local model', meta: 'offline', status: 'off', icon: Cpu, to: settingsPath() },
    // Fourth on the row because it belongs to the same subject: where the records
    // live, and how they get to another device. 'no device' rather than a
    // readiness word — nothing is paired, and a tile that read 'ready' would be
    // claiming a connection this build never opens.
    { label: 'Transfer', meta: 'no device', status: 'off', icon: Share2, to: transferPath() },
  ]
}

/** Named in each tile's tooltip, so a click never lands somewhere unannounced. */
const RUNTIME_DEST: Record<string, string> = {
  [graphPath()]: 'the graph',
  [transferPath()]: 'Transfer',
  [settingsPath()]: 'Settings',
}

/** Status carried by the icon's colour once the dot and the label are gone. */
const RUNTIME_TONE: Record<DotStatus, string> = {
  on: 'text-success',
  warn: 'text-warning',
  off: 'text-text-3',
}

/**
 * Permanent column at `lg` and above; an off-canvas drawer below it.
 *
 * The drawer is a real modal dialog on small screens — focus moves into it on
 * open and the page behind is inert — but must NOT claim those semantics on
 * desktop, where it is just a navigation landmark. Hence the media query.
 */
export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY)
  const nav = useNavEntries()
  const status = useStoreStatus()
  const { interrupted } = useBoot()
  const runtime = runtimeTiles(status, interrupted)
  const navigate = useNavigate()
  const closeRef = useRef<HTMLButtonElement>(null)
  const asideRef = useRef<HTMLElement>(null)

  // aria-modal was a promise the drawer couldn't keep: Tab walked focus behind
  // the opaque backdrop, where nothing focused was visible.
  useFocusTrap(asideRef, open && !isDesktop)

  useEffect(() => {
    if (open && !isDesktop) closeRef.current?.focus()
  }, [open, isDesktop])

  return (
    <aside
      ref={asideRef}
      // Hidden from assistive tech when closed on mobile, so its links are not
      // reachable by screen reader or Tab while off-screen.
      aria-hidden={!isDesktop && !open}
      {...(!isDesktop ? { role: 'dialog', 'aria-modal': open, 'aria-label': 'Navigation' } : {})}
      className={cn(
        'surface z-50 flex w-[min(17rem,85vw)] flex-col gap-1.5 rounded-lg px-3.5 py-5',
        // Mobile: floating off-canvas drawer. Longhand insets rather than
        // `inset-y-*`, so the lg: overrides below don't depend on Tailwind's
        // shorthand-vs-longhand ordering.
        'fixed top-3 bottom-3 left-3 overflow-y-auto transition-transform duration-200 ease-out',
        open ? 'translate-x-0' : '-translate-x-[calc(100%+1rem)]',
        // Desktop: permanent sticky column.
        'lg:sticky lg:top-5 lg:bottom-auto lg:left-auto lg:h-[calc(100dvh-2.5rem)] lg:w-[232px]',
        'lg:shrink-0 lg:translate-x-0 lg:transition-none',
        'motion-reduce:transition-none',
      )}
    >
      <BrandCard
        className="mb-2 shrink-0"
        action={
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="grid size-8 place-items-center rounded-full border border-white/20 bg-black/25 text-white/80 backdrop-blur-sm hover:text-white lg:hidden"
          >
            <X className="size-4" strokeWidth={1.7} />
          </button>
        }
      />

      <nav className="contents">
        {nav.map(({ to, label, icon: Icon, badge }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            // Not tabbable while the drawer is closed off-screen.
            tabIndex={!isDesktop && !open ? -1 : undefined}
            className={({ isActive }) =>
              cn(
                'pressable flex items-center gap-2.5 rounded-md border border-transparent px-3 py-2.5 text-sm transition-colors duration-150 select-none',
                isActive
                  ? 'border-hairline bg-well text-text-1'
                  : 'text-text-2 hover:bg-well hover:text-text-1',
              )
            }
          >
            <Icon className="size-4 shrink-0" strokeWidth={1.7} />
            {label}
            {badge ? (
              // Inside the link rather than beside it: the destination is the
              // page where the thing it counts is visible, and a second anchor
              // nested in this one would be invalid markup for no new
              // destination. The `title` says what the number is counting,
              // which the number alone never does.
              <span
                title={badge.title}
                className={cn(
                  'ml-auto rounded-full px-1.5 py-px text-xs font-semibold',
                  badge.tone === 'red'
                    ? 'bg-danger-soft text-danger'
                    : 'bg-accent-soft text-accent',
                )}
              >
                {badge.text}
                <span className="sr-only"> — {badge.title}</span>
              </span>
            ) : null}
          </NavLink>
        ))}
      </nav>

      {/* The gesture bench that used to sit here — a <select> labelled "temp" in
          red — is gone. It was a tuning tool, and the same list is reachable for
          real in Settings → Appearance, beside the mascot it drives. `mt-auto`
          moved onto the runtime block, which is what should be pinned to the
          foot of the column. */}
      <div className="mt-auto flex flex-col gap-[7px] pt-4">
        <div className="px-2.5 pb-0.5 text-xs tracking-wide text-text-3 uppercase">Runtime</div>
        {/* Icon over value, four up. Colour carries health, the icon carries
            what it is, the text carries the value. The label survives as the
            tooltip and as the accessible name — an icon above "saved here" says
            nothing on its own, and colour alone would be the only signal of
            trouble.

            Each tile now names its own destination rather than all four going
            to Settings: storage opens the Graph (the records it is talking
            about, drawn), Transfer opens the handoff, and the bridge and the
            model still open Settings, where they are configured. The `title`
            says which, so no tile takes a click somewhere unannounced. */}
        {/* Two by two rather than four across. A quarter of a 232px rail is
            ~50px, which is narrower than the words it has to hold — half is
            ~110px, so every value fits on one line and the icons stop being
            the only thing readable at a glance. */}
        <div className="grid grid-cols-2 gap-1.5">
          {runtime.map((r) => (
            <button
              key={r.label}
              type="button"
              onClick={() => navigate(r.to)}
              title={`${r.label} — ${r.detail ?? r.meta}. Opens ${RUNTIME_DEST[r.to] ?? 'Settings'}`}
              // Not tabbable while the drawer is closed off-screen, matching
              // the nav links above.
              tabIndex={!isDesktop && !open ? -1 : undefined}
              className="pressable flex cursor-pointer flex-col items-center gap-1 rounded-md border border-hairline bg-well px-1 py-2 transition-colors hover:border-hairline-strong hover:bg-row-hover active:bg-well"
            >
              <r.icon
                aria-hidden
                strokeWidth={1.8}
                className={cn('size-4 shrink-0', RUNTIME_TONE[r.status])}
              />
              <span className="sr-only">{r.label}: </span>
              {/* Wraps rather than `whitespace-nowrap`: a quarter of a 240px
                  rail is ~50px and "not connected" is wider than that, so
                  nowrap spilled the words straight through the tile's border.
                  The grid stretches all four, so two lines here still line up. */}
              <span className="text-center text-xs leading-tight text-balance text-text-2">
                {r.meta}
              </span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  )
}
