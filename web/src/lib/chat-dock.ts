/**
 * The floating chat dock's rules: which conversation windows are open, how
 * they share the bottom-right corner, and where that corner is.
 *
 * Modelled on LinkedIn's messaging dock because that is the version of this
 * people already know: a bar in the corner that opens into a list of
 * conversations, and each conversation opening as its own small window to the
 * LEFT of the list — newest nearest the list, several at once, each one
 * minimisable to a bar of its own.
 *
 * Pure, so the rules that are easy to get subtly wrong — the cap, the order,
 * what a resize does to windows that no longer fit — run under vitest rather
 * than only in a browser. `ChatDock.tsx` holds the state and draws it.
 */

/** The attribute every part of the dock carries, portals included. See `isInChatDock`. */
export const DOCK_ATTR = 'data-chat-dock'

/** At most this many conversation windows; opening another closes the oldest. */
export const MAX_WINDOWS = 3

/** The collapsed bar's height: what toasts and approvals are lifted clear of. */
export const DOCK_BAR_HEIGHT = 48

/* Geometry, in CSS pixels. */
export const LIST_WIDTH = 288
export const WINDOW_WIDTH = 336
export const GAP = 8
/** Clear space between the dock and the window edge, or the sheet's edge. */
export const EDGE = 16
/** Below this the dock opens full screen, like a phone app does. */
export const PHONE_BELOW = 640
/**
 * The narrowest a one-panel dock is still usable at. Staying clear of the
 * sidebar is preferred, but not at the price of a panel nobody can read in:
 * with the record dragged to its widest at 1600px, keeping clear left 136px.
 */
export const COMPACT_MIN = 300

/** One conversation window. */
export type DockWindow = {
  /** Stable across a draft becoming a conversation, so React keeps the window mounted. */
  key: string
  /** `null` while it is a new conversation that has not been sent yet. */
  threadId: string | null
  /**
   * The application a NEW conversation will be about — the record that was
   * open when it was started. A conversation that exists carries its own
   * filing and ignores this.
   */
  applicationId: string | null
  minimized: boolean
}

export type DockState = {
  listOpen: boolean
  /** Newest first: index 0 sits next to the list. */
  windows: DockWindow[]
}

export const EMPTY_DOCK: DockState = { listOpen: false, windows: [] }

const capped = (windows: DockWindow[]) => windows.slice(0, MAX_WINDOWS)

/** Bring a window to the front and open it out. */
export function focusWindow(state: DockState, key: string): DockState {
  const found = state.windows.find((w) => w.key === key)
  if (!found) return state
  return {
    ...state,
    windows: [{ ...found, minimized: false }, ...state.windows.filter((w) => w.key !== key)],
  }
}

/**
 * Open a conversation in a window. Already open → brought to the front rather
 * than opened twice; past the cap → the oldest window closes, as LinkedIn's
 * does, rather than the new one being refused.
 */
export function openThread(state: DockState, threadId: string, key: string): DockState {
  const open = state.windows.find((w) => w.threadId === threadId)
  if (open) return focusWindow(state, open.key)
  return {
    ...state,
    windows: capped([{ key, threadId, applicationId: null, minimized: false }, ...state.windows]),
  }
}

/**
 * Start a new conversation. One draft at a time: a second "new" while one is
 * still unsent brings that one forward — and gives it the record open NOW,
 * because nothing has been asked in it yet and the record you are looking at
 * is the one you mean.
 */
export function openDraft(state: DockState, applicationId: string | null, key: string): DockState {
  const draft = state.windows.find((w) => w.threadId === null)
  if (draft) {
    const moved = focusWindow(state, draft.key)
    return {
      ...moved,
      windows: moved.windows.map((w) => (w.key === draft.key ? { ...w, applicationId } : w)),
    }
  }
  return {
    ...state,
    windows: capped([{ key, threadId: null, applicationId, minimized: false }, ...state.windows]),
  }
}

/** A draft was sent and is a conversation now. */
export function adoptThread(state: DockState, key: string, threadId: string): DockState {
  return {
    ...state,
    windows: state.windows
      // The same conversation already open elsewhere would be a second window on it.
      .filter((w) => w.key === key || w.threadId !== threadId)
      .map((w) => (w.key === key ? { ...w, threadId } : w)),
  }
}

