import { describe, expect, it } from 'vitest'
import {
  adoptThread,
  closeWindow,
  detachApplication,
  dockLayout,
  dropMissing,
  EDGE,
  EMPTY_DOCK,
  focusWindow,
  isInChatDock,
  LIST_WIDTH,
  MAX_WINDOWS,
  openDraft,
  openThread,
  parseDock,
  serializeDock,
  setListOpen,
  toggleMinimized,
  WINDOW_WIDTH,
  type DockState,
} from './chat-dock'

const keys = (s: DockState) => s.windows.map((w) => w.key)
const threads = (s: DockState) => s.windows.map((w) => w.threadId)

describe('windows', () => {
  it('opens a conversation in front, next to the list', () => {
    const s = openThread(openThread(EMPTY_DOCK, 't1', 'k1'), 't2', 'k2')
    expect(threads(s)).toEqual(['t2', 't1'])
  })

  it('brings an open conversation forward instead of opening it twice, and un-minimises it', () => {
    let s = openThread(openThread(EMPTY_DOCK, 't1', 'k1'), 't2', 'k2')
    s = toggleMinimized(s, 'k1')
    s = openThread(s, 't1', 'k3')
    expect(keys(s)).toEqual(['k1', 'k2'])
    expect(s.windows[0]?.minimized).toBe(false)
  })

  it('closes the oldest window past the cap, as LinkedIn does', () => {
    let s = EMPTY_DOCK
    for (let i = 1; i <= MAX_WINDOWS + 1; i += 1) s = openThread(s, `t${i}`, `k${i}`)
    expect(s.windows).toHaveLength(MAX_WINDOWS)
    expect(threads(s)).toEqual(['t4', 't3', 't2'])
  })

  it('keeps one draft: a second "new" brings it forward with the record open now', () => {
    let s = openDraft(EMPTY_DOCK, 'app:rice', 'd1')
    s = openThread(s, 't1', 'k1')
    s = openDraft(s, 'app:yale', 'd2')
    expect(keys(s)).toEqual(['d1', 'k1'])
    expect(s.windows[0]?.applicationId).toBe('app:yale')
  })

  it('keeps the window key when a draft becomes a conversation, so it stays mounted', () => {
    const s = adoptThread(openDraft(EMPTY_DOCK, 'app:rice', 'd1'), 'd1', 't9')
    expect(s.windows[0]).toMatchObject({ key: 'd1', threadId: 't9', applicationId: 'app:rice' })
  })

  it('never ends up with two windows on one conversation', () => {
    let s = openThread(EMPTY_DOCK, 't9', 'k1')
    s = openDraft(s, null, 'd1')
    s = adoptThread(s, 'd1', 't9')
    expect(threads(s)).toEqual(['t9'])
    expect(keys(s)).toEqual(['d1'])
  })

  it('minimises, focuses, closes and detaches by key', () => {
    let s = openThread(openThread(EMPTY_DOCK, 't1', 'k1'), 't2', 'k2')
    s = toggleMinimized(s, 'k2')
    expect(s.windows[0]?.minimized).toBe(true)
    s = focusWindow(s, 'k1')
    expect(keys(s)).toEqual(['k1', 'k2'])
    s = closeWindow(s, 'k2')
    expect(keys(s)).toEqual(['k1'])
    const d = detachApplication(openDraft(EMPTY_DOCK, 'app:rice', 'd1'), 'd1')
    expect(d.windows[0]?.applicationId).toBeNull()
  })

  it('closes windows on conversations deleted elsewhere, and keeps drafts', () => {
    let s = openThread(openThread(EMPTY_DOCK, 't1', 'k1'), 't2', 'k2')
    s = openDraft(s, null, 'd1')
    s = dropMissing(s, new Set(['t2']))
    expect(threads(s)).toEqual([null, 't2'])
    expect(dropMissing(s, new Set(['t2']))).toBe(s)
  })

  it('opens and closes the list', () => {
    const open = setListOpen(EMPTY_DOCK, true)
    expect(open.listOpen).toBe(true)
    expect(setListOpen(open, true)).toBe(open)
  })
})

