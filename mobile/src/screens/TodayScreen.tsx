import { useEffect, useMemo, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Feather } from '@react-native-vector-icons/feather/static'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Pie } from '@/components/charts/Charts'
import { ItemMenu, SnoozeMenu } from '@/components/common/ItemMenus'
import { Button, IconButton } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { Columns, Screen } from '@/components/ui/Screen'
import { OfferComparison } from '@/components/dashboard/OfferComparison'
import { Divider, Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { MONTH_LABELS } from '@jojo/service/core/calendar'
import { STAGE_LABEL, displayName } from '@jojo/service/data/seed'
import type { Stage } from '@jojo/service/data/seed'
import { addDays, partsOf, shortDate, timeLabel, whenLabel } from '@jojo/service/data/timeline'
import type { TimelineItem } from '@jojo/service/data/timeline'
import { TODAY } from '@/lib/today'
import { markColor, markOfDate, markTone } from '@/lib/marks'
import { usePriorityActions } from '@/lib/priority'
import type { PriorityAction, PriorityUrgency } from '@/lib/priority'
import { markDismissed, readDismissed, showFirstSteps } from '@/lib/first-steps'
import { useSheets } from '@/lib/sheets-context'
import { useApplications, useTimeline } from '@/lib/store-context'
import { KIND_ICON } from '@/lib/timeline-visuals'
import { useItemActions } from '@/lib/use-item-actions'
import type { RootStackParamList } from '@/navigation/types'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { radius, space } from '@/theme/tokens'

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * "Monday 12 October", computed once from the seed's pinned today.
 *
 * Spelled out in full here and nowhere else — every other surface uses
 * `shortDate`. Naming the weekday is the point of this header: it is the one
 * screen whose subject is the day itself.
 */
/*
 * FUNCTIONS, not module-scope constants, because `TODAY` is a live binding.
 *
 * It used to be frozen at import, which was wrong for a React Native process
 * that keeps one JS context for days — the week strip and the "done today" tile
 * measured against a stale day while the agent path read the real one. `today.ts`
 * moves it now.
 *
 * Deriving from it ONCE at import is the same bug wearing the opposite face:
 * the live reads below advance at midnight and these would not, so the header
 * would name yesterday over a week strip that had moved on. Half a screen
 * advancing is worse than none of it, because nothing on it looks wrong.
 */
const todayLabel = (): string => {
  const { y, m, d } = partsOf(TODAY)
  return `${WEEKDAY_NAMES[new Date(y, m - 1, d).getDay()]} ${d} ${MONTH_LABELS[m - 1]}`
}

const tomorrow = (): string => addDays(TODAY, 1)
const weekEnd = (): string => addDays(TODAY, 6)
const LATER_SHOWN = 4

export function TodayScreen() {
  const { all } = useApplications()

  const subtitle =
    all.length === 0
      ? `${todayLabel()} · nothing tracked yet — everything you add stays on this device.`
      : `${todayLabel()} · ${all.length} application${all.length === 1 ? '' : 's'}, all on this device.`

  return (
    <Screen title="Today" subtitle={subtitle}>
      {/* Five independent panels with no reading order between them, which is
          what makes this screen safe to cut into two columns on a tablet. The
          order still holds down each column: the two things you act on first
          — what needs a decision, then what is owed this week — stay on the
          left, where the eye lands. */}
      <Columns>
        <PriorityActions />
        {/* Renders nothing below two offers. See the panel's own header. */}
        <OfferComparison />
        <GlancePanel />
        <OwedThisWeek />
        <RecentApplications />
        <PipelineBreakdown />
      </Columns>
    </Screen>
  )
}

/* ---------------------------- needs a decision ---------------------------- */

/**
 * Done and Snooze for a card that has a dated item behind it.
 *
 * Both write straight to the timeline, so the card recomputes and usually
 * leaves the deck — which is why each raises an undo. A card whose item is
 * missing (an offer, which is a decision rather than an appointment) renders
 * neither, rather than showing two controls with nothing to write to.
 */
function ItemControls({ itemId }: { itemId: string }) {
  const actions = useItemActions()
  const [snoozing, setSnoozing] = useState<TimelineItem | null>(null)
  const item = actions.get(itemId)
  if (!item) return null

  return (
    <>
      <Button label="Done" icon="check" variant="ghost" onPress={() => actions.complete(item)} />
      <Button label="Snooze" icon="clock" variant="ghost" onPress={() => setSnoozing(item)} />
      <SnoozeMenu item={snoozing} actions={actions} onClose={() => setSnoozing(null)} />
    </>
  )
}

function ActionButton({ action }: { action: PriorityAction['actions'][number] }) {
  const { open } = useSheets()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()

  // `to` is whatever `lib/priority.ts` handed the shared hook as a destination,
  // which on a phone is the record's id rather than the web's route string.
  const to = action.to
  if (to) {
    return (
      <Button
        label={action.label}
        variant={action.primary ? 'default' : 'ghost'}
        onPress={() => navigation.navigate('ApplicationDetail', { id: to })}
      />
    )
  }

  return (
    <Button
      label={action.label}
      variant={action.primary ? 'default' : 'ghost'}
      // An action is a destination, a sheet, or a stated blocker. Anything added
      // without one of the first two says why rather than swallowing the tap.
      blocker={action.blocker ?? (action.draft ? undefined : 'Nothing is connected to this yet')}
      onPress={action.draft ? () => open('draft', action.draft) : undefined}
    />
  )
}

/**
 * The first card, at full size.
 *
 * The headline is the instruction ("Reply to Baylor"), the date is stated once
 * at the smallest step, and the thing that moves the decision along is the
 * filled button. The web version once made a 28px countdown the loudest element
 * on the screen and the primary action a ghost.
 */
function DecisionCard({ action, hero }: { action: PriorityAction; hero?: boolean }) {
  const c = useColors()
  const border: Record<PriorityUrgency, string> = {
    overdue: c.dangerBorder,
    soon: c.warningBorder,
    none: c.hairline,
  }
  const tone: Record<PriorityUrgency, 'danger' | 'warning' | 'muted'> = {
    overdue: 'danger',
    soon: 'warning',
    none: 'muted',
  }

  return (
    <View style={[styles.decision, { borderColor: border[action.urgency] }]}>
      <Chip tone="gray" size="sm">
        {action.kindLabel}
      </Chip>
      <Txt size={hero ? 'xl' : 'md'} weight="semibold" style={{ marginTop: space[2] }}>
        {action.headline}
      </Txt>
      <Txt size="sm" tone="secondary" numberOfLines={2} style={{ marginTop: space[1] }}>
        {action.context}
      </Txt>
      <Txt size="xs" tone={tone[action.urgency]} style={{ marginTop: space[1.5] }}>
        {action.timing}
      </Txt>

      <View style={styles.decisionActions}>
        {action.actions.map((a) => (
          <ActionButton key={a.label} action={a} />
        ))}
        {/* Done and Snooze come last: they end the card, and putting them first
            would put "dismiss this" ahead of "deal with it". */}
        {action.itemId ? <ItemControls itemId={action.itemId} /> : null}
      </View>
    </View>
  )
}

/**
 * The three conditions the checklist reads, lifted out so the gate that keeps
 * it on screen and the checklist itself cannot disagree about what "done" means.
 */
function useFirstStepsProgress() {
  const { all } = useApplications()
  const { all: items, reminders } = useTimeline()

  return useMemo(
    () => ({
      application: all.length > 0,
      // A dated record that is not a reminder — step 3 owns the reminders.
      dated: items.some((i) => !i.remind),
      reminder: reminders.length > 0,
    }),
    [all, items, reminders],
  )
}

function PriorityActions() {
  const c = useColors()
  const actions = usePriorityActions()
  const progress = useFirstStepsProgress()
  const { open } = useSheets()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()

  /**
   * Shown until it is FINISHED or DISMISSED — `lib/first-steps.ts` holds that
   * rule, so it has a test and this screen has none.
   *
   * It latched on `bare` (nothing added at all) in component state, and that
   * failed at both ends: somebody who added an application and reopened the app
   * came back with the checklist gone and two steps never done, and somebody
   * who pressed "hide these steps" got it back on the next launch. The original
   * reason for the latch stands and is now the rule's job — the panel's own
   * "New application" button completes step 1, and re-deriving from an empty
   * store would have closed the panel out from under steps 2 and 3.
   */
  const [dismissed, setDismissed] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    void readDismissed().then((value) => {
      if (live) setDismissed(value)
    })
    return () => {
      live = false
    }
  }, [])

  const checklistOpen = showFirstSteps(progress, dismissed)
  const hideChecklist = () => {
    markDismissed()
    setDismissed(true)
  }

  if (checklistOpen) {
    const steps = [
      {
        id: 'application',
        title: 'Add an application',
        body: 'A position, its stage and its deadline. Everything else in jojo hangs off this record.',
        done: progress.application,
        label: 'New application',
        onPress: () => open('application'),
      },
      {
        id: 'dated',
        title: 'Give something a date',
        body: 'Deadlines, interviews and visits are one kind of record, so a date reaches this screen, the calendar and the application at once.',
        done: progress.dated,
        label: 'New event',
        onPress: () => open('timelineItem', { mode: 'event', initial: { date: TODAY } }),
      },
      {
        id: 'reminder',
        title: 'Set a follow-up',
        body: 'A reminder is the same record with a nudge switched on. Once its date passes it is owed, and it stays here until you tick it off.',
        done: progress.reminder,
        label: 'New reminder',
        onPress: () => open('timelineItem', { mode: 'reminder' }),
      },
    ]
    const done = steps.filter((s) => s.done).length
    const complete = done === steps.length

    return (
      <Panel>
        <PanelTitle hint={`${done} of ${steps.length} done`}>First steps</PanelTitle>
        <Txt size="sm" tone="secondary" style={{ marginBottom: space[3] }}>
          {complete
            ? 'All three are done. Anything you add from here reaches this screen, the calendar and the application it belongs to.'
            : `${done === 0 ? 'Nothing is tracked yet. ' : ''}Each step opens the real thing and ticks itself once a record exists — none of it is a tutorial you have to sit through.`}
        </Txt>

        {steps.map((step, i) => (
          <View key={step.id} style={styles.step}>
            {i > 0 ? <Divider style={{ marginBottom: space[3] }} /> : null}
            <View style={styles.stepRow}>
              <View
                style={[
                  styles.stepBadge,
                  {
                    backgroundColor: step.done ? c.successSoft : c.accentSoft,
                    borderColor: step.done ? c.successBorder : c.accentBorder,
                  },
                ]}
              >
                {step.done ? (
                  <Feather name="check" size={13} color={c.success} />
                ) : (
                  <Txt size="xs" weight="semibold" tone="accent">
                    {i + 1}
                  </Txt>
                )}
              </View>
              <View style={s.fill}>
                <Txt size="base" weight="medium">
                  {step.title}
                </Txt>
                <Txt size="sm" tone="secondary" style={{ marginTop: space[1] }}>
                  {step.body}
                </Txt>
                <Button
                  label={step.label}
                  variant="outline"
                  onPress={step.onPress}
                  style={{ marginTop: space[2], alignSelf: 'flex-start' }}
                />
              </View>
            </View>
          </View>
        ))}

        {/* The way out, at either end of the journey. Without it the panel is a
            modal you cannot close. */}
        <Button
          label={complete ? 'Close first steps' : 'Hide these steps'}
          variant={complete ? 'outline' : 'ghost'}
          onPress={hideChecklist}
          style={{ marginTop: space[4], alignSelf: 'flex-end' }}
        />
      </Panel>
    )
  }

  // Clearing the deck with records still in the store is an achievement, and it
  // is reachable now that items can be ticked off and applications deleted.
  if (actions.length === 0) {
    return (
      <Panel>
        <PanelTitle>Needs a decision</PanelTitle>
        <EmptyState
          icon="check-circle"
          title="Nothing needs deciding today"
          description="Offers, the next hard deadline and your next interview surface here. None of them is outstanding."
          action={
            <Button
              label="Open applications"
              variant="outline"
              onPress={() => navigation.navigate('Tabs', { screen: 'Applications' })}
            />
          }
        />
      </Panel>
    )
  }

  const [first, ...rest] = actions

  return (
    <Panel>
      <PanelTitle hint={actions.length === 1 ? '1 open' : `${actions.length} open`}>
        Needs a decision
      </PanelTitle>
      <View style={{ gap: space[2.5] }}>
        <DecisionCard action={first} hero />
        {rest.map((a) => (
          <DecisionCard key={a.id} action={a} />
        ))}
      </View>
    </Panel>
  )
}

