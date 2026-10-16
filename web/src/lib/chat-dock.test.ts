import { describe, expect, it } from 'vitest'
import { EDGE, EMPTY_DOCK, LIST_WIDTH, MAX_WINDOWS, WINDOW_WIDTH, adoptThread, closeWindow, detachApplication, dockLayout, dockOffset, dockTravel, dragPosition, dropMissing, focusWindow, isInChatDock, openDraft, openThread, parseDock, parsePosition, serializeDock, setListOpen, toggleMinimized, type DockState } from './chat-dock'

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

describe('moving the dock sideways', () => {
  /*
   * The dock can be dragged off its corner so whatever it covers can be read.
   * Its position is a FRACTION of the room it can travel through, so it means
   * the same place when that room changes — a resize, a record opening beside
   * it, a conversation making it wider.
   */
  it('travels from its anchor to just short of the sidebar', () => {
    // 1440 wide, anchored 16 from the right, a 288px bar, sidebar ending at 252.
    expect(dockTravel(1440, 16, 288, 252)).toBe(1440 - 16 - 288 - 252 - 16)
  })

  it('travels less when it is wider, and not at all when it fills the room', () => {
    expect(dockTravel(1440, 16, 900, 252)).toBeLessThan(dockTravel(1440, 16, 288, 252))
    expect(dockTravel(900, 16, 900, 252)).toBe(0)
  })

  it('keeps a position meaning the same place when the room changes', () => {
    // The middle of a long run and the middle of a short one are both the middle.
    expect(dockOffset(0.5, 800)).toBe(400)
    expect(dockOffset(0.5, 300)).toBe(150)
    // Which is why it cannot overshoot: the travel already stops at the sidebar.
    expect(dockOffset(1, 300)).toBe(300)
  })

  it('maps a drag to a position, leftward being further from the corner', () => {
    expect(dragPosition(0, 400, 800)).toBe(0.5)
    expect(dragPosition(0.5, -200, 800)).toBe(0.25)
  })

  it('snaps onto either end when it is dropped close to it', () => {
    // So the corner is a flick, not a hunt for the exact pixel.
    expect(dragPosition(0.1, -70, 800)).toBe(0)
    expect(dragPosition(0.9, 70, 800)).toBe(1)
  })

  it('clamps a drag past either end, and ignores one with nowhere to go', () => {
    expect(dragPosition(0.5, 5000, 800)).toBe(1)
    expect(dragPosition(0.5, -5000, 800)).toBe(0)
    expect(dragPosition(0.3, 200, 0)).toBe(0.3)
  })

  it('reads back only a stored number in range, and the corner otherwise', () => {
    expect(parsePosition('0.6')).toBe(0.6)
    expect(parsePosition('7')).toBe(1)
    expect(parsePosition('-1')).toBe(0)
    expect(parsePosition('left')).toBe(0)
    expect(parsePosition(null)).toBe(0)
  })
})
