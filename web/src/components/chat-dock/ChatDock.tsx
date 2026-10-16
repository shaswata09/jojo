import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { ChevronDown, ChevronUp, GripVertical, MessageSquarePlus } from 'lucide-react'
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
  dockOffset,
  dockTravel,
  DRAG_THRESHOLD,
  dragPosition,
  parsePosition,
  POSITION_KEY,
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
    /*
     * The LAYOUT width, not `innerWidth`. A `position: fixed` element's `right`
     * is measured from inside the scrollbar, and `innerWidth` includes it — so
     * on a page that scrolled, every width here was 11px too generous and the
     * dock dragged to the far left stopped 5px from the sidebar instead of the
     * 16 it is meant to keep. `clientWidth` on the root is the width `right` is
     * measured against.
     */
    return { viewport: document.documentElement.clientWidth || window.innerWidth, leftBound }
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
    // A scrollbar appearing or going — moving to a page that is taller or
    // shorter than the window — changes the layout width without any resize.
    observer.observe(document.documentElement)
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

/** What a header needs to move the dock: the press, the click it must swallow, the handle. */
export type DockDrag = {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  /** True once, for the click that ends a drag — so a drag never also opens or minimises. */
  swallowClick: () => boolean
  grip: ReactNode
}

/**
 * Sliding the dock along the bottom edge, so whatever it covers can be read.
 *
 * Any press on a header moves the whole dock once it has travelled
 * `DRAG_THRESHOLD` pixels — so the bar and a conversation's header stay the
 * click targets they always were, and only a press that MOVES becomes a drag.
 * The click that ends a drag is swallowed, or letting go would also open the
 * list or minimise the window under the pointer.
 *
 * Presses that start on a control in the header (a button, a link) are left to
 * that control, apart from the grip, which exists to be dragged. The grip is
 * also the keyboard's way to move it: the arrow keys slide it a tenth of the way
 * at a time, Home and End go to either end, and a double-click puts it back in
 * the corner.
 *
 * The position itself is a fraction of the travel — see `dockTravel` — and is
 * remembered, because a person who moved it out of the way once wants it out of
 * the way on every page.
 */
function useDockPosition(travel: number) {
  const [position, setPosition] = useState(() => parsePosition(readStored(POSITION_KEY)))
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    writeStored(POSITION_KEY, String(position))
  }, [position])

  // Read through refs inside the listeners, which outlive the render that made them.
  const travelRef = useRef(travel)
  travelRef.current = travel
  const positionRef = useRef(position)
  positionRef.current = position
  const swallow = useRef(false)

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest('a, button:not([data-dock-grip])')) return
    // A new press clears any swallow left over from a drag whose click never came.
    swallow.current = false
    const el = event.currentTarget
    const startX = event.clientX
    const start = positionRef.current
    let moved = false
    el.setPointerCapture(event.pointerId)

    const move = (e: PointerEvent) => {
      const leftward = startX - e.clientX
      if (!moved && Math.abs(leftward) < DRAG_THRESHOLD) return
      if (!moved) {
        moved = true
        setDragging(true)
      }
      setPosition(dragPosition(start, leftward, travelRef.current))
    }
    const end = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', end)
      el.removeEventListener('pointercancel', end)
      if (moved) swallow.current = true
      setDragging(false)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
  }, [])

  const swallowClick = useCallback(() => {
    if (!swallow.current) return false
    swallow.current = false
    return true
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = 0.1
    const next =
      event.key === 'ArrowLeft'
        ? positionRef.current + step
        : event.key === 'ArrowRight'
          ? positionRef.current - step
          : event.key === 'Home'
            ? 1
            : event.key === 'End'
              ? 0
              : null
    if (next === null) return
    event.preventDefault()
    event.stopPropagation()
    setPosition(Math.min(1, Math.max(0, next)))
  }

  const where =
    position === 0 ? 'in the corner' : position === 1 ? 'at the far left' : `${String(Math.round(position * 100))}% of the way left`
  const grip = (
    <button
      type="button"
      data-dock-grip=""
      aria-label={`Move chat sideways — ${where}. Arrow keys move it; double-click returns it to the corner.`}
      title="Drag to move the chat out of the way · double-click to return it to the corner"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation()
        setPosition(0)
      }}
      onKeyDown={onKeyDown}
      className="grid h-8 w-4 shrink-0 cursor-grab touch-none place-items-center rounded-sm text-text-3 hover:text-text-1 active:cursor-grabbing"
    >
      <GripVertical className="size-3.5" strokeWidth={1.8} aria-hidden />
    </button>
  )

  const drag: DockDrag = { onPointerDown, swallowClick, grip }
  return { offset: dockOffset(position, travel), dragging, drag }
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

  /*
   * The dock's own width, measured, because that is what decides how far it
   * can travel: a bar alone can cross most of the screen, a bar with two
   * conversations beside it much less. A callback ref, so the observer follows
   * the element when the layout swaps one container for another.
   */
  const [dockWidth, setDockWidth] = useState(0)
  const observer = useRef<ResizeObserver | null>(null)
  const measure = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect()
    if (!el) return
    setDockWidth(el.getBoundingClientRect().width)
    observer.current = new ResizeObserver(() => setDockWidth(el.getBoundingClientRect().width))
    observer.current.observe(el)
  }, [])
  useEffect(() => () => observer.current?.disconnect(), [])

  const travel =
    layout.mode === 'phone' ? 0 : dockTravel(viewport, layout.right, dockWidth, leftBound)
  const { offset, dragging, drag } = useDockPosition(travel)

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
      className="flex h-12 shrink-0 cursor-pointer touch-none items-center gap-2 px-3 pl-1.5 select-none"
      style={opts.width === undefined ? undefined : { width: opts.width }}
      onPointerDown={layout.mode === 'phone' ? undefined : drag.onPointerDown}
      onClick={() => {
        if (drag.swallowClick()) return
        opts.onToggle()
      }}
    >
      {layout.mode === 'phone' ? null : drag.grip}
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
  const slide = reducedMotion || dragging ? '' : 'transition-[right] duration-200 ease-out'

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
        ref={measure}
        className={cn('fixed bottom-0 z-50 flex flex-col items-end', slide)}
        style={{ right: layout.right + offset, width: layout.width }}
      >
        {showWindow ? (
          <ChatWindow
            win={front}
            width={layout.width}
            drag={drag}
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
      ref={measure}
      className={cn('fixed bottom-0 z-50 flex flex-row-reverse items-end', slide)}
      style={{ right: layout.right + offset, gap: GAP }}
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
          drag={drag}
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