describe('dockLayout', () => {
  it('goes full screen on a phone-sized window', () => {
    expect(dockLayout(400, 0, 2)).toEqual({ mode: 'phone' })
  })

  it('docks to the window edge when no record is open, fitting what it can', () => {
    const layout = dockLayout(1600, 0, 3)
    expect(layout).toMatchObject({ mode: 'full', right: EDGE, visible: 3 })
  })

  it('sits beside the sheet, never over it', () => {
    const layout = dockLayout(1280, 520, 3)
    expect(layout.mode).toBe('full')
    if (layout.mode !== 'full') return
    expect(layout.right).toBe(520 + EDGE)
    // Everything it draws fits in the room left of the sheet.
    const used = layout.listWidth + layout.visible * (layout.windowWidth + 8)
    expect(layout.right + used).toBeLessThanOrEqual(1280 - EDGE)
    expect(layout.visible).toBe(1)
  })

  it('falls back to one panel at a time when the list and a window do not both fit', () => {
    const layout = dockLayout(1280, 896, 2)
    expect(layout).toMatchObject({ mode: 'compact', right: 896 + EDGE })
    if (layout.mode !== 'compact') return
    // The room left of the sheet, capped at a normal window's width.
    expect(layout.width).toBe(Math.min(1280 - 896 - 2 * EDGE, WINDOW_WIDTH))
    // And on a window where even that is tight, it shrinks rather than overlapping.
    const tight = dockLayout(900, 630, 1)
    expect(tight).toEqual({ mode: 'compact', right: 630 + EDGE, width: 900 - 630 - 2 * EDGE })
  })

  it('stays clear of the navigation column as well as the sheet', () => {
    // 1600px, a 520px record open, and the sidebar ending 332px in.
    const layout = dockLayout(1600, 520, 3, 332)
    expect(layout.mode).toBe('full')
    if (layout.mode !== 'full') return
    const leftEdge =
      1600 - layout.right - layout.listWidth - layout.visible * (layout.windowWidth + 8)
    expect(leftEdge).toBeGreaterThanOrEqual(332 + EDGE)
    expect(layout.visible).toBe(1)
    // Without the bound the same window fitted two — one of them under the sidebar.
    const unbounded = dockLayout(1600, 520, 3)
    expect(unbounded.mode === 'full' && unbounded.visible).toBe(2)
  })

  it('goes over the sidebar, never the sheet, rather than shrink to something unusable', () => {
    // The record at its widest: staying clear of the sidebar would leave 136px.
    const layout = dockLayout(1600, 1100, 1, 332)
    expect(layout).toEqual({ mode: 'compact', right: 1100 + EDGE, width: WINDOW_WIDTH })
    // Still clear of the sheet: right edge at the sheet's edge, less the gutter.
    if (layout.mode === 'compact') expect(1600 - layout.right).toBe(1600 - 1100 - EDGE)
  })

  it('keeps windows that do not fit open but undrawn, rather than closing them', () => {
    const layout = dockLayout(1100, 0, 3)
    expect(layout.mode).toBe('full')
    if (layout.mode !== 'full') return
    expect(layout.visible).toBe(Math.floor((1100 - 2 * EDGE - LIST_WIDTH) / (WINDOW_WIDTH + 8)))
    expect(layout.visible).toBeLessThan(3)
  })
})

describe('persistence', () => {
  const keyOf = (i: number) => `r${i}`

  it('round-trips open conversations and the list, and drops drafts', () => {
    let s = openThread(openThread(EMPTY_DOCK, 't1', 'k1'), 't2', 'k2')
    s = toggleMinimized(s, 'k1')
    s = setListOpen(openDraft(s, 'app:rice', 'd1'), true)
    const back = parseDock(serializeDock(s), keyOf)
    expect(back).toEqual({
      listOpen: true,
      windows: [
        { key: 'r0', threadId: 't2', applicationId: null, minimized: false },
        { key: 'r1', threadId: 't1', applicationId: null, minimized: true },
      ],
    })
  })

  it('reads anything else as an empty dock', () => {
    for (const raw of [null, '', 'not json', '42', 'null', '{"windows": "x"}']) {
      expect(parseDock(raw, keyOf)).toEqual(EMPTY_DOCK)
    }
  })

  it('drops malformed and repeated windows, and keeps to the cap', () => {
    const raw = JSON.stringify({
      listOpen: 'yes',
      windows: [
        { threadId: 't1' },
        { threadId: 't1' },
        { threadId: '' },
        7,
        { threadId: 't2' },
        { threadId: 't3' },
        { threadId: 't4' },
      ],
    })
    const back = parseDock(raw, keyOf)
    expect(back.listOpen).toBe(false)
    expect(threads(back)).toEqual(['t1', 't2', 't3'])
  })
})

describe('isInChatDock', () => {
  const at = (inside: boolean) => ({
    closest: (sel: string) => (inside && sel === '[data-chat-dock]' ? {} : null),
  })

  it('recognises anything inside the dock, portals included', () => {
    expect(isInChatDock(at(true) as unknown as EventTarget)).toBe(true)
    expect(isInChatDock(at(false) as unknown as EventTarget)).toBe(false)
  })

  it('is false for a target that is not an element', () => {
    expect(isInChatDock(null)).toBe(false)
    expect(isInChatDock({} as EventTarget)).toBe(false)
  })
})