export function toggleMinimized(state: DockState, key: string): DockState {
  return {
    ...state,
    windows: state.windows.map((w) => (w.key === key ? { ...w, minimized: !w.minimized } : w)),
  }
}

export function closeWindow(state: DockState, key: string): DockState {
  return { ...state, windows: state.windows.filter((w) => w.key !== key) }
}

/** A draft's subject removed from it: it will start a conversation about nothing in particular. */
export function detachApplication(state: DockState, key: string): DockState {
  return {
    ...state,
    windows: state.windows.map((w) => (w.key === key ? { ...w, applicationId: null } : w)),
  }
}

export function setListOpen(state: DockState, listOpen: boolean): DockState {
  return state.listOpen === listOpen ? state : { ...state, listOpen }
}

/** Windows on conversations that no longer exist — deleted elsewhere — are closed. */
export function dropMissing(state: DockState, existing: ReadonlySet<string>): DockState {
  const windows = state.windows.filter((w) => w.threadId === null || existing.has(w.threadId))
  return windows.length === state.windows.length ? state : { ...state, windows }
}

/* --------------------------------- layout --------------------------------- */

export type DockLayout =
  /** Full screen: a phone, or a window too narrow for anything else. */
  | { mode: 'phone' }
  /** One panel at a time — the list or one conversation — in whatever room is left. */
  | { mode: 'compact'; right: number; width: number }
  /** The list and, to its left, as many windows as fit. */
  | { mode: 'full'; right: number; listWidth: number; windowWidth: number; visible: number }

/**
 * Where the dock goes, given the window, the open record's sheet, and the
 * navigation column on the left.
 *
 * NEVER OVER THE SHEET: the dock's right edge is the sheet's left edge plus a
 * gutter, and everything it draws fits in the room left of that — and right
 * of `leftBound`, the sidebar's edge. The sidebar sits above the dock, so a
 * window allowed to run under it was drawn half-hidden; measured with two
 * windows beside an open record at 1600px, the second sat behind the
 * navigation with only its right third showing. When the list
 * and one window do not both fit, it falls back to one panel at a time; on a
 * phone-sized window it goes full screen. Windows that do not fit are kept
 * open but not drawn — `visible` says how many are — so widening the window or
 * narrowing the sheet brings them back rather than losing them.
 */
export function dockLayout(
  viewport: number,
  sheetWidth: number,
  windowCount: number,
  leftBound = 0,
): DockLayout {
  if (viewport < PHONE_BELOW) return { mode: 'phone' }
  const right = EDGE + Math.max(0, sheetWidth)
  /** Everything left of the sheet. */
  const room = viewport - right - EDGE
  /** The same, staying clear of the sidebar — what the dock prefers. */
  const available = room - Math.max(0, leftBound)
  if (available >= LIST_WIDTH + GAP + WINDOW_WIDTH) {
    const fit = Math.floor((available - LIST_WIDTH) / (WINDOW_WIDTH + GAP))
    return {
      mode: 'full',
      right,
      listWidth: LIST_WIDTH,
      windowWidth: WINDOW_WIDTH,
      visible: Math.max(0, Math.min(windowCount, fit, MAX_WINDOWS)),
    }
  }
  // One panel. Clear of the sidebar when that leaves a usable width; otherwise
  // over it — the sidebar is navigation, the sheet is the record, and only the
  // record is never covered.
  const usable = available >= COMPACT_MIN ? available : room
  return { mode: 'compact', right, width: Math.max(0, Math.min(usable, WINDOW_WIDTH)) }
}

/* ------------------------------ where it sits ----------------------------- */

/**
 * Where along the bottom edge the person has moved the dock, and how far it
 * may go.
 *
 * The dock owns the bottom-right corner, and whatever is under it is under it:
 * the last row of a table, the bottom of a long note, a button in the corner of
 * a panel. So it can be dragged sideways — by its bar or by a conversation's
 * header — to anywhere between where `dockLayout` puts it and the sidebar.
 *
 * Stored as a FRACTION of that travel rather than as pixels. "Moved to the
 * middle" should still be the middle after the window is resized, a record is
 * opened beside it (which moves its anchor), or a conversation opens and makes
 * it wider (which shortens the travel). A pixel offset would be right for one
 * of those and wrong for the other two; a fraction is right for all three, and
 * cannot carry the dock under the sidebar or over the record however the room
 * changes, because the travel it multiplies already excludes them.
 */
