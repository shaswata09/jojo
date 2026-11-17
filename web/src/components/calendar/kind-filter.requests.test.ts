/**
 * Q052: the Calendar page has a legend of event types, and pressing one hides
 * or shows that type's events — the same control, and the same behaviour, as
 * the charts' legends. The date-colour key stays beside it.
 *
 * The filter rule and the legend's entries are pure and tested directly. The
 * wiring is JSX, which D20 leaves to a narrow source read: the route keeps the
 * hidden set in `useSeriesToggle`, filters the month once and builds the grid
 * and both day lists from the filtered list; the grid draws `ChartLegend` with
 * the hook's `toggle`.
 */

import { describe, expect, it } from 'vitest'
import calendarEn from '@/i18n/locales/en/calendar.json'
import { KIND_LEGEND, kindToReveal, shownKinds } from './kind-filter'
import { KIND_ICON, KIND_LABEL, TIMELINE_KINDS } from '@/lib/timeline-visuals'
import { toggledIn } from '@/lib/use-series-toggle'
import type { TimelineKind } from '@jojo/service/core/model'

const sources = import.meta.glob(
  [
    '/src/routes/Calendar.tsx',
    '/src/components/calendar/MonthGrid.tsx',
    '/src/components/calendar/DayRail.tsx',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

const route = sources['/src/routes/Calendar.tsx'] ?? ''
const grid = sources['/src/components/calendar/MonthGrid.tsx'] ?? ''
const rail = sources['/src/components/calendar/DayRail.tsx'] ?? ''

const items = [
  { id: 'a', kind: 'deadline' },
  { id: 'b', kind: 'interview' },
  { id: 'c', kind: 'prep' },
  { id: 'd', kind: 'interview' },
] as const satisfies readonly { id: string; kind: TimelineKind }[]

describe('the calendar event-type legend (Q052)', () => {
  it('lists every event type the calendar has, with its name and icon', () => {
    expect(KIND_LEGEND.map((e) => e.key)).toEqual(TIMELINE_KINDS)
    for (const entry of KIND_LEGEND) {
      const kind = entry.key as TimelineKind
      expect(entry.label).toBe(KIND_LABEL[kind])
      expect(entry.icon).toBe(KIND_ICON[kind])
    }
    // The five the owner named are among them.
    for (const label of ['Deadline', 'Interview', 'Visit', 'Call', 'Prep'])
      expect(KIND_LEGEND.map((e) => e.label)).toContain(label)
  })

  it('hides the events of a type switched off and shows them again when switched back on', () => {
    const off = toggledIn(new Set<TimelineKind>(), 'interview')
    expect(shownKinds(items, off).map((i) => i.id)).toEqual(['a', 'c'])
    const on = toggledIn(off, 'interview')
    expect(shownKinds(items, on).map((i) => i.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('can switch every type off', () => {
    expect(shownKinds(items, new Set<TimelineKind>(TIMELINE_KINDS))).toEqual([])
  })

  it('keeps the hidden set in the charts’ toggle hook, filtering the month the grid and day lists read', () => {
    expect(route).toMatch(/const kinds = useSeriesToggle\(TIMELINE_KINDS\)/)
    expect(route).toMatch(
      /const monthItems = useMemo\(\s*\(\) => shownKinds\(allMonthItems, kinds\.hidden\)/,
    )
    // The grid, the selected day and the rest of the month all come from the
    // filtered list, never from the unfiltered one.
    expect(route).toMatch(/for \(const e of monthItems\)/)
    expect(route).toMatch(/monthItems\.filter\(\(e\) => partsOf\(e\.date\)\.d > selected\)/)
    expect(route).toMatch(/<MonthGrid[\s\S]*?monthItems=\{monthItems\}[\s\S]*?kinds=\{kinds\}/)
  })

  it('draws the type legend under the grid as chart-legend toggles, beside the date-colour key', () => {
    expect(grid).toMatch(
      /<ChartLegend items=\{KIND_LEGEND\} isHidden=\{kinds\.isHidden\} onToggle=\{kinds\.toggle\} \/>/,
    )
    const types = grid.indexOf(">{t('grid.eventTypes')}</span>")
    const colours = grid.indexOf(">{t('grid.dateColours')}</span>")
    expect(calendarEn.grid.eventTypes).toBe('Event types')
    expect(calendarEn.grid.dateColours).toBe('Date colours')
    expect(types).toBeGreaterThan(0)
    expect(colours).toBeGreaterThan(types)
    // The date key itself is still there, with its three marks.
    for (const key of ['overdue', 'soon', 'done'] as const)
      expect(grid).toContain(`label: t('grid.marks.${key}')`)
    expect(calendarEn.grid.marks).toEqual({
      overdue: 'Overdue',
      soon: 'Due within 48 hours',
      done: 'Done',
    })
  })

  it('says a day is hidden rather than empty when every event on it is switched off', () => {
    expect(rail).toMatch(/events\.length === 0 && hiddenOnDay > 0 \?/)
    expect(rail).toContain("t('rail.showAllTypes')")
    expect(calendarEn.rail.showAllTypes).toBe('Show all event types')
  })
})

describe('a link to an item of a hidden type (Q052)', () => {
  it('switches that one type back on so the link lands on its item', () => {
    const hidden = new Set<TimelineKind>(['interview', 'prep'])
    expect(kindToReveal('interview', hidden)).toBe('interview')
    expect(kindToReveal('deadline', hidden)).toBeNull()
    expect(kindToReveal(undefined, hidden)).toBeNull()
    // Wired: the route asks for the focused item's kind and toggles it on.
    expect(route).toMatch(/kindToReveal\(focusedKind, kinds\.hidden\)/)
    expect(route).toMatch(/if \(reveal !== null\) toggleKind\(reveal\)/)
  })
})