/* -------------------------------- glance --------------------------------- */

/**
 * Counters, derived rather than written down — and every one a link, because a
 * number you cannot act on is trivia.
 *
 * "Applications" is deliberately absent: the total was the least useful of the
 * four (the pipeline panel below already breaks it down) and it has been swapped
 * for *Done today*, the only counter here that goes up as you work.
 */
function GlancePanel() {
  const { all, stageCounts } = useApplications()
  const { all: items, overdue } = useTimeline()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()

  const countOf = (id: string) => stageCounts.find((s) => s.id === id)?.count ?? 0
  const oldestOverdue = overdue[0]

  const stats = [
    {
      label: 'Active',
      value: String(all.length - countOf('closed')),
      onPress: () => navigation.navigate('Tabs', { screen: 'Applications' }),
    },
    {
      label: 'Screens & interviews',
      value: String(countOf('screen') + countOf('interview')),
      // The honest destination, not the exact one: no filter selects two stages
      // at once, so this opens the list sorted by stage, where they sit together.
      onPress: () =>
        navigation.navigate('Tabs', { screen: 'Applications', params: { sort: 'stage' } }),
    },
    {
      label: 'Overdue',
      value: String(overdue.length),
      alert: overdue.length > 0,
      onPress: () =>
        navigation.navigate('Tabs', {
          screen: 'Calendar',
          params: oldestOverdue ? { date: oldestOverdue.date } : undefined,
        }),
    },
    {
      label: 'Done today',
      value: String(items.filter((i) => i.completedOn === TODAY).length),
      onPress: () =>
        navigation.navigate('Tabs', { screen: 'Vault', params: { tool: 'reminders' } }),
    },
  ]

  return (
    <Panel>
      <View style={styles.glanceGrid}>
        {stats.map((s) => (
          <Pressable
            key={s.label}
            accessibilityRole="button"
            accessibilityLabel={`${s.value} ${s.label}`}
            onPress={s.onPress}
            style={styles.glanceCell}
          >
            <Txt size="xl" weight="semibold" tone={s.alert ? 'danger' : 'primary'}>
              {s.value}
            </Txt>
            <Txt size="xs" tone="secondary" numberOfLines={2}>
              {s.label}
            </Txt>
          </Pressable>
        ))}
      </View>
    </Panel>
  )
}

