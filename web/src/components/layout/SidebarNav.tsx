import { bucketOf } from '@/data/timeline'
import {
  applicationsPath,
  calendarPath,
  dashboardPath,
  scoutPath,
  statisticsPath,
  vaultPath,
} from '@/lib/links'
import { useApplications } from '@/kg/react/use-applications'
import { useScout } from '@/kg/react/use-scout'
import { useTimeline } from '@/kg/react/use-timeline'
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
import { NavLink } from 'react-router'

type Badge = { text: string; tone: 'red' | 'amber' | 'accent'; title: string }

type NavEntry = {
  to: string
  label: string
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
          ? { text: `${flagged} flagged`, tone: 'amber', title: 'Flagged for follow-up' }
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
      {nav.map(({ to, label, icon: Icon, badge }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
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
                BADGE_TONE[badge.tone],
              )}
            >
              {badge.text}
              <span className="sr-only"> — {badge.title}</span>
            </span>
          ) : null}
        </NavLink>
      ))}
    </nav>
  )
}
