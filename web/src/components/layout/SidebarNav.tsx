import { bucketOf } from '@/data/timeline'
import {
  applicationsPath,
  calendarPath,
  dashboardPath,
  scoutPath,
  statisticsPath,
  vaultPath,
} from '@/lib/links'
import { useApplications } from '@jojo/service/react/use-applications'
import { useScout } from '@jojo/service/react/use-scout'
import { useTimeline } from '@jojo/service/react/use-timeline'
import { TODAY } from '@/lib/today'
import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'
import {
  Archive,
  CalendarDays,
  ChartColumn,
  ClipboardList,
  LayoutDashboard,
  Radar,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router'
import { useTranslation } from 'react-i18next'

type Badge = {
  text: string
  /** The number alone — what the pill falls back to when `text` does not fit. */
  count: number
  tone: 'red' | 'amber' | 'accent'
  title: string
}

type NavEntry = {
  to: string
  /** The English name, kept as the guided tour's mark (`nav:Applications`). */
  label: string
  /** What the reader sees, in their language. */
  text: string
  icon: LucideIcon
  badge?: Badge
}

/**
 * What each badge's colour claims.
 *
 * Red is the app's word for past due — the overdue reminders below, and the
 * same red the dashboard paints "8 days overdue" in. Flagged used to borrow it,
 * which put a record the user chose to mark in the same colour as one that had
 * slipped: nothing is late about a flag, and a rail that cries overdue twice
 * teaches people to stop reading the red one that means it. Amber is the tone
 * for attention without lateness, and both its steps are already in the palette
 * (`--warning` is 4.92:1 on the light theme, 10.74:1 on the dark), so the badge
 * carries in both themes without a new token.
 */
const BADGE_TONE: Record<Badge['tone'], string> = {
  red: 'bg-danger-soft text-danger',
  amber: 'bg-warning-soft text-warning',
  accent: 'bg-accent-soft text-accent',
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
  const { t } = useTranslation('layout')

  const flagged = all.filter((a) => a.flagged).length
  const overdue = reminders.filter((r) => !r.completedOn && bucketOf(r, TODAY) === 'overdue').length
  const week = thisWeek.length
  // A match nobody has turned into an application yet — the only ones there is
  // anything left to do about.
  const fresh = matches.filter((m) => !m.applicationId).length

  return [
    { to: dashboardPath(), label: 'Dashboard', text: t('nav.dashboard'), icon: LayoutDashboard },
    {
      to: applicationsPath(),
      label: 'Applications',
      text: t('nav.applications'),
      icon: ClipboardList,
      badge:
        flagged > 0
          ? {
              text: t('nav.flagged', { count: flagged }),
              count: flagged,
              tone: 'amber',
              title: t('nav.flaggedTitle'),
            }
          : undefined,
    },
    {
      to: calendarPath(),
      label: 'Calendar',
      text: t('nav.calendar'),
      icon: CalendarDays,
      badge:
        week > 0
          ? { text: String(week), count: week, tone: 'accent', title: t('nav.weekTitle') }
          : undefined,
    },
    {
      to: vaultPath(),
      label: 'Vault',
      text: t('nav.vault'),
      icon: Archive,
      badge:
        overdue > 0
          ? { text: String(overdue), count: overdue, tone: 'red', title: t('nav.overdueTitle') }
          : undefined,
    },
    {
      to: scoutPath(),
      label: 'Job scout',
      text: t('nav.jobScout'),
      icon: Radar,
      badge:
        fresh > 0
          ? {
              text: t('nav.fresh', { count: fresh }),
              count: fresh,
              tone: 'accent',
              title: t('nav.freshTitle'),
            }
          : undefined,
    },
    { to: statisticsPath(), label: 'Statistics', text: t('nav.statistics'), icon: ChartColumn },
  ]
}

// Profile, Assistant, Settings and How to use moved to the topbar's utility
// row — ten flat peers mixed workflow destinations with account and support
// pages, which every design system treats as a different class.

/**
 * The six workflow destinations, each with its live count.
 *
 * `contents` on the <nav>, so the links are laid out by the sidebar's own
 * column rather than by a box of their own.
 */
export function SidebarNav({ tabIndex }: { tabIndex?: number }) {
  const nav = useNavEntries()

  return (
    <nav className="contents">
      {nav.map(({ to, label, text, icon: Icon, badge }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          data-tour={`nav:${label}`}
          // Not tabbable while the drawer is closed off-screen.
          tabIndex={tabIndex}
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
          <span className="min-w-0 truncate">{text}</span>
          {/* Keyed by the words, so a new count or language measures afresh. */}
          {badge ? <NavBadge key={badge.text} badge={badge} /> : null}
        </NavLink>
      ))}
    </nav>
  )
}

/**
 * A nav item's count, with its state word when the word fits.
 *
 * Inside the link rather than beside it: the destination is the page where the
 * thing it counts is visible, and a second anchor nested in this one would be
 * invalid markup for no new destination. The `title` says what the number is
 * counting, which the number alone never does.
 *
 * One line, never wrapped and never cut. In Tamil '2 குறிக்கப்பட்டவை' is one
 * unbreakable word: the pill ran 21px past the sidebar panel and was cut by
 * its edge, and in German it wrapped to a two-line '2 / markiert' (finding
 * responsive-3). Squeezing it instead cut both the page's name and the pill
 * ('Bewerbung…', '2 mar…'). So the pill keeps its words while the page's name
 * beside it is whole, and drops to the bare number — the Calendar and Vault
 * badges' form — when the name would otherwise be cut. Measured after layout,
 * again whenever the name's box changes size (a drawer opening), and from
 * scratch when a font arrives; the words stay in the title and the sr-only
 * text either way.
 */
function NavBadge({ badge }: { badge: Badge }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [short, setShort] = useState(false)
  useLayoutEffect(() => {
    const name = ref.current?.previousElementSibling
    if (short || !(name instanceof HTMLElement)) return
    const check = () => {
      if (name.scrollWidth > name.clientWidth) setShort(true)
    }
    check()
    const watch = new ResizeObserver(check)
    watch.observe(name)
    return () => watch.disconnect()
  }, [short])
  // A font arriving late changes every width: the name was measured in the
  // fallback face, which can be wider, and the words would have been dropped
  // for good. Try the words again and measure afresh.
  useEffect(() => {
    const fonts = document.fonts
    const retry = () => setShort(false)
    fonts.addEventListener('loadingdone', retry)
    return () => fonts.removeEventListener('loadingdone', retry)
  }, [])
  return (
    <span
      ref={ref}
      title={badge.title}
      className={cn(
        'ms-auto shrink-0 rounded-full px-1.5 py-px text-xs font-semibold whitespace-nowrap',
        BADGE_TONE[badge.tone],
      )}
    >
      {short ? String(badge.count) : badge.text}
      <span className="sr-only"> — {badge.title}</span>
    </span>
  )
}
