/**
 * Long lists on the phone mount a page at a time, and the Today deck stops at
 * 20 — the phone's half of review findings performance-1 and performance-4.
 *
 * The arithmetic is run. `useRowCap` and `useLatchedFocus` are run too, through
 * a few lines standing in for React's `useState` (this runner mounts nothing —
 * see vitest.config.mts), because "raised for good" is behaviour across renders
 * and the arithmetic alone cannot show it. The wiring in the screens, which
 * import React Native, is read as text with comments removed.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * A one-component stand-in for React's state: slots by call order, and a
 * render that re-runs while a set-state happened during it — what React does
 * for a component that sets its own state while rendering.
 */
const slots: unknown[] = []
let cursor = 0
let dirty = false
vi.mock('react', () => ({
  useState: <T>(initial: T) => {
    const at = cursor++
    if (slots.length <= at) slots.push(initial)
    const set = (next: T) => {
      if (slots[at] !== next) dirty = true
      slots[at] = next
    }
    return [slots[at] as T, set] as const
  },
}))

const { ROW_PAGE, indexOfId, rowCap, useLatchedFocus, useRowCap } =
  await import('@/lib/use-row-cap')

function render<T>(hook: () => T): T {
  for (let pass = 0; pass < 5; pass++) {
    cursor = 0
    dirty = false
    const out = hook()
    if (!dirty) return out
  }
  throw new Error('render did not settle')
}

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) =>
  readFileSync(path.join(SRC, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

/** The body of a top-level function in a source file, up to the next one. */
const fn = (text: string, name: string) => {
  const start = text.indexOf(`function ${name}(`)
  expect(start, name).toBeGreaterThanOrEqual(0)
  const next = text.slice(start + 1).search(/\n(?:export )?function /)
  return next < 0 ? text.slice(start) : text.slice(start, start + 1 + next)
}

describe('rowCap: how many rows a long list mounts', () => {
  it('mounts a page of 100, and everything under a page', () => {
    expect(ROW_PAGE).toBe(100)
    expect(rowCap(80, ROW_PAGE)).toEqual({ shown: 80, hidden: 0 })
    expect(rowCap(100, ROW_PAGE)).toEqual({ shown: 100, hidden: 0 })
    expect(rowCap(101, ROW_PAGE)).toEqual({ shown: 100, hidden: 1 })
    // The measured case: 2,000 records were 2,000 rows built on every keystroke.
    expect(rowCap(2000, ROW_PAGE)).toEqual({ shown: 100, hidden: 1900 })
    expect(rowCap(0, ROW_PAGE)).toEqual({ shown: 0, hidden: 0 })
  })

  it('always mounts the row an arrival points at, however far down', () => {
    expect(rowCap(2000, ROW_PAGE, 1499)).toEqual({ shown: 1500, hidden: 500 })
    expect(rowCap(2000, ROW_PAGE, 1999)).toEqual({ shown: 2000, hidden: 0 })
    // Inside the first page, or no arrival: the page as it was.
    expect(rowCap(2000, ROW_PAGE, 10)).toEqual({ shown: 100, hidden: 1900 })
    expect(rowCap(2000, ROW_PAGE, -1)).toEqual({ shown: 100, hidden: 1900 })
  })

  it('finds the arrival row by id, and -1 for none', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(indexOfId(rows, 'c')).toBe(2)
    expect(indexOfId(rows, 'zz')).toBe(-1)
    expect(indexOfId(rows, undefined)).toBe(-1)
    expect(indexOfId(rows, '')).toBe(-1)
  })
})

describe('useRowCap across renders', () => {
  beforeEach(() => {
    slots.length = 0
  })

  it('adds a page per Show more', () => {
    let cap = render(() => useRowCap(350))
    expect(cap).toMatchObject({ shown: 100, hidden: 250 })
    cap.more()
    cap = render(() => useRowCap(350))
    expect(cap).toMatchObject({ shown: 200, hidden: 150 })
    // Two presses before a re-render are one page: each counts from what is shown.
    cap.more()
    cap.more()
    cap = render(() => useRowCap(350))
    expect(cap).toMatchObject({ shown: 300, hidden: 50 })
    cap.more()
    cap = render(() => useRowCap(350))
    expect(cap).toMatchObject({ shown: 350, hidden: 0 })
  })

  it('keeps the arrival row mounted after the arrival is cleared', () => {
    // Arrived at row 1,500 of 2,000; the route's focus is cleared a moment later.
    expect(render(() => useRowCap(2000, 1500))).toMatchObject({ shown: 1501, hidden: 499 })
    expect(render(() => useRowCap(2000, -1))).toMatchObject({ shown: 1501, hidden: 499 })
    // And Show more carries on from there rather than from the first page.
    render(() => useRowCap(2000, -1)).more()
    expect(render(() => useRowCap(2000, -1))).toMatchObject({ shown: 1601 })
  })
})

describe('useLatchedFocus', () => {
  beforeEach(() => {
    slots.length = 0
  })

  it('holds the last arrival once the route param is cleared, and follows a new one', () => {
    expect(render(() => useLatchedFocus(undefined))).toBeUndefined()
    expect(render(() => useLatchedFocus('file-9'))).toBe('file-9')
    expect(render(() => useLatchedFocus(undefined))).toBe('file-9')
    expect(render(() => useLatchedFocus('file-3'))).toBe('file-3')
    expect(render(() => useLatchedFocus(undefined))).toBe('file-3')
  })
})

describe('every long list mounts a page at a time', () => {
  /** [file, the array it lists, the cap variable] */
  const LISTS: [string, string, string][] = [
    ['screens/ApplicationsScreen.tsx', 'rows', 'cap'],
    ['screens/vault/RemindersTool.tsx', 'rows', 'cap'],
    ['screens/vault/LinksTool.tsx', 'rows', 'cap'],
    ['screens/vault/FilesTool.tsx', 'rows', 'cap'],
    ['screens/vault/SnippetsTool.tsx', 'rows', 'cap'],
    ['screens/vault/PeopleTool.tsx', 'shown', 'cap'],
    ['screens/JobScoutScreen.tsx', 'matches', 'matchCap'],
    ['screens/JobScoutScreen.tsx', 'postings', 'postingCap'],
  ]

  it.each(LISTS)('%s renders %s through the cap, with a Show more', (file, list, cap) => {
    const text = read(file)
    expect(text).toMatch(new RegExp(`const ${cap} = useRowCap\\(${list}\\.length`))
    expect(text).toContain(`${list}.slice(0, ${cap}.shown).map(`)
    expect(text).not.toMatch(new RegExp(`[^.\\w]${list}\\.map\\(`))
    expect(text).toMatch(
      new RegExp(
        `<ShowMoreRows\\s+shown=\\{${cap}\\.shown\\}\\s+hidden=\\{${cap}\\.hidden\\}\\s+onMore=\\{${cap}\\.more\\}`,
      ),
    )
  })

  it('keeps the row a Vault arrival points at mounted', () => {
    for (const file of ['RemindersTool', 'LinksTool', 'FilesTool', 'SnippetsTool', 'PeopleTool']) {
      const text = read(`screens/vault/${file}.tsx`)
      expect(text, file).toMatch(/const arriving = useArrivingFocus\(\)/)
      expect(text, file).toMatch(/useRowCap\(\w+\.length, indexOfId\(\w+, arriving\)\)/)
    }
  })

  it('keeps the row a Job scout arrival points at mounted, latched past the cleared param', () => {
    const text = read('screens/JobScoutScreen.tsx')
    expect(text).toMatch(/const arriving = useLatchedFocus\(route\.params\?\.focus\?\.id\)/)
    expect(text).toMatch(/useRowCap\(matches\.length, indexOfId\(matches, arriving\)\)/)
    expect(text).toMatch(/useRowCap\(postings\.length, indexOfId\(postings, arriving\)\)/)
  })

  it('Screen hands its arrival to the lists inside it, latched', () => {
    const screen = read('components/ui/Screen.tsx')
    expect(screen).toMatch(/const arriving = useLatchedFocus\(focus\)/)
    expect(screen).toMatch(/<FocusArrivalContext\.Provider value=\{arriving\}>/)
    // Still the scope that scrolls to the row (search-places.requests.test.ts).
    expect(screen).toMatch(/useFocusScope\(focus, onArrived/)
  })

  it('caps each board column, and keeps a card just dropped in its new column', () => {
    const board = read('screens/applications/Board.tsx')
    expect(board).toMatch(
      /rowCap\(\s*items\.length,\s*limits\[stage\.id\] \?\? ROW_PAGE,\s*indexOfId\(items, dropped\),?\s*\)/,
    )
    expect(board).toContain('items.slice(0, cap.shown).map(')
    expect(board).not.toMatch(/[^.\w]items\.map\(/)
    expect(board).toMatch(
      /onMoveStage\(card, target\)\s*if \(card && target\) setDropped\(card\.id\)/,
    )
    expect(board).toMatch(/<ShowMoreRows\s+shown=\{cap\.shown\}\s+hidden=\{cap\.hidden\}/)
  })

  it('raises the cap for good rather than only while the arrival is set', () => {
    expect(read('lib/use-row-cap.ts')).toMatch(/if \(keep \+ 1 > limit\) setLimit\(keep \+ 1\)/)
  })
})

describe('the Today deck', () => {
  const today = read('screens/TodayScreen.tsx')

  it('stops at 20 cards with a Show all N', () => {
    expect(today).toMatch(/const DECK_SHOWN = 20/)
    const deck = fn(today, 'PriorityActions')
    expect(deck).toMatch(/actions\.slice\(0, DECK_SHOWN\)/)
    expect(deck).toMatch(/t\('search\.showAll', \{ count: actions\.length \}\)/)
  })

  it('reads the timeline once for the deck, not once per card', () => {
    const deck = fn(today, 'PriorityActions')
    expect(deck.match(/useItemActions\(\)/g)).toHaveLength(1)
    expect(fn(today, 'DecisionCard')).not.toMatch(/useItemActions|useTimeline/)
    expect(fn(today, 'ItemControls')).not.toMatch(/useItemActions|useTimeline|SnoozeMenu/)
    // One snooze sheet for the deck, not one per card.
    expect(deck.match(/<SnoozeMenu /g)).toHaveLength(1)
  })
})

describe('the Show more label', () => {
  it('is in every phone catalog, translated, with both counts', () => {
    const root = path.join(SRC, 'i18n', 'locales')
    const label = (locale: string) =>
      (
        JSON.parse(readFileSync(path.join(root, locale, 'common.json'), 'utf8')) as {
          rows?: { showMore?: string }
        }
      ).rows?.showMore ?? ''
    const english = label('en')
    const locales = readdirSync(root)
    expect(locales).toHaveLength(20)
    for (const locale of locales) {
      const text = label(locale)
      expect(text, locale).toContain('{{shown}}')
      expect(text, locale).toContain('{{total}}')
      if (locale !== 'en') expect(text, locale).not.toBe(english)
    }
  })
})
