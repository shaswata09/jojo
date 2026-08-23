import type { RefObject } from 'react'
import { NavLink } from 'react-router'
import { CircleHelp, Menu, Search, Settings, UserRound } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { RobotIcon } from '@/components/brand/RobotIcon'
import { NewMenu } from '@/components/layout/NewMenu'
import { SpotlightSearch } from '@/components/layout/SpotlightSearch'
import { useSpotlight } from '@/lib/use-spotlight'
import { cn } from '@/lib/utils'

type UtilityLink = { to: string; label: string; icon: LucideIcon }

/**
 * Account and support destinations. They live here rather than in the sidebar
 * because they are a different class from the workflow pages — you visit them
 * occasionally, not as part of tracking a search.
 */
// Chat was here too, pointing at a page whose whole content was "Not built
// yet". A permanent icon in the chrome leading to a stub is a dead end you
// cannot help walking into; the route went with it.
const ACCOUNT: UtilityLink[] = [
  { to: '/profile', label: 'My profile', icon: UserRound },
  { to: '/settings', label: 'Settings', icon: Settings },
]

/** The assistant sits on its own — it is a capability, not a settings page. */
const ASSISTANT: UtilityLink[] = [
  { to: '/assistant', label: 'Assistant', icon: RobotIcon as unknown as LucideIcon },
]

/** Help sits last, after appearance — the least-used destination. */
const HELP: UtilityLink[] = [{ to: '/guide', label: 'How to use', icon: CircleHelp }]

const iconButton =
  'grid size-8 shrink-0 place-items-center rounded-md border transition-colors duration-150'

function Divider() {
  return <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-hairline" />
}

export function Topbar({
  onOpenNav,
  navButtonRef,
}: {
  onOpenNav: () => void
  navButtonRef: RefObject<HTMLButtonElement | null>
}) {
  const spotlight = useSpotlight()

  return (
    // Pinned so search stays reachable on long pages — the offsets match the
    // shell's padding, and the sidebar's own `lg:top-5`, so they line up.
    // Below the drawer (z-50) and its backdrop (z-40), above page content.
    <div className="surface sticky top-3 z-30 flex flex-wrap items-center gap-x-3 gap-y-2.5 rounded-lg px-3 py-3 sm:top-5 sm:px-5">
      <button
        ref={navButtonRef}
        type="button"
        onClick={onOpenNav}
        aria-label="Open navigation"
        className={cn(
          iconButton,
          'border-hairline bg-well text-text-2 hover:text-text-1 lg:hidden',
        )}
      >
        <Menu className="size-4" strokeWidth={1.7} />
      </button>

      {/* A button, not an input: the real field lives in the overlay, so
          there is only ever one place text goes. An input here that forwarded
          keystrokes elsewhere would be two fields pretending to be one. */}
      <button
        type="button"
        onClick={() => spotlight.setOpen(true)}
        className="order-last flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-hairline bg-well px-2.5 text-left text-sm text-text-3 transition-colors hover:border-hairline-strong hover:text-text-2 sm:order-none sm:w-auto sm:flex-1"
      >
        <Search className="size-4 shrink-0" strokeWidth={1.7} aria-hidden />
        <span className="min-w-0 flex-1 truncate">Search applications, reminders, events…</span>
        <kbd className="hidden shrink-0 rounded-sm border border-hairline bg-panel px-1.5 py-0.5 font-mono text-xs text-text-3 sm:inline">
          ⌘K
        </kbd>
      </button>

      <SpotlightSearch open={spotlight.open} onOpenChange={spotlight.setOpen} />

      {/* Create sits before the account icons: it is an action rather than
          navigation, and until it landed here every route hid its own version
          of "add", so adding a reminder meant first finding the page that owned
          reminders. `NewMenu` runs the `n` shortcut itself, and
          `useNewShortcut` is no longer exported so nothing else can — two
          callers would be two listeners driving two states, and the key would
          open whichever menu mounted last as well.

          The role filter used to sit beside it. It was pinned globally but
          changed two of a dozen surfaces, so every dashboard number was
          ambiguous about whether it counted the whole search; it now lives in
          the Applications toolbar, next to the only list it filters. */}
      <div className="ml-auto flex items-center gap-2 sm:ml-0">
        <NewMenu />
      </div>

      {/* Three groups, hairline-separated: account and support · assistant ·
          appearance. The rules stop eight adjacent icons reading as one
          undifferentiated strip. */}
      <nav aria-label="Account and support" className="flex items-center gap-1.5">
        <Divider />

        {ACCOUNT.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            title={label}
            aria-label={label}
            className={({ isActive }) =>
              cn(
                iconButton,
                isActive
                  ? 'border-accent-border bg-accent-soft text-accent'
                  : 'border-transparent text-text-2 hover:bg-well hover:text-text-1',
              )
            }
          >
            <Icon className="size-4" strokeWidth={1.7} />
          </NavLink>
        ))}

        <Divider />

        {ASSISTANT.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            title={label}
            aria-label={label}
            className={({ isActive }) =>
              cn(
                iconButton,
                isActive
                  ? 'border-accent-border bg-accent-soft text-accent'
                  : 'border-transparent text-text-2 hover:bg-well hover:text-text-1',
              )
            }
          >
            <Icon className="size-4" strokeWidth={1.7} />
          </NavLink>
        ))}

        <Divider />

        {HELP.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            title={label}
            aria-label={label}
            className={({ isActive }) =>
              cn(
                iconButton,
                isActive
                  ? 'border-accent-border bg-accent-soft text-accent'
                  : 'border-transparent text-text-2 hover:bg-well hover:text-text-1',
              )
            }
          >
            <Icon className="size-4" strokeWidth={1.7} />
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
