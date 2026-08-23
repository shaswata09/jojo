import { Pressable, StyleSheet, View } from 'react-native'
import type { PersistenceHealth } from '@jojo/service/repo/repository'
import { useStoreStatus } from '@jojo/service/react/status-context'
import { TODAY } from '@/lib/today'
import { Feather } from '@react-native-vector-icons/feather/static'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { StatusDot } from '@/components/ui/Chip'
import { Columns, Screen } from '@/components/ui/Screen'
import { Divider, Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { bucketOf } from '@jojo/service/data/timeline'
import { useScout, useTimeline } from '@/lib/store-context'
import type { FeatherName } from '@/lib/timeline-visuals'
import type { RootStackParamList } from '@/navigation/types'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { radius, space } from '@/theme/tokens'

type Entry = {
  screen: keyof RootStackParamList
  label: string
  hint: string
  icon: FeatherName
  badge?: string
}

/**
 * Everything the tab bar has no room for.
 *
 * Five tabs is the ceiling on a phone, and the four that earned a place are the
 * ones a job search touches daily. This is not an overflow drawer of leftovers:
 * it is grouped the way the web sidebar groups its own — the workflow tools the
 * tab bar could not hold, then the account and support pages, which every
 * design system treats as a different class.
 */
/** Green while the queue is keeping up; amber the moment it is not. */
const storageStatus = (health: PersistenceHealth): 'on' | 'warn' =>
  health.state === 'idle' || health.state === 'writing' ? 'on' : 'warn'

/** The write queue's state, in the panel's own vocabulary. */
function storageMeta(health: PersistenceHealth): string {
  switch (health.state) {
    case 'idle':
      return 'saved'
    case 'writing':
      return health.pending > 0 ? `saving ${String(health.pending)}` : 'saving'
    case 'degraded':
      return `${String(health.unsaved)} unsaved`
    case 'off':
      return 'not saving'
  }
}

export function MoreScreen() {
  const { health } = useStoreStatus()
  const c = useColors()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const { reminders } = useTimeline()
  const { matches } = useScout()

  // A match nobody has turned into an application yet — the only ones there is
  // anything left to do about. Every badge in this app counts something visible
  // on the screen it points at, so following it answers the question it raises.
  const fresh = matches.filter((m) => !m.applicationId).length
  const overdue = reminders.filter((r) => !r.completedOn && bucketOf(r, TODAY) === 'overdue').length

  const workflow: Entry[] = [
    {
      screen: 'JobScout',
      label: 'Job scout',
      hint: 'Saved searches, matches and postings you parked',
      icon: 'radio',
      badge: fresh > 0 ? `${fresh} new` : undefined,
    },
    {
      screen: 'Statistics',
      label: 'Statistics',
      hint: 'Rates, a funnel and what to work on next',
      icon: 'bar-chart-2',
    },
    {
      screen: 'Graph',
      label: 'Graph',
      hint: 'Your records drawn as the network they are',
      icon: 'share-2',
    },
    {
      screen: 'Transfer',
      label: 'Transfer',
      hint: 'Move everything to another device',
      icon: 'smartphone',
    },
  ]

  const account: Entry[] = [
    {
      screen: 'Profile',
      label: 'My profile',
      hint: 'Basics, documents and match terms',
      icon: 'user',
    },
    {
      screen: 'Assistant',
      label: 'Assistant',
      hint: 'Worked examples until a local model is connected',
      icon: 'message-square',
    },
    {
      screen: 'Settings',
      label: 'Settings',
      hint: 'Connections, appearance and your data',
      icon: 'settings',
    },
    {
      screen: 'Guide',
      label: 'How to use',
      hint: 'The three layers, and a checklist',
      icon: 'help-circle',
    },
  ]

  const Row = ({ entry }: { entry: Entry }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={entry.badge ? `${entry.label}, ${entry.badge}` : entry.label}
      onPress={() => navigation.navigate(entry.screen as never)}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: c.rowHover, borderRadius: radius.md },
      ]}
    >
      <Feather name={entry.icon} size={18} color={c.text2} />
      <View style={s.fill}>
        <Txt size="base">{entry.label}</Txt>
        <Txt size="xs" tone="muted" numberOfLines={1}>
          {entry.hint}
        </Txt>
      </View>
      {entry.badge ? (
        <View style={[styles.badge, { backgroundColor: c.accentSoft }]}>
          <Txt size="xs" weight="semibold" tone="accent">
            {entry.badge}
          </Txt>
        </View>
      ) : null}
      <Feather name="chevron-right" size={18} color={c.text3} />
    </Pressable>
  )

  return (
    <Screen title="More" subtitle="The rest of jojo">
      {/* Three panels of navigation rows. Side by side on a tablet, because a
          row stretched to 1200pt puts its chevron a thousand points from its
          label and turns a scannable list into a search. */}
      <Columns>
        <Panel>
          {workflow.map((e, i) => (
            <View key={e.screen}>
              {i > 0 ? <Divider /> : null}
              <Row entry={e} />
            </View>
          ))}
        </Panel>

        <Panel>
          {account.map((e, i) => (
            <View key={e.screen}>
              {i > 0 ? <Divider /> : null}
              <Row entry={e} />
            </View>
          ))}
        </Panel>

        {/**
         * What the three runtime pieces are actually doing.
         *
         * The web sidebar shipped this reading '14.2 MB', '2m ago' and a green dot
         * on the bridge — numbers for a sync that has never run and a store that is
         * not on disk. A status strip whose figures are invented is worse than
         * none: it is the one place a reader looks to find out whether their data
         * is safe. Each states the real state.
         */}
        <Panel>
          <PanelTitle hint="what is actually running">Runtime</PanelTitle>
          {[
            {
              label: 'Device storage',
              // Read from the write queue rather than asserted. A row that says
              // "on this device" while writes are failing is the one lie this
              // panel exists to prevent.
              meta: storageMeta(health),
              status: storageStatus(health),
              icon: 'database' as const,
            },
            { label: 'Local model', meta: 'offline', status: 'off' as const, icon: 'cpu' as const },
            {
              label: 'Transfer',
              meta: 'no device paired',
              status: 'off' as const,
              icon: 'share-2' as const,
            },
          ].map((r, i) => (
            <View key={r.label}>
              {i > 0 ? <Divider /> : null}
              <View style={styles.runtimeRow}>
                <Feather name={r.icon} size={16} color={c.text3} />
                <Txt size="sm" tone="secondary" style={s.fill}>
                  {r.label}
                </Txt>
                <Txt size="xs" tone="muted">
                  {r.meta}
                </Txt>
                <StatusDot status={r.status} />
              </View>
            </View>
          ))}
        </Panel>
      </Columns>

      <Txt size="xs" tone="muted" center>
        jojo — Jarvis fOr Job Organization. Everything runs on this device.
        {overdue > 0 ? ` ${overdue} reminder${overdue === 1 ? '' : 's'} overdue.` : ''}
      </Txt>
    </Screen>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 60 },
  badge: { paddingHorizontal: space[2], paddingVertical: 2, borderRadius: radius.full },
  runtimeRow: { flexDirection: 'row', alignItems: 'center', gap: space[2.5], minHeight: 48 },
})
