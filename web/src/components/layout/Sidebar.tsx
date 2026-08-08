import { BrandCard } from '@/components/brand/BrandCard'
import { GESTURES, useMascot, type MascotPose } from '@/lib/mascot-context'
import type { DotStatus } from '@/components/common/StatusDot'
import { useFocusTrap } from '@/lib/use-focus-trap'
import { DESKTOP_QUERY, useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'
import {
  Archive,
  Cable,
  CalendarDays,
  ChartColumn,
  ChevronDown,
  Cpu,
  Database,
  ClipboardList,
  LayoutDashboard,
  Radar,
  X,
} from 'lucide-react'
import { useEffect, useRef } from 'react'
import { NavLink } from 'react-router'

type NavEntry = {
  to: string
  label: string
  icon: LucideIcon
  badge?: { text: string; tone: 'red' | 'accent' }
}

const NAV: NavEntry[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  {
    to: '/applications',
    label: 'Applications',
    icon: ClipboardList,
    badge: { text: '3 due', tone: 'red' },
  },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/vault', label: 'Vault', icon: Archive, badge: { text: '3', tone: 'red' } },
  { to: '/scout', label: 'Job scout', icon: Radar, badge: { text: '5 new', tone: 'accent' } },
  { to: '/statistics', label: 'Statistics', icon: ChartColumn },
]
// Profile, Assistant, Settings and How to use moved to the topbar's utility
// row — ten flat peers mixed workflow destinations with account and support
// pages, which every design system treats as a different class.

// TODO: replace with live runtime state once the bridge + vLLM clients land.
const RUNTIME: { label: string; meta: string; status: DotStatus; icon: LucideIcon }[] = [
  { label: 'Browser storage', meta: '14.2 MB', status: 'on', icon: Database },
  { label: 'Localhost bridge', meta: '2m ago', status: 'on', icon: Cable },
  { label: 'vLLM', meta: 'offline', status: 'warn', icon: Cpu },
]

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
  const { play } = useMascot()
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
        {NAV.map(({ to, label, icon: Icon, badge }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            // Not tabbable while the drawer is closed off-screen.
            tabIndex={!isDesktop && !open ? -1 : undefined}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-md border border-transparent px-3 py-2.5 text-sm transition-colors duration-150 select-none',
                isActive
                  ? 'border-hairline bg-well text-text-1'
                  : 'text-text-2 hover:bg-well hover:text-text-1',
              )
            }
          >
            <Icon className="size-4 shrink-0" strokeWidth={1.7} />
            {label}
            {badge ? (
              <span
                className={cn(
                  'ml-auto rounded-full px-1.5 py-px text-xs font-semibold',
                  badge.tone === 'red'
                    ? 'bg-danger-soft text-danger'
                    : 'bg-accent-soft text-accent',
                )}
              >
                {badge.text}
              </span>
            ) : null}
          </NavLink>
        ))}
      </nav>

      {/* TEMPORARY — a bench for trying the gesture rig while it is being
          tuned. Nothing else depends on it; delete this whole block (and the
          GESTURES/useMascot imports) when the gestures are settled. The same
          list is reachable for real in Settings → Appearance. */}
      <div className="mt-auto flex flex-col gap-1.5 pt-4">
        <div className="px-2.5 pb-0.5 text-xs tracking-wide text-text-3 uppercase">
          Gestures <span className="text-danger normal-case">· temp</span>
        </div>
        <div className="relative">
          <select
            aria-label="Play a gesture"
            // Held at "" rather than tracking a selection: this is a command
            // menu, not a setting. A <select> fires no change event when the
            // current value is picked again, so a sticky value would make every
            // gesture unrepeatable — exactly the thing a test bench needs.
            value=""
            onChange={(event) => {
              if (event.target.value) play(event.target.value as MascotPose)
            }}
            // Not tabbable while the drawer is closed off-screen, matching the
            // nav links above.
            tabIndex={!isDesktop && !open ? -1 : undefined}
            className="w-full cursor-pointer appearance-none rounded-md border border-hairline bg-well py-1.5 pr-7 pl-2.5 text-xs text-text-2 transition-colors hover:bg-row-hover hover:text-text-1"
          >
            <option value="">Play a gesture…</option>
            {GESTURES.map(({ pose, label }) => (
              <option key={pose} value={pose}>
                {label}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden
            className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-text-3"
            strokeWidth={1.7}
          />
        </div>
      </div>

      <div className="flex flex-col gap-[7px] pt-4">
        <div className="px-2.5 pb-0.5 text-xs tracking-wide text-text-3 uppercase">Runtime</div>
        {/* Icon over value, three up. Colour carries health, the icon carries
            what it is, the text carries the value. The label survives as the
            tooltip and as the accessible name — an icon above "2m ago" says
            nothing on its own, and colour alone would be the only signal of
            trouble.

            Deliberately unwired: no onClick, so these are focusable and press
            like buttons but claim to do nothing yet. Each `title` names the
            destination it will get rather than leaving a control that looks
            live and silently swallows the click. */}
        <div className="grid grid-cols-3 gap-1.5">
          {RUNTIME.map((r) => (
            <button
              key={r.label}
              type="button"
              title={`${r.label} — ${r.meta} (opens Settings once wired up)`}
              // Not tabbable while the drawer is closed off-screen, matching
              // the nav links above.
              tabIndex={!isDesktop && !open ? -1 : undefined}
              className="flex cursor-pointer flex-col items-center gap-1 rounded-md border border-hairline bg-well px-1 py-2 transition-colors hover:border-hairline-strong hover:bg-row-hover active:bg-well"
            >
              <r.icon
                aria-hidden
                strokeWidth={1.8}
                className={cn('size-4 shrink-0', RUNTIME_TONE[r.status])}
              />
              <span className="sr-only">{r.label}: </span>
              <span className="text-xs whitespace-nowrap text-text-2">{r.meta}</span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  )
}
