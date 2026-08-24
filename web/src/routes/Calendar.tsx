import { useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { CalendarArrowDown, Plus } from 'lucide-react'
import { DayRail } from '@/components/calendar/DayRail'
import { EventChip } from '@/components/calendar/EventChip'
import { MonthGrid } from '@/components/calendar/MonthGrid'
import { DAY_DROP_PREFIX, dropTarget } from '@/components/calendar/drop-target'
import { PageHeader, PageOption } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { MONTH_LABELS, buildMonth } from '@/data/calendar'
import { compareItems, isoOf, partsOf, shortDate } from '@/data/timeline'
import type { TimelineItem } from '@/data/timeline'
import { useTimeline } from '@jojo/service/react/use-timeline'
import { useDialogs } from '@/lib/dialogs-context'
import { useCalendarExport } from '@/lib/calendar-export'
import { ICS_FILENAME } from '@jojo/service/core/ics'
import { useCalendarParams, useTitle } from '@/lib/links'
import { useToast } from '@/lib/toast-context'
import { TODAY_PARTS } from '@/lib/today'
import { useArrivalHighlight } from '@/lib/use-arrival-highlight'
import { useReducedMotion } from '@/lib/use-media-query'

export function Calendar() {
  // The month and the selected day live in the URL, not in state: a search
  // result for an interview links to the day it falls on, and a calendar that
  // held its position locally would open on today and leave the reader to find
  // it. `useCalendarParams` also clamps '?m=2&d=31' to something real.
  const { y, m, d, focus, set } = useCalendarParams()
  // Same contract as the Vault's: the tint decays, then the parameter goes.
  useArrivalHighlight(focus, () => set({ focus: undefined }))
  const view = useMemo(() => ({ year: y, month: m }), [y, m])
  // The month is the whole point of this tab — 'Calendar' alone tells a
  // person with three tabs open nothing about which one they left here.
  useTitle(`Calendar — ${MONTH_LABELS[m - 1]} ${y}`)
  const selected = d
  const { open } = useDialogs()
  const { toast } = useToast()
  const calendar = useCalendarExport()

  // Page options, both wired straight into the grid below.
  const [dotsOnly, setDotsOnly] = useState(false)
  const [tallCells, setTallCells] = useState(true)
  const reducedMotion = useReducedMotion()
  const month = useMemo(() => buildMonth(view.year, view.month, TODAY_PARTS), [view])
  const { forMonth, get, remove, reschedule } = useTimeline()

  /** The chip currently in the pointer's hand, rendered in the overlay. */
  const [activeId, setActiveId] = useState<string | null>(null)
  const activeItem = activeId ? get(activeId) : undefined

  // A small activation distance so a click on a chip is not read as a drag.
  // Pointer only, deliberately: the KeyboardSensor's activator is Space/Enter,
  // and it calls preventDefault — bound to a chip that is also the way in to
  // editing, it would eat the very click this page exists to deliver. The
  // keyboard route to a new date is the date field inside the event, which the
  // hint under the grid says out loud.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  // `forMonth` matches the 'YYYY-MM' prefix, year included — checked, because a
  // month-only match would list next October's deadlines under this one.
  const monthItems = useMemo(() => forMonth(view.year, view.month), [forMonth, view])

  const eventsFor = useMemo(() => {
    const map = new Map<number, TimelineItem[]>()
    for (const e of monthItems) {
      const day = partsOf(e.date).d
      map.set(day, [...(map.get(day) ?? []), e])
    }
    // All-day above timed, then by start time — the order the day is lived in.
    for (const list of map.values()) list.sort(compareItems)
    return map
  }, [monthItems])

  /** Keeps the day you were looking at, clamped; snaps to today on the way home. */
  const goTo = (next: { year: number; month: number }) => {
    const day =
      next.year === TODAY_PARTS.year && next.month === TODAY_PARTS.month
        ? TODAY_PARTS.day
        : Math.min(selected, buildMonth(next.year, next.month).days)
    // `focus` is dropped: it names an item on a day you have just left.
    set({ y: next.year, m: next.month, d: day, focus: undefined })
  }

  const isCurrentMonth = view.year === TODAY_PARTS.year && view.month === TODAY_PARTS.month

  const selectedEvents = eventsFor.get(selected) ?? []
  const selectedISO = isoOf(view.year, view.month, selected)

  const restOfMonth = useMemo(
    () => monthItems.filter((e) => partsOf(e.date).d > selected),
    [monthItems, selected],
  )

  const openItem = (item: TimelineItem) =>
    open('timelineItem', { mode: item.remind ? 'reminder' : 'event', initial: item })

  const addOn = (iso: string) => open('timelineItem', { mode: 'event', initial: { date: iso } })

  /**
   * The file is downloaded, not installed — so the toast says what is left to
   * do. A message that stopped at "exported" would leave the reader believing
   * their phone will now warn them, which is the belief this whole export
   * exists to make true.
   */
  const exportCalendar = () => {
    if (!calendar.download()) {
      toast({
        title: 'The calendar file could not be written',
        description: 'The browser refused the download. Nothing has changed here.',
        tone: 'danger',
      })
      return
    }
    toast({
      title: `${String(calendar.count)} date${calendar.count === 1 ? '' : 's'} exported`,
      description: `${ICS_FILENAME} is in your downloads. Open it and your calendar will offer to import them, with a reminder on each.`,
    })
  }

  const onDelete = (item: TimelineItem) => {
    const { restore } = remove(item.id)
    // A calendar entry is a cheap record — a title, a date and a kind, all of
    // them retyped in seconds. An undo is the right guard; a confirmation
    // dialog on every row of a day list would be a tax on the common case.
    toast({
      title: 'Event deleted',
      description: `${item.title} — ${shortDate(item.date)}`,
      tone: 'danger',
      action: { label: 'Undo', onClick: restore },
    })
  }

  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null)
    const over = String(event.over?.id ?? '')
    if (!over.startsWith(DAY_DROP_PREFIX)) return

    const iso = over.slice(DAY_DROP_PREFIX.length)
    const item = get(String(event.active.id))
    // Dropped back where it started: no write, and no toast claiming a move.
    if (!item || item.date === iso) return

    const from = item.date
    reschedule(item.id, iso)
    toast({
      title: `Moved to ${shortDate(iso)}`,
      description: item.title,
      action: { label: 'Undo', onClick: () => reschedule(item.id, from) },
    })
  }

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle="Deadlines, interviews and prep in one view"
        settings={
          <>
            <PageOption
              label="Dots instead of titles"
              hint="Denser month grid — detail and dragging move to the day you select"
              control={
                <Switch
                  checked={dotsOnly}
                  onCheckedChange={setDotsOnly}
                  aria-label="Dots instead of titles"
                />
              }
            />
            <PageOption
              label="Tall day cells"
              hint="More room per day in the grid"
              control={
                <Switch
                  checked={tallCells}
                  onCheckedChange={setTallCells}
                  aria-label="Tall day cells"
                />
              }
            />
          </>
        }
        actions={
          <>
            {/*
              jojo has no notifications, so this is the only way one of these
              dates reaches somebody who is not looking at the app. It sits here
              rather than in Settings because this is the page a person is on
              when they are thinking about dates.
            */}
            <Button variant="outline" size="sm" onClick={exportCalendar}>
              <CalendarArrowDown className="size-3.5" strokeWidth={2} aria-hidden />
              Export to my calendar
            </Button>
            <Button
              size="sm"
              // Prefilled with the day on screen: on a calendar, "add" almost
              // always means "add to the day I am looking at".
              onClick={() => addOn(selectedISO)}
            >
              <Plus className="size-3.5" strokeWidth={2} aria-hidden />
              Add event
            </Button>
          </>
        }
      />

      <DndContext
        sensors={sensors}
        collisionDetection={dropTarget}
        onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        {/* A fixed 320px rail, not a proportional one. The rail holds a day's
            worth of rows and never needed more than that, while `1.6fr / 1fr`
            spent 434px of a 1440px window on it and left the grid's day cells
            at 90px — under two words of a title. A fixed second track hands
            every pixel above 320px to the grid, so the cells grow with the
            window instead of the empty column doing it. */}
        <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <MonthGrid
            month={month}
            monthItems={monthItems}
            eventsFor={eventsFor}
            selected={selected}
            dotsOnly={dotsOnly}
            tall={tallCells}
            isCurrentMonth={isCurrentMonth}
            onGoTo={goTo}
            onSelectDay={(day) => set({ d: day, focus: undefined })}
            onAdd={addOn}
            onOpen={openItem}
          />

          <DayRail
            month={month}
            selected={selected}
            selectedISO={selectedISO}
            events={selectedEvents}
            restOfMonth={restOfMonth}
            focus={focus}
            isCurrentMonth={isCurrentMonth}
            onSelectDay={(day, itemId) => set({ d: day, focus: itemId })}
            onGoTo={goTo}
            onAdd={addOn}
            onOpen={openItem}
            onDelete={onDelete}
          />
        </div>

        {/* Rendered outside every cell, so it is clipped by nothing and stays
            above the grid while it travels. A transform on the chip itself would
            be clipped the moment it left its cell, and no z-index fixes that. */}
        <DragOverlay
          dropAnimation={
            reducedMotion ? null : { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }
          }
        >
          {activeItem ? (
            // Opaque and raised: a timed chip is transparent in its cell, and a
            // transparent thing floating over the grid reads as a rendering fault.
            <EventChip
              item={activeItem}
              className="cursor-grabbing border border-hairline bg-panel shadow-[var(--shadow-raised)]"
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </>
  )
}