/* ----------------------------- owed this week ---------------------------- */

/**
 * Everything you owe, overdue first, in one panel.
 *
 * It was two: "This week", which started at today and so could not show a
 * single overdue thing, and "Follow-ups due", which showed the overdue chases
 * and nothing else. Groups are computed from the date on every render, so
 * ticking, snoozing or rescheduling anywhere in the app moves a row between
 * them on its own.
 */
function OwedThisWeek() {
  const c = useColors()
  const { all } = useTimeline()
  const { open } = useSheets()
  const actions = useItemActions()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [menuFor, setMenuFor] = useState<TimelineItem | null>(null)
  const [snoozing, setSnoozing] = useState<TimelineItem | null>(null)

  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const iso = addDays(TODAY, i)
        const { y, m, d } = partsOf(iso)
        return { iso, day: d, label: WEEKDAY_SHORT[new Date(y, m - 1, d).getDay()] }
      }),
    [],
  )

  const { groups, later, doneToday, overdueCount, dueCount } = useMemo(() => {
    const openItems = all.filter((i) => !i.completedOn)
    const overdue = openItems.filter((i) => i.date < TODAY)
    const today = openItems.filter((i) => i.date === TODAY)
    const nextDay = tomorrow()
    const endOfWeek = weekEnd()
    const tomorrowItems = openItems.filter((i) => i.date === nextDay)
    const rest = openItems.filter((i) => i.date > nextDay && i.date <= endOfWeek)

    return {
      groups: [
        { id: 'overdue', label: 'Overdue', items: overdue },
        { id: 'today', label: 'Today', items: today },
        { id: 'tomorrow', label: 'Tomorrow', items: tomorrowItems },
        { id: 'rest', label: 'Rest of the week', items: rest },
      ],
      later: openItems.filter((i) => i.date > endOfWeek),
      doneToday: all.filter((i) => i.completedOn === TODAY).length,
      overdueCount: overdue.length,
      dueCount: today.length + tomorrow.length + rest.length,
    }
  }, [all])

  const newEvent = () => open('timelineItem', { mode: 'event', initial: { date: TODAY } })

  const hint = overdueCount > 0 ? `${overdueCount} overdue · ${dueCount} due` : `${dueCount} due`

  return (
    <Panel>
      <PanelTitle
        hint={all.length > 0 ? hint : undefined}
        right={<Button label="Add" icon="plus" variant="outline" onPress={newEvent} />}
      >
        Owed this week
      </PanelTitle>

      {all.length === 0 ? (
        <EmptyState
          icon="calendar"
          title="Nothing is owed"
          description="Deadlines, interviews and follow-ups land here as soon as they have a date, and stay until you tick them off."
          action={<Button label="Add an event" icon="plus" onPress={newEvent} />}
        />
      ) : (
        <>
          {/* Day strip: the shape of the week before reading any detail. */}
          <View style={styles.weekStrip}>
            {days.map((day, i) => {
              const events = all.filter((e) => !e.completedOn && e.date === day.iso)
              const isToday = i === 0
              return (
                <Pressable
                  key={day.iso}
                  accessibilityRole="button"
                  accessibilityLabel={`${day.label} ${day.day}, ${events.length} items`}
                  onPress={() =>
                    navigation.navigate('Tabs', {
                      screen: 'Calendar',
                      params: { date: day.iso },
                    })
                  }
                  style={[
                    styles.weekCell,
                    {
                      backgroundColor: isToday ? c.accentSoft : c.well,
                      borderColor: isToday ? c.accentBorder : c.hairline,
                    },
                  ]}
                >
                  <Txt size="xs" tone={isToday ? 'accent' : 'muted'} uppercase>
                    {day.label}
                  </Txt>
                  <Txt size="md" weight="semibold" tone={isToday ? 'accent' : 'secondary'}>
                    {day.day}
                  </Txt>
                  <View style={styles.weekDots}>
                    {events.slice(0, 3).map((e) => (
                      <View
                        key={e.id}
                        style={[
                          styles.miniDot,
                          { backgroundColor: markColor(markOfDate(e.date), c) },
                        ]}
                      />
                    ))}
                  </View>
                </Pressable>
              )
            })}
          </View>

          {groups.map((group) => {
            // Today is the only group that renders empty. It is the question the
            // screen exists to answer, and "clear" is an answer.
            if (group.items.length === 0 && group.id !== 'today') return null

            return (
              <View key={group.id} style={{ marginTop: space[3] }}>
                <View style={styles.groupHead}>
                  <Txt size="xs" tone="muted" uppercase>
                    {group.label}
                  </Txt>
                  {group.items.length > 0 ? (
                    <Txt size="xs" tone="muted" mono>
                      {group.items.length}
                    </Txt>
                  ) : null}
                </View>

                {group.items.length === 0 ? (
                  <Txt size="sm" tone="secondary">
                    Today is clear{doneToday > 0 ? ` — ${doneToday} done` : ''}.
                  </Txt>
                ) : (
                  group.items.map((e, i) => (
                    <View key={e.id}>
                      {i > 0 ? <Divider /> : null}
                      <View style={styles.owedRow}>
                        {/* A real checkbox role, so the state is announced. It
                            sits before the icon rather than replacing it — the
                            kind is what tells you whether ticking it off is a
                            two-minute job or a submitted application. */}
                        <Pressable
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: false }}
                          accessibilityLabel={`Mark "${e.title}" done`}
                          onPress={() => actions.complete(e)}
                          hitSlop={8}
                          style={[styles.checkbox, { borderColor: c.hairlineStrong }]}
                        />
                        <Feather
                          name={KIND_ICON[e.kind]}
                          size={15}
                          color={markColor(markOfDate(e.date), c)}
                          style={{ marginTop: 3 }}
                        />
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => actions.edit(e)}
                          style={s.fill}
                        >
                          <Txt size="sm" numberOfLines={1}>
                            {e.title}
                          </Txt>
                          <Txt size="xs" tone="muted" numberOfLines={1}>
                            {timeLabel(e) ? `${timeLabel(e)} · ` : ''}
                            {e.detail ?? e.note ?? ''}
                          </Txt>
                        </Pressable>
                        <Txt
                          size="xs"
                          weight="medium"
                          tone={markTone[markOfDate(e.date)]}
                          style={styles.owedWhen}
                        >
                          {whenLabel(e, TODAY)}
                        </Txt>
                        {/* One overflow rather than a row of icons. Edit,
                            duplicate, draft, reschedule and delete all live
                            behind it, in the order every list in the app uses —
                            and a delete that costs a menu is the point. */}
                        <IconButton
                          icon="more-horizontal"
                          size={34}
                          label={`More actions for ${e.title}`}
                          onPress={() => setMenuFor(e)}
                        />
                      </View>
                    </View>
                  ))
                )}
              </View>
            )
          })}

          {later.length > 0 ? (
            <View style={{ marginTop: space[4] }}>
              <Divider style={{ marginBottom: space[3] }} />
              <Txt size="xs" tone="muted" uppercase style={{ marginBottom: space[2] }}>
                Later
              </Txt>
              <View style={styles.laterRow}>
                {later.slice(0, LATER_SHOWN).map((e) => (
                  <Pressable key={e.id} accessibilityRole="button" onPress={() => actions.edit(e)}>
                    <Chip tone="gray">{`${e.title} · ${shortDate(e.date)}`}</Chip>
                  </Pressable>
                ))}
                {later.length > LATER_SHOWN ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      navigation.navigate('Tabs', {
                        screen: 'Calendar',
                        params: { date: later[LATER_SHOWN].date },
                      })
                    }
                  >
                    <Chip tone="gray">{`${later.length - LATER_SHOWN} more on the calendar`}</Chip>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ) : null}
        </>
      )}

      <ItemMenu
        item={menuFor}
        actions={actions}
        onClose={() => setMenuFor(null)}
        onSnooze={setSnoozing}
      />
      <SnoozeMenu item={snoozing} actions={actions} onClose={() => setSnoozing(null)} />
    </Panel>
  )
}

