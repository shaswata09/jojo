import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, MessageSquarePlus } from 'lucide-react'
import type { NodeId } from '@jojo/service/core/model'
import { useApplications } from '@jojo/service/react/use-applications'
import { useThreads } from '@jojo/service/react/use-threads'
import { ThreadList } from '@/components/assistant/ThreadList'
import { RobotIcon } from '@/components/brand/RobotIcon'
import { ChatWindow } from '@/components/chat-dock/ChatWindow'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  adoptThread,
  closeWindow,
  detachApplication,
  DOCK_ATTR,
  DOCK_BAR_HEIGHT,
  DOCK_KEY,
  dockLayout,
  dropMissing,
  focusWindow,
  GAP,
  openDraft,
  openThread,
  parseDock,
  serializeDock,
  setListOpen,
  toggleMinimized,
  type DockState,
} from '@/lib/chat-dock'
import { useSheetPresence } from '@/lib/sheet-presence'
import { readStored, writeStored } from '@/lib/storage'
import { useReducedMotion } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'

const dockAttr = { [DOCK_ATTR]: '' }

/**
 * The room the dock has: the window's width, and where the navigation column
 * ends — the sidebar sits above the dock, so the dock keeps clear of it rather
 * than running windows underneath. A sidebar that is a closed drawer (off the
 * left edge) bounds nothing.
 */
function useDockBounds() {
  const read = () => {
    const rect = document.querySelector('[data-app-sidebar]')?.getBoundingClientRect()
    const leftBound =
      rect && rect.width > 0 && rect.left >= 0 && rect.right > 0 ? Math.round(rect.right) : 0
    return { viewport: window.innerWidth, leftBound }
  }
  const [bounds, setBounds] = useState(() =>
    typeof window === 'undefined' ? { viewport: 1280, leftBound: 0 } : read(),
  )
  useEffect(() => {
    const update = () =>
      setBounds((prev) => {
        const next = read()
        return next.viewport === prev.viewport && next.leftBound === prev.leftBound ? prev : next
      })
    update()
    window.addEventListener('resize', update)
    const aside = document.querySelector('[data-app-sidebar]')
    const observer = new ResizeObserver(update)
    if (aside) {
      observer.observe(aside)
      // The phone drawer slides by transform, which no observer reports.
      aside.addEventListener('transitionend', update)
    }
    return () => {
      window.removeEventListener('resize', update)
      observer.disconnect()
      aside?.removeEventListener('transitionend', update)
    }
  }, [])
  return bounds
}

/**
 * The floating chat, in the bottom-right corner of every page but the
 * Assistant's own — LinkedIn's messaging dock, for talking to jojo.
 *
 * WHY. The Assistant was a page, so asking it to do something about the
 * application you were reading meant leaving the application. The dock keeps
 * the conversation beside the record: a bar that opens into the list of
 * conversations, and each conversation in its own window to the left of it,
 * newest nearest — several at once, each minimisable. Every conversation is
 * the same one the Assistant page shows, run the same way
 * (`useConversation`), so moving between the two loses nothing.
 *
 * BESIDE THE RECORD, NEVER OVER IT. An open application's sheet publishes its
 * width (`sheet-presence.ts`) and the dock docks to its left edge; when the
 * room left is too narrow for the list and a window it shows one panel at a
 * time, and on a phone-sized window it goes full screen. `dockLayout` holds
 * those rules, and `chat-dock.test.ts` holds them to it. The sheet, for its
 * part, does not treat a click or an Escape inside the dock as a reason to
 * close.
 *
 * A NEW CONVERSATION IS ABOUT THE OPEN RECORD. Started while Rice is open, it
 * is filed under Rice and the model is told "this application" means Rice —
 * see `use-conversation.ts`. The chip at the top of the window says so and can
 * be removed.
 */