export const POSITION_KEY = 'jojo.chatDock.position'

/** How far a press has to move before it is a drag rather than a click on the bar. */
export const DRAG_THRESHOLD = 4

/**
 * Within this fraction of either end, a drag lands ON the end.
 *
 * So "back in the corner" is a flick rather than a hunt for the exact pixel —
 * and a dock left 2% off its corner is a dock that looks slightly broken.
 */
export const SNAP = 0.04

/**
 * How far left of its anchor the dock can travel, in pixels.
 *
 * Its own left edge stops an `EDGE` short of the sidebar, measured with the
 * width it has NOW — a dock with two conversations open is wider and travels
 * less. Zero when it already fills the room, including when `dockLayout` let
 * a compact panel run over the sidebar because there was nowhere else.
 */
export function dockTravel(
  viewport: number,
  right: number,
  dockWidth: number,
  leftBound = 0,
): number {
  return Math.max(0, Math.floor(viewport - right - dockWidth - Math.max(0, leftBound) - EDGE))
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/** The stored position, or the corner for anything that is not a number in range. */
export function parsePosition(raw: string | null): number {
  if (raw === null) return 0
  const n = Number(raw)
  return Number.isFinite(n) ? clamp01(n) : 0
}

/** The position after dragging `leftward` pixels from `start`, snapped at the ends. */
export function dragPosition(start: number, leftward: number, travel: number): number {
  if (travel <= 0) return start
  const next = clamp01(start + leftward / travel)
  if (next < SNAP) return 0
  if (next > 1 - SNAP) return 1
  return next
}

/** Pixels left of the anchor, for a position. */
export const dockOffset = (position: number, travel: number): number =>
  Math.round(clamp01(position) * Math.max(0, travel))

/* ------------------------------- persistence ------------------------------ */

/** What survives a reload: open conversations and the list's state. Drafts do not. */
export type StoredDock = { listOpen: boolean; windows: { threadId: string; minimized: boolean }[] }

export const DOCK_KEY = 'jojo.chatDock'

export function serializeDock(state: DockState): string {
  const stored: StoredDock = {
    listOpen: state.listOpen,
    windows: state.windows.flatMap((w) =>
      w.threadId === null ? [] : [{ threadId: w.threadId, minimized: w.minimized }],
    ),
  }
  return JSON.stringify(stored)
}

/**
 * Read back what `serializeDock` wrote, or an empty dock for anything else —
 * a value from an older build, a hand edit, a blocked storage read. `keyOf`
 * mints the window keys, which are a rendering detail and never stored.
 */
export function parseDock(raw: string | null, keyOf: (index: number) => string): DockState {
  if (raw === null) return EMPTY_DOCK
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return EMPTY_DOCK
    const { listOpen, windows } = value as { listOpen?: unknown; windows?: unknown }
    const parsed = Array.isArray(windows)
      ? windows.flatMap((w: unknown) => {
          if (typeof w !== 'object' || w === null) return []
          const { threadId, minimized } = w as { threadId?: unknown; minimized?: unknown }
          return typeof threadId === 'string' && threadId !== ''
            ? [{ threadId, minimized: minimized === true }]
            : []
        })
      : []
    const seen = new Set<string>()
    return {
      listOpen: listOpen === true,
      windows: capped(
        parsed
          .filter((w) => (seen.has(w.threadId) ? false : (seen.add(w.threadId), true)))
          .map((w, i) => ({
            key: keyOf(i),
            threadId: w.threadId,
            applicationId: null,
            minimized: w.minimized,
          })),
      ),
    }
  } catch {
    return EMPTY_DOCK
  }
}

/* ----------------------------------- DOM ---------------------------------- */

/**
 * Whether an event came from somewhere in the dock — its own tree or one of
 * its portals (menus render outside it), all of which carry `DOCK_ATTR`. The
 * application sheet asks this before treating a click or an Escape as a
 * reason to close.
 */
export function isInChatDock(target: EventTarget | null): boolean {
  const el = target as { closest?: (selector: string) => unknown } | null
  return typeof el?.closest === 'function' && el.closest(`[${DOCK_ATTR}]`) != null
}