/* --------------------------- recent applications ------------------------- */

// Five, not six. This panel exists to show the *latest* activity and links to
// the full list anyway.
const HOW_MANY = 5

function RecentApplications() {
  const { recent } = useApplications()
  const { open } = useSheets()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const shown = recent.slice(0, HOW_MANY)

  return (
    <Panel>
      <PanelTitle
        hint="latest activity"
        right={
          <Button
            label="View all"
            variant="ghost"
            onPress={() => navigation.navigate('Tabs', { screen: 'Applications' })}
          />
        }
      >
        Recent applications
      </PanelTitle>

      {shown.length === 0 ? (
        <EmptyState
          icon="clipboard"
          title="No applications yet"
          description="Every position you track shows up here as you touch it, newest first."
          action={
            <Button label="New application" icon="plus" onPress={() => open('application')} />
          }
        />
      ) : (
        shown.map((a, i) => (
          <View key={a.id}>
            {i > 0 ? <Divider /> : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => navigation.navigate('ApplicationDetail', { id: a.id })}
              style={styles.recentRow}
            >
              {/* Stacked, not side by side.
                  Chips are sized to their content and never shrink, so sharing
                  a row with them left "Texas Tech ..." and "UH — Assistant ..."
                  at 393pt — cutting the one thing that identifies the record.
                  Letting them wrap was worse: they wrap individually, so one
                  chip stayed up beside the truncated name and the other dropped
                  below it. A full-width name with its chips underneath is the
                  same shape the Applications list already uses. */}
              <View style={s.fill}>
                <Txt size="base" numberOfLines={1}>
                  {displayName(a)}
                </Txt>
                <Txt size="xs" tone="muted" numberOfLines={1}>
                  {a.lastAction} ·{' '}
                  {a.daysAgo === 0 ? 'Today' : `${a.daysAgo} day${a.daysAgo === 1 ? '' : 's'} ago`}
                </Txt>
              </View>
              <View style={[s.chipRow, styles.recentChips]}>
                {/* Neutral. The role is not a status, and a coloured pill beside
                    a stage chip read as though it were one. */}
                <Chip tone="gray" size="sm">
                  {a.roleTag}
                </Chip>
                <Chip stage={a.stage} size="sm">
                  {STAGE_LABEL[a.stage]}
                </Chip>
              </View>
            </Pressable>
          </View>
        ))
      )}
    </Panel>
  )
}

