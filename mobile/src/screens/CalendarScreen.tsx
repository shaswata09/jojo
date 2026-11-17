import { useEffect, useMemo, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Feather } from '@react-native-vector-icons/feather/static'
import { useNavigation, useRoute } from '@react-navigation/native'
import type { RouteProp } from '@react-navigation/native'
import { MonthPickerSheet } from '@/components/common/DateField'
import { ItemMenu, SnoozeMenu } from '@/components/common/ItemMenus'
import { Button, IconButton } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Screen } from '@/components/ui/Screen'
import { SettingRow, Toggle } from '@/components/ui/Field'
import { Divider, Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { WEEKDAYS, buildMonth, stepMonth } from '@jojo/service/core/calendar'
import { TODAY_PARTS } from '@/lib/today'
import { compareItems, isoOf, partsOf, timeLabel } from '@jojo/service/data/timeline'
import type { TimelineItem } from '@jojo/service/data/timeline'
import { markColor, markOf } from '@/lib/marks'
import type { Mark } from '@/lib/marks'
import { exportCalendar } from '@/lib/calendar-export'
import { useSheets } from '@/lib/sheets-context'
import { useToast } from '@/lib/toast-context'
import { useApplications, useTimeline } from '@/lib/store-context'
import { KIND_ICON } from '@/lib/timeline-visuals'
import { useItemActions } from '@/lib/use-item-actions'
import type { TabParamList } from '@/navigation/types'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { radius, space } from '@/theme/tokens'
import { domain as domainWords, useDomain } from '@/i18n/domain'

/*
 * FUNCTIONS, not constants, because `TODAY_PARTS` is a live binding.
 *
 * `today.ts` replaces it when the day turns, which is what fixes a React Native
 * process that keeps one JS context for days. Everything below already reads it
 * live — `buildMonth`, `isCurrentMonth`, the jump target — so freezing these two
 * at import meant the button LABEL named one month while pressing it went to
 * another. A screen half-advanced is worse than one that has not moved, because
 * nothing on it looks wrong.
 */
const todayIso = (): string => isoOf(TODAY_PARTS.year, TODAY_PARTS.month, TODAY_PARTS.day)
const todayMonth = (): string => domainWords.monthYear(TODAY_PARTS.month, TODAY_PARTS.year)

export function CalendarScreen() {
  const { t } = useTranslation('screens')
  const domain = useDomain()
  const c = useColors()
  const route = useRoute<RouteProp<TabParamList, 'Calendar'>>()
  const { open } = useSheets()
  const { all: allItems, forMonth } = useTimeline()
  const { all: allApplications } = useApplications()
  const { toast } = useToast()
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
  // Cleared once applied, so following the same link again after paging away
  // still moves the calendar — keyed on the value, a repeat changed nothing.
  const navigation = useNavigation()
  const linkDate = route.params?.date
  useEffect(() => {
    if (!linkDate) return
    const { y, m, d } = partsOf(linkDate)
    setView({ year: y, month: m })
    setSelected(d)
    navigation.setParams({ date: undefined } as never)
  }, [linkDate, navigation])

  /*
   * `TODAY_PARTS` is passed, and its absence would be SILENT.
   *
   * The phone's deleted copy of `buildMonth` closed over a `TODAY` in the
   * fixtures and took two arguments. The shared one takes the day as an
   * optional third — optional because `kg/core` may not read a clock (D26) and
   * omitting it means "no marker" — so both call sites here compiled clean
   * against the new signature and would have quietly stopped marking today on
   * the grid. Nothing in `tsc` or the suite can say so; the marker is the test.
   */
  const month = useMemo(() => buildMonth(view.year, view.month, TODAY_PARTS), [view])
  // Not `month.label`: that is core's English, and this reads the language on screen.
  const monthName = domain.month(month.month)
  // Beside a day number: «5 ноября», not «5 ноябрь».
  const monthOfDay = domain.monthOfDay(month.month)
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
        : Math.min(day, buildMonth(next.year, next.month, TODAY_PARTS).days),
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
      { key: 'overdue', color: c.danger, label: t('calendar.key.overdue') },
      { key: 'soon', color: c.warning, label: t('calendar.key.soon') },
      { key: 'done', color: c.text3, label: t('calendar.key.done'), hollow: true },
    ] as const
  ).filter((entry) => marksPresent.has(entry.key as Mark))

  const openItem = (item: TimelineItem) =>
    open('timelineItem', { mode: item.remind ? 'reminder' : 'event', initial: item })

  const addOn = (iso: string) => open('timelineItem', { mode: 'event', initial: { date: iso } })

  /** Local alias so the JSX reads as it did; the rule itself lives in lib/marks. */
  const colorOf = (mark: Mark) => markColor(mark, c)

  return (
    <Screen
      title={t('calendar.title')}
      subtitle={t('calendar.subtitle')}
      actions={
        <>
          {/*
            The phone has no notifications of its own, so this is the only way
            one of these dates reaches somebody who is not holding the app. It
            writes the file and hands it straight to whatever opens a calendar
            here, which is the same handoff a Vault document uses.
          */}
          <IconButton
            icon="share"
            label={t('calendar.export.label')}
            onPress={() => {
              void exportCalendar({ items: allItems, applications: allApplications })
                .then((count) => {
                  toast({
                    title: t('calendar.export.done', { count }),
                    description: t('calendar.export.doneDescription'),
                  })
                })
                .catch(() => {
                  toast({
                    title: t('calendar.export.failed'),
                    description: t('calendar.export.failedDescription'),
                    tone: 'danger',
                  })
                })
            }}
          />
          <Button
            label={t('calendar.add')}
            icon="plus"
            // Prefilled with the day on screen: on a calendar, "add" almost always
            // means "add to the day I am looking at".
            onPress={() => addOn(selectedISO)}
          />
        </>
      }
      options={
        <SettingRow
          label={t('calendar.tallCells')}
          description={t('calendar.tallCellsDescription')}
          control={
            <Toggle
              value={tallCells}
              onValueChange={setTallCells}
              label={t('calendar.tallCells')}
            />
          }
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
            accessibilityLabel={t('calendar.jump', { month: monthName, year: month.year })}
            onPress={() => setJumping(true)}
            style={s.fill}
          >
            <Txt size="md" weight="medium">
              {/* Year muted wherever the language puts it ('2026年11月'). */}
              {domain.monthYearParts(month.month, month.year).map((part) =>
                part.isYear ? (
                  <Txt key="year" size="md" tone="muted">
                    {part.text}
                  </Txt>
                ) : (
                  part.text
                ),
              )}{' '}
              <Feather name="chevron-down" size={13} color={c.text3} />
            </Txt>
          </Pressable>
          <IconButton
            icon="chevron-left"
            label={t('calendar.previous')}
            onPress={() => goTo(stepMonth(view.year, view.month, -1))}
          />
          {/* A word, not a 6px dot between two arrows. Not disabled on the
              current month: from October 20 it still walks you back to October
              12, which is the more common reason to press it. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              isCurrentMonth
                ? t('calendar.backTo', { date: domain.shortDate(todayIso()) })
                : t('calendar.goTo', { target: todayMonth() })
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
              {t('calendar.today')}
            </Txt>
          </Pressable>
          <IconButton
            icon="chevron-right"
            label={t('calendar.next')}
            onPress={() => goTo(stepMonth(view.year, view.month, 1))}
          />
        </View>

        <Txt size="xs" tone="muted" style={{ marginBottom: space[2] }}>
          {t('calendar.hint')}
        </Txt>

        <View style={styles.weekdays}>
          {WEEKDAYS.map((label, i) => (
            <Txt key={label} size="xs" tone="muted" center uppercase style={styles.cell}>
              {domain.weekdayNarrow(i)}
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
                  accessibilityLabel={t('calendar.dayLabel', {
                    month: monthOfDay,
                    day,
                    count: items.length,
                  })}
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
        <PanelTitle hint={domain.shortDate(selectedISO)}>
          {selected === month.today ? t('calendar.today') : t('calendar.selectedDay')}
        </PanelTitle>

        {selectedEvents.length === 0 ? (
          <EmptyState
            compact
            icon="calendar"
            title={t('calendar.nothingOn', { date: domain.shortDate(selectedISO) })}
            description={t('calendar.nothingOnDescription')}
            action={
              <>
                <Button
                  label={t('calendar.addEvent')}
                  icon="plus"
                  onPress={() => addOn(selectedISO)}
                />
                {/* An empty day in a month you paged to is the easiest place to
                    get lost: nothing on screen names where "now" is. */}
                {isCurrentMonth ? null : (
                  <Button
                    label={t('calendar.backTo', { date: todayMonth() })}
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
                      {[
                        timeLabel(e) ?? t('calendar.allDay'),
                        done ? t('calendar.key.done') : null,
                        e.detail,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Txt>
                  </Pressable>
                  <Txt size="xs" tone="muted">
                    {domain.kind(e.kind)}
                  </Txt>
                  {/* Tick it off here too: the calendar is where you notice a
                      thing is done, and walking to the Vault to say so is the
                      trip this checkbox saves. */}
                  <IconButton
                    icon={done ? 'check-circle' : 'circle'}
                    size={34}
                    label={
                      done
                        ? t('calendar.reopen', { title: e.title })
                        : t('calendar.markDone', { title: e.title })
                    }
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
                    label={t('calendar.moreActions', { title: e.title })}
                    onPress={() => setMenuFor(e)}
                  />
                </View>
              </View>
            )
          })
        )}
      </Panel>

      <Panel>
        <PanelTitle>{t('calendar.rest.title', { month: monthName })}</PanelTitle>

        {restOfMonth.length === 0 ? (
          <EmptyState
            compact
            icon="calendar"
            title={
              isLastDay
                ? t('calendar.rest.lastDay', { date: domain.shortDate(selectedISO) })
                : t('calendar.rest.nothingAfter', { date: domain.shortDate(selectedISO) })
            }
            description={
              isLastDay
                ? t('calendar.rest.lastDayDescription', {
                    month: domain.month(nextMonth.month),
                  })
                : t('calendar.rest.clearDescription', { month: monthName })
            }
            action={
              // An "add" here has to land on a day this list would show, or
              // pressing it leaves the same empty state on screen. On the last
              // day of the month no such day exists, so the honest offer is the
              // next month rather than a new event.
              isLastDay ? (
                <Button
                  label={t('calendar.goTo', { target: domain.month(nextMonth.month) })}
                  icon="chevron-right"
                  onPress={() => goTo(nextMonth)}
                />
              ) : (
                <Button
                  label={t('calendar.addEvent')}
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
                accessibilityLabel={t('calendar.goToDay', { month: monthOfDay, day })}
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
                  {domain.dayMonth(month.month, day)}
                </Txt>
              </Pressable>
            )
          })
        )}
        {restOfMonth.length > 6 ? (
          <Txt size="xs" tone="muted" style={{ marginTop: space[2] }}>
            {t('calendar.rest.more', { count: restOfMonth.length - 6 })}
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
