import { useEffect, useMemo, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useRoute } from '@react-navigation/native'
import type { RouteProp } from '@react-navigation/native'
import { MonthPickerSheet } from '@/components/common/DateField'
import { ItemMenu, SnoozeMenu } from '@/components/common/ItemMenus'
import { Button, IconButton } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Screen } from '@/components/ui/Screen'
import { SettingRow, Toggle } from '@/components/ui/Field'
import { Divider, Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import {
  MONTH_LABELS,
  TODAY as TODAY_PARTS,
  WEEKDAYS,
  buildMonth,
  stepMonth,
} from '@/data/calendar'
import { compareItems, isoOf, partsOf, shortDate, timeLabel } from '@/data/timeline'
import type { TimelineItem } from '@/data/timeline'
import { markColor, markOf } from '@/lib/marks'
import type { Mark } from '@/lib/marks'
import { useSheets } from '@/lib/sheets-context'
import { useTimeline } from '@/lib/store-context'
import { KIND_ICON, KIND_LABEL } from '@/lib/timeline-visuals'
import { useItemActions } from '@/lib/use-item-actions'
import type { TabParamList } from '@/navigation/types'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { radius, space } from '@/theme/tokens'

const TODAY_ISO = isoOf(TODAY_PARTS.year, TODAY_PARTS.month, TODAY_PARTS.day)
const TODAY_MONTH = `${MONTH_LABELS[TODAY_PARTS.month - 1]} ${TODAY_PARTS.year}`

export function CalendarScreen() {
  const c = useColors()
  const route = useRoute<RouteProp<TabParamList, 'Calendar'>>()
  const { open } = useSheets()
  const { forMonth } = useTimeline()
  const actions = useItemActions()

  // One shape for both entry points: a link from elsewhere names a day, and
  // with no parameter the screen opens on the seed's pinned today.
  const start = route.params?.date
    ? (({ y, m, d }) => ({ year: y, month: m, day: d }))(partsOf(route.params.date))
    : TODAY_PARTS

  const [view, setView] = useState({ year: start.year, month: start.month })
  const [selected, setSelected] = useState<number>(start.day)
  const [tallCells, setTallCells] = useState(true)
  const [menuFor, setMenuFor] = useState<TimelineItem | null>(null)
  const [snoozing, setSnoozing] = useState<TimelineItem | null>(null)
  /** The jump-to-month grid. Paging to next March is otherwise five taps. */
  const [jumping, setJumping] = useState(false)

  // A link from elsewhere in the app names a day; the calendar has to follow it
  // even when this screen was already mounted on another month.
  useEffect(() => {
    const iso = route.params?.date
    if (!iso) return
    const { y, m, d } = partsOf(iso)
    setView({ year: y, month: m })
    setSelected(d)
  }, [route.params?.date])

  const month = useMemo(() => buildMonth(view.year, view.month), [view])
  // `forMonth` matches the 'YYYY-MM' prefix, year included — a month-only match
  // would list next October's deadlines under this one.
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

  // Leading blanks so the 1st lands on its weekday, then enough trailing blanks
  // to finish the week — both ends render as real (empty) cells, or the grid
  // loses its corners and reads as a rendering fault.
  const trailing = (7 - ((month.startsOn + month.days) % 7)) % 7
  const cells: (number | null)[] = [
    ...Array.from({ length: month.startsOn }, () => null),
    ...Array.from({ length: month.days }, (_, i) => i + 1),
    ...Array.from({ length: trailing }, () => null),
  ]

  /** Keeps the day you were looking at, clamped; snaps to today on the way home. */
  const goTo = (next: { year: number; month: number }) => {
    setView(next)
    setSelected((day) =>
      next.year === TODAY_PARTS.year && next.month === TODAY_PARTS.month
        ? TODAY_PARTS.day
        : Math.min(day, buildMonth(next.year, next.month).days),
    )
  }

  const isCurrentMonth = view.year === TODAY_PARTS.year && view.month === TODAY_PARTS.month
  const nextMonth = stepMonth(view.year, view.month, 1)
  const selectedEvents = eventsFor.get(selected) ?? []
  const selectedISO = isoOf(view.year, view.month, selected)
  const isLastDay = selected === month.days

  const restOfMonth = useMemo(
    () => monthItems.filter((e) => partsOf(e.date).d > selected),
    [monthItems, selected],
  )

  /**
   * The key under the grid, built from what this month actually contains.
   *
   * Filtered by presence rather than listed unconditionally: a key promising an
   * overdue colour in a month that has nothing overdue is invented data one step
   * removed.
   */
  const marksPresent = new Set(monthItems.map((item) => markOf(item)))
  const markKey = (
    [
      { key: 'overdue', color: c.danger, label: 'Overdue' },
      { key: 'soon', color: c.warning, label: 'Due within 48 hours' },
      { key: 'done', color: c.text3, label: 'Done', hollow: true },
    ] as const
  ).filter((entry) => marksPresent.has(entry.key as Mark))

  const openItem = (item: TimelineItem) =>
    open('timelineItem', { mode: item.remind ? 'reminder' : 'event', initial: item })

  const addOn = (iso: string) => open('timelineItem', { mode: 'event', initial: { date: iso } })

  /** Local alias so the JSX reads as it did; the rule itself lives in lib/marks. */
  const colorOf = (mark: Mark) => markColor(mark, c)

  return (
    <Screen
      title="Calendar"
      subtitle="Deadlines, interviews and prep in one view"
      actions={
        <Button
          label="Add"
          icon="plus"
          // Prefilled with the day on screen: on a calendar, "add" almost always
          // means "add to the day I am looking at".
          onPress={() => addOn(selectedISO)}
        />
      }
      options={
        <SettingRow
          label="Tall day cells"
          description="More room per day in the grid"
          control={<Toggle value={tallCells} onValueChange={setTallCells} label="Tall day cells" />}
        />
      }
    >
      <Panel>
        <View style={styles.monthHead}>
          {/* The heading is the jump-to-month trigger. Stepping a year at a
              time through the arrows is twelve taps to reach next March, which
              is the one thing a calendar must not make expensive. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${month.label} ${month.year}. Go to another month`}
            onPress={() => setJumping(true)}
            style={s.fill}
          >
            <Txt size="md" weight="medium">
              {month.label}{' '}
              <Txt size="md" tone="muted">
                {month.year}
              </Txt>{' '}
              <Feather name="chevron-down" size={13} color={c.text3} />
            </Txt>
          </Pressable>
          <IconButton
            icon="chevron-left"
            label="Previous month"
            onPress={() => goTo(stepMonth(view.year, view.month, -1))}
          />
          {/* A word, not a 6px dot between two arrows. Not disabled on the
              current month: from October 20 it still walks you back to October
              12, which is the more common reason to press it. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              isCurrentMonth ? `Back to ${shortDate(TODAY_ISO)}` : `Go to ${TODAY_MONTH}`
            }
            onPress={() => goTo({ year: TODAY_PARTS.year, month: TODAY_PARTS.month })}
            style={[
              styles.todayButton,
              {
                backgroundColor: isCurrentMonth ? c.accentSoft : c.well,
                borderColor: isCurrentMonth ? c.accentBorder : c.hairline,
              },
            ]}
          >
            <Txt size="sm" tone={isCurrentMonth ? 'accent' : 'secondary'}>
              Today
            </Txt>
          </Pressable>
          <IconButton
            icon="chevron-right"
            label="Next month"
            onPress={() => goTo(stepMonth(view.year, view.month, 1))}
          />
        </View>

        <Txt size="xs" tone="muted" style={{ marginBottom: space[2] }}>
          Tap a day to list what is on it. Tap an event to edit or reschedule it.
        </Txt>

        <View style={styles.weekdays}>
          {WEEKDAYS.map((label) => (
            <Txt key={label} size="xs" tone="muted" center uppercase style={styles.cell}>
              {label.slice(0, 1)}
            </Txt>
          ))}
        </View>

        <View style={styles.grid}>
          {cells.map((day, i) => {
            if (day === null) {
              return (
                <View key={`blank-${i}`} style={styles.cell}>
                  {/* Outline only, no fill: it completes the frame without
                      offering itself as a day. */}
                  <View
                    style={[
                      styles.dayCell,
                      tallCells && styles.dayCellTall,
                      { borderColor: c.hairline },
                    ]}
                  />
                </View>
              )
            }

            const items = eventsFor.get(day) ?? []
            const isToday = day === month.today
            const isSelected = day === selected

            return (
              <View key={day} style={styles.cell}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={`${month.label} ${day}, ${items.length} ${
                    items.length === 1 ? 'event' : 'events'
                  }`}
                  onPress={() => setSelected(day)}
                  style={[
                    styles.dayCell,
                    tallCells && styles.dayCellTall,
                    {
                      backgroundColor: isSelected ? c.accentSoft : c.well,
                      borderColor: isSelected ? c.accentBorder : c.hairline,
                    },
                  ]}
                >
                  <View style={[styles.dayNumber, isToday && { backgroundColor: c.accent }]}>
                    <Txt
                      size="xs"
                      weight={isToday || items.length > 0 ? 'medium' : 'regular'}
                      color={isToday ? c.accentFg : items.length > 0 ? c.text1 : c.text3}
                    >
                      {day}
                    </Txt>
                  </View>

                  <View style={styles.dots}>
                    {items.slice(0, 3).map((e) => {
                      const mark = markOf(e)
                      return (
                        <View
                          key={e.id}
                          style={[
                            styles.dot,
                            mark === 'done'
                              ? { borderWidth: 1, borderColor: c.text3 }
                              : { backgroundColor: colorOf(mark) },
                          ]}
                        />
                      )
                    })}
                    {items.length > 3 ? (
                      <Txt size="xs" tone="muted">
                        +{items.length - 3}
                      </Txt>
                    ) : null}
                  </View>
                </Pressable>
              </View>
            )
          })}
        </View>

        {/* A key to the grid, not a filter of it. */}
        {markKey.length > 0 ? (
          <View style={[styles.key, { borderTopColor: c.hairline }]}>
            {markKey.map((entry) => (
              <View key={entry.key} style={styles.keyRow}>
                <View
                  style={[
                    styles.dot,
                    'hollow' in entry && entry.hollow
                      ? { borderWidth: 1, borderColor: entry.color }
                      : { backgroundColor: entry.color },
                  ]}
                />
                <Txt size="xs" tone="secondary">
                  {entry.label}
                </Txt>
              </View>
            ))}
          </View>
        ) : null}
      </Panel>

      <Panel>
        <PanelTitle hint={shortDate(selectedISO)}>
          {selected === month.today ? 'Today' : 'Selected day'}
        </PanelTitle>

        {selectedEvents.length === 0 ? (
          <EmptyState
            compact
            icon="calendar"
            title={`Nothing on ${shortDate(selectedISO)}`}
            description="Add an interview, a deadline or a block of prep and it shows up here and on the grid."
            action={
              <>
                <Button label="Add event" icon="plus" onPress={() => addOn(selectedISO)} />
                {/* An empty day in a month you paged to is the easiest place to
                    get lost: nothing on screen names where "now" is. */}
                {isCurrentMonth ? null : (
                  <Button
                    label={`Back to ${TODAY_MONTH}`}
                    variant="outline"
                    onPress={() => goTo({ year: TODAY_PARTS.year, month: TODAY_PARTS.month })}
                  />
                )}
              </>
            }
          />
        ) : (
          selectedEvents.map((e, i) => {
            const mark = markOf(e)
            const done = mark === 'done'
            return (
              <View key={e.id}>
                {i > 0 ? <Divider /> : null}
                <View style={styles.eventRow}>
                  <Feather
                    name={done ? 'check-circle' : KIND_ICON[e.kind]}
                    size={16}
                    color={done ? c.success : colorOf(mark)}
                    style={{ marginTop: 3 }}
                  />
                  <Pressable accessibilityRole="button" onPress={() => openItem(e)} style={s.fill}>
                    <Txt
                      size="sm"
                      tone={done ? 'muted' : 'primary'}
                      style={done ? s.struck : undefined}
                    >
                      {e.title}
                    </Txt>
                    <Txt size="xs" tone="muted" numberOfLines={1}>
                      {[timeLabel(e) ?? 'All day', done ? 'Done' : null, e.detail]
                        .filter(Boolean)
                        .join(' · ')}
                    </Txt>
                  </Pressable>
                  <Txt size="xs" tone="muted">
                    {KIND_LABEL[e.kind]}
                  </Txt>
                  {/* Tick it off here too: the calendar is where you notice a
                      thing is done, and walking to the Vault to say so is the
                      trip this checkbox saves. */}
                  <IconButton
                    icon={done ? 'check-circle' : 'circle'}
                    size={34}
                    label={done ? `Reopen ${e.title}` : `Mark "${e.title}" done`}
                    active={done}
                    onPress={() => actions.complete(e)}
                  />
                  {/* One overflow rather than a bin: edit, duplicate, draft,
                      reschedule and delete, in the order every list uses. A
                      delete has to cost a menu. Rescheduling by dragging a chip
                      across a 360px grid is a gesture a phone cannot land, so
                      the menu is also where a move lives. */}
                  <IconButton
                    icon="more-horizontal"
                    size={34}
                    label={`More actions for ${e.title}`}
                    onPress={() => setMenuFor(e)}
                  />
                </View>
              </View>
            )
          })
        )}
      </Panel>

      <Panel>
        <PanelTitle>Rest of {month.label}</PanelTitle>

        {restOfMonth.length === 0 ? (
          <EmptyState
            compact
            icon="calendar"
            title={
              isLastDay
                ? `${shortDate(selectedISO)} is the last day of the month`
                : `Nothing after ${shortDate(selectedISO)}`
            }
            description={
              isLastDay
                ? `Nothing sits after it. Page forward to plan into ${MONTH_LABELS[nextMonth.month - 1]}.`
                : `The rest of ${month.label} is clear. Anything you add after this day lands here.`
            }
            action={
              // An "add" here has to land on a day this list would show, or
              // pressing it leaves the same empty state on screen. On the last
              // day of the month no such day exists, so the honest offer is the
              // next month rather than a new event.
              isLastDay ? (
                <Button
                  label={`Go to ${MONTH_LABELS[nextMonth.month - 1]}`}
                  icon="chevron-right"
                  onPress={() => goTo(nextMonth)}
                />
              ) : (
                <Button
                  label="Add event"
                  icon="plus"
                  onPress={() => addOn(isoOf(view.year, view.month, selected + 1))}
                />
              )
            }
          />
        ) : (
          restOfMonth.slice(0, 6).map((e) => {
            const day = partsOf(e.date).d
            const mark = markOf(e)
            return (
              <Pressable
                key={e.id}
                accessibilityRole="button"
                accessibilityLabel={`Go to ${month.label} ${day}`}
                onPress={() => setSelected(day)}
                style={styles.restRow}
              >
                <View
                  style={[
                    styles.dot,
                    mark === 'done'
                      ? { borderWidth: 1, borderColor: c.text3 }
                      : { backgroundColor: colorOf(mark) },
                  ]}
                />
                <Txt size="sm" tone="secondary" style={s.fill} numberOfLines={1}>
                  {e.title}
                </Txt>
                <Txt size="xs" tone="muted" mono>
                  {month.label.slice(0, 3)} {day}
                </Txt>
              </Pressable>
            )
          })
        )}
        {restOfMonth.length > 6 ? (
          <Txt size="xs" tone="muted" style={{ marginTop: space[2] }}>
            +{restOfMonth.length - 6} more later this month
          </Txt>
        ) : null}
      </Panel>

      <ItemMenu
        item={menuFor}
        actions={actions}
        onClose={() => setMenuFor(null)}
        onSnooze={setSnoozing}
      />
      <SnoozeMenu item={snoozing} actions={actions} onClose={() => setSnoozing(null)} />

      {/* Jump straight to a month. Stepping a year at a time through the arrows
          is twelve taps to reach next March, which is the one thing a calendar
          must not make expensive. */}
      <MonthPickerSheet
        open={jumping}
        onClose={() => setJumping(false)}
        value={selectedISO}
        onPick={(iso) => {
          const { y, m, d } = partsOf(iso)
          setView({ year: y, month: m })
          setSelected(d)
          setJumping(false)
        }}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  monthHead: { flexDirection: 'row', alignItems: 'center', gap: space[1], marginBottom: space[2] },
  todayButton: {
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: space[3],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
  },
  weekdays: { flexDirection: 'row', marginBottom: space[1] },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, padding: 1.5 },
  dayCell: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    padding: 4,
    gap: 3,
  },
  dayCellTall: { minHeight: 58 },
  dayNumber: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 2, flexWrap: 'wrap' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  key: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[4],
    marginTop: space[3],
    paddingTop: space[3],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  keyRow: { flexDirection: 'row', alignItems: 'center', gap: space[1.5] },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[2],
    paddingVertical: space[2],
  },
  restRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: space[2] },
})