/* --------------------------- pipeline breakdown -------------------------- */

/**
 * Where everything currently sits.
 *
 * Totals say how much you have done; this says whether it is progressing or
 * piling up in one stage. Read top to bottom, which is the order applications
 * actually move through.
 */
/**
 * Where everything currently sits. The single most informative thing a job
 * dashboard can show: totals say how much you have done, this says whether it
 * is progressing or piling up in one stage.
 *
 * A pie, because the question is share-of-total — "is half of this still in
 * draft?" — and a pie answers it in a glance where six bars ask you to compare
 * lengths and add up. The same chart, from the same geometry, as the web card.
 *
 * Colour is read here rather than upstream: `stageCounts` deliberately carries
 * none, because it is minted in the shared React layer and a palette lookup is
 * this platform's business.
 */
function PipelineBreakdown() {
  const c = useColors()
  const { all, stageCounts } = useApplications()
  const { open } = useSheets()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()

  return (
    <Panel>
      <PanelTitle hint={`${all.length} tracked`}>Pipeline</PanelTitle>

      {/* `stageCounts` always returns all six stages, so on an empty store this
          rendered six labelled rows of zero — technically true and useless. */}
      {all.length === 0 ? (
        <EmptyState
          icon="clipboard"
          title="Nothing in the pipeline"
          description="Each application sits in one stage, and this shows how they are spread across them. Add one and the first slice appears."
          action={
            <Button label="New application" icon="plus" onPress={() => open('application')} />
          }
        />
      ) : (
        <Pie
          data={stageCounts.map((stage) => ({
            key: stage.id,
            label: stage.label,
            value: stage.count,
            color: c.stage[stage.id],
          }))}
          onSelect={(key) =>
            navigation.navigate('Tabs', {
              screen: 'Applications',
              params: { stage: key as Stage },
            })
          }
        />
      )}
    </Panel>
  )
}

const styles = StyleSheet.create({
  decision: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space[3.5],
    paddingVertical: space[3],
  },
  decisionActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space[2],
    marginTop: space[3],
  },
  step: { marginBottom: space[3] },
  stepRow: { flexDirection: 'row', gap: space[3] },
  stepBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 2,
  },
  glanceGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  glanceCell: { width: '50%', paddingVertical: space[1.5], paddingRight: space[3] },
  weekStrip: { flexDirection: 'row', gap: space[1] },
  weekCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space[1.5],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
  },
  weekDots: { flexDirection: 'row', gap: 2, height: 6, alignItems: 'center' },
  miniDot: { width: 4, height: 4, borderRadius: 2 },
  groupHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingVertical: space[1.5],
  },
  owedRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[2.5],
    paddingVertical: space[2.5],
  },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, marginTop: 1 },
  owedWhen: { marginTop: 2, textAlign: 'right' },
  laterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  recentRow: { paddingVertical: space[2.5] },
  recentChips: { marginTop: space[1.5] },
})
