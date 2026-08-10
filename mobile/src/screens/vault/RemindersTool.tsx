import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { ItemMenu, SnoozeMenu } from '@/components/common/ItemMenus'
import { LabelChips } from '@/components/common/Labels'
import { BucketFilter } from '@/components/ui/BucketFilter'
import { Button, IconButton } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { SearchInput } from '@/components/ui/SearchInput'
import { Divider, Panel } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { displayName } from '@/data/seed'
import { TODAY, bucketOf, shortDate, whenLabel } from '@/data/timeline'
import type { TimelineBucket, TimelineItem } from '@/data/timeline'
import { useLabels } from '@/lib/labels-context'
import { matchesQuery } from '@/lib/search'
import { useSheets } from '@/lib/sheets-context'
import { useApplications, useTimeline } from '@/lib/store-context'
import { KIND_ICON, KIND_LABEL } from '@/lib/timeline-visuals'
import { useItemActions } from '@/lib/use-item-actions'
import type { RootStackParamList } from '@/navigation/types'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

const BUCKETS: TimelineBucket[] = ['overdue', 'today', 'upcoming', 'done']

const BUCKET_LABEL: Record<TimelineBucket, string> = {
  overdue: 'Overdue',
  today: 'Today',
  upcoming: 'Upcoming',
  done: 'Completed',
}

const BUCKET_TONE = {
  overdue: 'danger',
  today: 'warning',
  upcoming: 'muted',
  done: 'muted',
} as const

/**
 * The reminders list.
 *
 * Every write goes through `useItemActions`, which is the same hook Today's
 * week list and the Calendar's day list use — so a row behaves identically
 * whichever of the three you are looking at, and an undo puts the keywords back
 * wherever it is pressed.
 */
export function RemindersTool({ focus }: { focus?: string }) {
  const c = useColors()
  const { reminders } = useTimeline()
  const { byId } = useApplications()
  const { matches } = useLabels()
  const { open } = useSheets()
  const actions = useItemActions()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()

  const [bucket, setBucket] = useState<TimelineBucket | 'all'>('all')
  const [query, setQuery] = useState('')
  const [menuFor, setMenuFor] = useState<TimelineItem | null>(null)
  const [snoozing, setSnoozing] = useState<TimelineItem | null>(null)

  const pool = useMemo(
    () =>
      reminders.filter(
        (r) => matches(r.id) && matchesQuery(query, r.title, r.detail, r.note, KIND_LABEL[r.kind]),
      ),
    [reminders, query, matches],
  )

  const counts = useMemo(() => {
    const map: Partial<Record<TimelineBucket, number>> = {}
    for (const r of pool) {
      const b = bucketOf(r, TODAY)
      map[b] = (map[b] ?? 0) + 1
    }
    return map
  }, [pool])

  const rows = bucket === 'all' ? pool : pool.filter((r) => bucketOf(r, TODAY) === bucket)

  return (
    <>
      <SearchInput
        label="Search reminders"
        value={query}
        onChange={setQuery}
        placeholder="Search title, note or kind"
      />
      <BucketFilter
        label="Filter reminders"
        options={BUCKETS}
        labels={BUCKET_LABEL}
        counts={counts}
        value={bucket}
        onChange={setBucket}
        total={pool.length}
      />
      <Button
        label="New reminder"
        icon="plus"
        onPress={() => open('timelineItem', { mode: 'reminder' })}
      />

      <Panel padded={false}>
        {rows.length === 0 ? (
          <View style={{ padding: space[4] }}>
            <EmptyState
              icon="bell"
              title={reminders.length === 0 ? 'No reminders yet' : 'Nothing in this bucket'}
              description={
                reminders.length === 0
                  ? 'A reminder is a dated record with a nudge switched on. Once its date passes it is owed, and it stays on Today until you tick it off.'
                  : 'Try another bucket, or clear the search.'
              }
              action={
                <Button
                  label="New reminder"
                  icon="plus"
                  onPress={() => open('timelineItem', { mode: 'reminder' })}
                />
              }
            />
          </View>
        ) : (
          rows.map((r, i) => {
            const b = bucketOf(r, TODAY)
            const done = Boolean(r.completedOn)
            const app = r.applicationId ? byId.get(r.applicationId) : undefined
            const when = whenLabel(r, TODAY)
            const date = shortDate(r.date)

            return (
              <View key={r.id}>
                {i > 0 ? <Divider /> : null}
                <View style={[styles.row, focus === r.id && { backgroundColor: c.accentSoft }]}>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: done }}
                    accessibilityLabel={`Mark "${r.title}" ${done ? 'not done' : 'done'}`}
                    onPress={() => actions.complete(r)}
                    hitSlop={8}
                    style={[
                      styles.checkbox,
                      {
                        borderColor: done ? c.accent : c.hairlineStrong,
                        backgroundColor: done ? c.accent : 'transparent',
                      },
                    ]}
                  >
                    {done ? <Feather name="check" size={13} color={c.accentFg} /> : null}
                  </Pressable>

                  <Feather
                    name={KIND_ICON[r.kind]}
                    size={15}
                    color={c.text3}
                    style={{ marginTop: 3 }}
                  />

                  {/* The date reads under the title rather than in a column
                      beside it. A right-hand column is content-sized and never
                      shrinks, so at 393pt it left the title about 180pt — long
                      enough to wrap "Confirm application was received" onto two
                      lines and set the urgency ragged beside it. Leading the
                      meta line with the same words keeps "8 days overdue" the
                      first thing read after the title, and gives the title the
                      whole row. */}
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => actions.edit(r)}
                    style={s.fill}
                  >
                    <Txt
                      size="sm"
                      tone={done ? 'muted' : 'primary'}
                      style={done ? s.struck : undefined}
                    >
                      {r.title}
                    </Txt>
                    <Txt size="xs" tone="muted" numberOfLines={1}>
                      <Txt size="xs" weight="medium" tone={BUCKET_TONE[b]}>
                        {when}
                      </Txt>
                      {/* The date only earns its place when the label is
                          relative. Past the two-week cut-off `agoLabel` returns
                          a plain date, so a row ticked off on its due day read
                          "Completed Sep 28 · Sep 28". */}
                      {when.includes(date) ? '' : ` · ${date}`}
                      {r.detail || r.note ? ` · ${r.detail ?? r.note}` : ''}
                    </Txt>
                    {app ? (
                      <Pressable
                        accessibilityRole="link"
                        onPress={() => navigation.navigate('ApplicationDetail', { id: app.id })}
                      >
                        <Txt size="xs" tone="info" numberOfLines={1}>
                          {displayName(app)}
                        </Txt>
                      </Pressable>
                    ) : null}
                    <LabelChips recordId={r.id} />
                  </Pressable>

                  <IconButton
                    icon="more-horizontal"
                    label={`More actions for ${r.title}`}
                    onPress={() => setMenuFor(r)}
                  />
                </View>
              </View>
            )
          })
        )}
      </Panel>

      <ItemMenu
        item={menuFor}
        actions={actions}
        onClose={() => setMenuFor(null)}
        onSnooze={setSnoozing}
      />
      <SnoozeMenu item={snoozing} actions={actions} onClose={() => setSnoozing(null)} />
    </>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[2],
    paddingVertical: space[3],
    paddingLeft: space[4],
    paddingRight: space[2],
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
})