export function ChatDock() {
  const { threads } = useThreads()
  const { byId } = useApplications()
  const sheet = useSheetPresence()
  const { viewport, leftBound } = useDockBounds()
  const reducedMotion = useReducedMotion()

  const nextKey = useRef(0)
  const mint = () => `w${String((nextKey.current += 1))}`
  const [state, setState] = useState<DockState>(() => parseDock(readStored(DOCK_KEY), () => mint()))
  const [query, setQuery] = useState('')
  /** In the one-panel layouts: whether the list is showing in place of the front window. */
  const [showList, setShowList] = useState(false)

  useEffect(() => {
    writeStored(DOCK_KEY, serializeDock(state))
  }, [state])

  /* A conversation deleted elsewhere closes its window. Only once there are
     conversations to compare against, so a store still loading cannot wipe
     the windows a reload restored. */
  useEffect(() => {
    if (threads.length === 0) return
    setState((s) => dropMissing(s, new Set(threads.map((t) => t.id))))
  }, [threads])

  /* Lift toasts and approval prompts clear of the bar, which now owns the corner. */
  useEffect(() => {
    document.documentElement.style.setProperty('--dock-clearance', `${DOCK_BAR_HEIGHT + GAP}px`)
    return () => {
      document.documentElement.style.removeProperty('--dock-clearance')
    }
  }, [])

  const update = useCallback(
    (change: (s: DockState) => DockState) => setState((s) => change(s)),
    [],
  )

  const startNew = () => {
    // The open record, if any, is what a new conversation is about.
    const subject =
      sheet.applicationId !== null && byId.has(sheet.applicationId) ? sheet.applicationId : null
    update((s) => setListOpen(openDraft(s, subject, mint()), s.listOpen))
    setShowList(false)
  }
  const openConversation = (id: NodeId) => {
    update((s) => openThread(s, id, mint()))
    setShowList(false)
  }
  const onAdopt = useCallback(
    (key: string, id: NodeId) => update((s) => adoptThread(s, key, id)),
    [update],
  )
  const onToggle = useCallback((key: string) => update((s) => toggleMinimized(s, key)), [update])
  const onClose = useCallback((key: string) => update((s) => closeWindow(s, key)), [update])
  const onDetach = useCallback((key: string) => update((s) => detachApplication(s, key)), [update])

  const layout = dockLayout(viewport, sheet.width, state.windows.length, leftBound)
  const front = state.windows.find((w) => !w.minimized)

  const list = (
    <ThreadList
      bare
      threads={threads}
      activeId={(front?.threadId ?? null) as NodeId | null}
      byId={byId}
      query={query}
      onQuery={setQuery}
      onOpen={openConversation}
      onNew={startNew}
    />
  )

  /** The bar every layout starts from: robot, "Chat", new, and the chevron. */
  const bar = (opts: { open: boolean; onToggle: () => void; width?: number | undefined }) => (
    <div
      className="flex h-12 shrink-0 cursor-pointer items-center gap-2 px-3"
      style={opts.width === undefined ? undefined : { width: opts.width }}
      onClick={opts.onToggle}
    >
      <RobotIcon className="size-5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">Chat with jojo</span>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 shrink-0 text-text-3"
        aria-label="New conversation"
        title={
          sheet.applicationId ? 'New conversation about the open application' : 'New conversation'
        }
        onClick={(e) => {
          e.stopPropagation()
          startNew()
        }}
      >
        <MessageSquarePlus className="size-4" strokeWidth={1.8} aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 shrink-0 text-text-3"
        aria-label={opts.open ? 'Hide conversations' : 'Show conversations'}
        aria-expanded={opts.open}
        onClick={(e) => {
          e.stopPropagation()
          opts.onToggle()
        }}
      >
        {opts.open ? (
          <ChevronDown className="size-4" strokeWidth={1.8} aria-hidden />
        ) : (
          <ChevronUp className="size-4" strokeWidth={1.8} aria-hidden />
        )}
      </Button>
    </div>
  )

  /*
   * `z-50` throughout — the sidebar's layer, and the record sheet's (z-40) is
   * below it. At the same layer the later element paints on top, and the dock
   * comes after the sidebar in the shell, so a compact panel allowed over the
   * sidebar is drawn over it rather than under it. Dialogs, menus and the
   * approval prompt also sit at z-50 but render later still (portals at the
   * end of the body, or after the app), so they stay above the dock.
   */
  const panel =
    'flex flex-col overflow-hidden border border-hairline bg-page shadow-[var(--shadow-raised)]'
  const slide = reducedMotion ? '' : 'transition-[right] duration-200 ease-out'

  /* ------------------------------ phone layout ----------------------------- */
  if (layout.mode === 'phone') {
    const expanded = state.listOpen || front !== undefined
    if (!expanded) {
      return (
        <div {...dockAttr} className="fixed right-4 bottom-4 z-50">
          <Button
            size="icon"
            className="size-12 rounded-full shadow-[var(--shadow-raised)]"
            aria-label="Chat with jojo"
            onClick={() => update((s) => setListOpen(s, true))}
          >
            <RobotIcon className="size-6" aria-hidden />
          </Button>
        </div>
      )
    }
    return (
      <div {...dockAttr} className="fixed inset-0 z-50 flex flex-col bg-page">
        {front && !showList ? (
          <ChatWindow
            win={front}
            width={undefined}
            fullScreen
            onAdopt={onAdopt}
            onToggle={onToggle}
            onClose={onClose}
            onDetach={onDetach}
            onBack={() => setShowList(true)}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {bar({
              open: true,
              onToggle: () => {
                update((s) => setListOpen(s, false))
                setShowList(false)
              },
            })}
            <div className="flex min-h-0 flex-1 flex-col border-t border-hairline px-3 pb-3">
              {list}
            </div>
          </div>
        )}
      </div>
    )
  }

  /* ----------------------------- compact layout ---------------------------- */
  if (layout.mode === 'compact') {
    const showWindow = front !== undefined && !showList
    return (
      <div
        {...dockAttr}
        className={cn('fixed bottom-0 z-50 flex flex-col items-end', slide)}
        style={{ right: layout.right, width: layout.width }}
      >
        {showWindow ? (
          <ChatWindow
            win={front}
            width={layout.width}
            onAdopt={onAdopt}
            onToggle={onToggle}
            onClose={onClose}
            onDetach={onDetach}
            onBack={() => setShowList(true)}
          />
        ) : (
          <div
            className={cn(
              panel,
              'w-full rounded-t-lg border-b-0',
              state.listOpen && 'h-[min(34rem,calc(100dvh-6rem))]',
            )}
          >
            {bar({
              open: state.listOpen,
              onToggle: () => {
                update((s) => setListOpen(s, !s.listOpen))
                setShowList(false)
              },
            })}
            {state.listOpen ? (
              <div className="flex min-h-0 flex-1 flex-col border-t border-hairline px-3 pb-3">
                {list}
              </div>
            ) : null}
          </div>
        )}
      </div>
    )
  }

  /* ------------------------------- full layout ----------------------------- */
  const visible = state.windows.slice(0, layout.visible)
  const hidden = state.windows.slice(layout.visible)

  return (
    <div
      {...dockAttr}
      className={cn('fixed bottom-0 z-50 flex flex-row-reverse items-end', slide)}
      style={{ right: layout.right, gap: GAP }}
    >
      <div
        className={cn(
          panel,
          'rounded-t-lg border-b-0',
          state.listOpen && 'h-[min(34rem,calc(100dvh-6rem))]',
        )}
        style={{ width: layout.listWidth }}
      >
        {bar({ open: state.listOpen, onToggle: () => update((s) => setListOpen(s, !s.listOpen)) })}
        {state.listOpen ? (
          <div className="flex min-h-0 flex-1 flex-col border-t border-hairline px-3 pb-3">
            {list}
          </div>
        ) : null}
      </div>

      {visible.map((w) => (
        <ChatWindow
          key={w.key}
          win={w}
          width={layout.windowWidth}
          onAdopt={onAdopt}
          onToggle={onToggle}
          onClose={onClose}
          onDetach={onDetach}
        />
      ))}

      {/* Windows that no longer fit — the sheet widened, the window narrowed —
          stay open behind a "+N", as LinkedIn's overflow does, rather than
          being closed out from under the person. */}
      {hidden.length > 0 ? (
        <Overflow
          hidden={hidden}
          threads={threads}
          onPick={(key) => update((s) => focusWindow(s, key))}
        />
      ) : null}
    </div>
  )
}

function Overflow({
  hidden,
  threads,
  onPick,
}: {
  hidden: DockState['windows']
  threads: ReturnType<typeof useThreads>['threads']
  onPick: (key: string) => void
}) {
  const [open, setOpen] = useState(false)
  const titles = useMemo(() => new Map(threads.map((t) => [t.id, t.title])), [threads])
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="mb-2 shadow-[var(--shadow-raised)]"
          aria-label={`${String(hidden.length)} more open conversation${hidden.length === 1 ? '' : 's'}`}
        >
          +{hidden.length}
        </Button>
      </PopoverTrigger>
      <PopoverContent {...dockAttr} align="end" side="top" className="w-56 gap-1 p-1.5">
        {hidden.map((w) => (
          <button
            key={w.key}
            type="button"
            className="w-full cursor-pointer truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-well"
            onClick={() => {
              setOpen(false)
              onPick(w.key)
            }}
          >
            {(w.threadId && titles.get(w.threadId as NodeId)) ?? 'New conversation'}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}
