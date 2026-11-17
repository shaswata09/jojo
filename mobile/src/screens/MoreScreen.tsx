import { Pressable, StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { i18next } from '@/i18n/i18n'
import type { PersistenceHealth } from '@jojo/service/repo/repository'
import { useStoreStatus } from '@jojo/service/react/status-context'
import { useKg } from '@jojo/service/react/kg-context'
import { useModelSettings } from '@/lib/model-settings-context'
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
import { STATUS_HEADLINE, STATUS_POINTS, STATUS_SUMMARY } from '@jojo/service/core/status'
import { TourTarget } from '@/components/tour/TourTarget'
import { useDomain } from '@/i18n/domain'
import { Icon } from '@/components/ui/Icon'

type Entry = {
  screen: keyof RootStackParamList
  /** The row's stable id, which the guided tour marks; not shown. */
  label: string
  /** What the row reads as, in the reader's language. */
  name: string
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
      return i18next.t('screens:more.storage.saved')
    case 'writing':
      return health.pending > 0
        ? i18next.t('screens:more.storage.savingCount', { count: health.pending })
        : i18next.t('screens:more.storage.saving')
    case 'degraded':
      return i18next.t('screens:more.storage.unsaved', { count: health.unsaved })
    case 'off':
      return i18next.t('screens:more.storage.off')
  }
}

export function MoreScreen() {
  const { t, i18n } = useTranslation('screens')
  const domain = useDomain()
  const { health } = useStoreStatus()
  const c = useColors()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const { reminders } = useTimeline()
  const { matches } = useScout()
  const { settings } = useModelSettings()
  const { repo } = useKg()
  const modelReady = settings.model.trim() !== ''
  const handedOverAt = repo.meta.handoverAt

  // A match nobody has turned into an application yet — the only ones there is
  // anything left to do about. Every badge in this app counts something visible
  // on the screen it points at, so following it answers the question it raises.
  const fresh = matches.filter((m) => !m.applicationId).length
  const overdue = reminders.filter((r) => !r.completedOn && bucketOf(r, TODAY) === 'overdue').length

  const workflow: Entry[] = [
    {
      screen: 'JobScout',
      label: 'Job scout',
      name: t('more.entries.jobScout.label'),
      hint: t('more.entries.jobScout.hint'),
      icon: 'radio',
      badge: fresh > 0 ? t('more.newBadge', { count: fresh }) : undefined,
    },
    {
      screen: 'Statistics',
      label: 'Statistics',
      name: t('more.entries.statistics.label'),
      hint: t('more.entries.statistics.hint'),
      icon: 'bar-chart-2',
    },
    {
      screen: 'Graph',
      label: 'Graph',
      name: t('more.entries.graph.label'),
      hint: t('more.entries.graph.hint'),
      icon: 'share-2',
    },
    {
      screen: 'Transfer',
      label: 'Transfer',
      name: t('more.entries.transfer.label'),
      hint: t('more.entries.transfer.hint'),
      icon: 'smartphone',
    },
  ]

  const account: Entry[] = [
    {
      screen: 'Profile',
      label: 'My profile',
      name: t('more.entries.profile.label'),
      hint: t('more.entries.profile.hint'),
      icon: 'user',
    },
    {
      screen: 'Assistant',
      label: 'Assistant',
      name: t('more.entries.assistant.label'),
      hint: t('more.entries.assistant.hint'),
      icon: 'message-square',
    },
    {
      screen: 'Settings',
      label: 'Settings',
      name: t('more.entries.settings.label'),
      hint: t('more.entries.settings.hint'),
      icon: 'settings',
    },
    {
      screen: 'Guide',
      label: 'How to use',
      name: t('more.entries.guide.label'),
      hint: t('more.entries.guide.hint'),
      icon: 'help-circle',
    },
  ]

  // Each row is marked for the guided tour, which points at a few of them.
  const Row = ({ entry }: { entry: Entry }) => (
    <TourTarget id={`more:${entry.label}`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          entry.badge
            ? t('more.rowWithBadge', { name: entry.name, badge: entry.badge })
            : entry.name
        }
        onPress={() => navigation.navigate(entry.screen as never)}
        style={({ pressed }) => [
          styles.row,
          pressed && { backgroundColor: c.rowHover, borderRadius: radius.md },
        ]}
      >
        <Feather name={entry.icon} size={18} color={c.text2} />
        <View style={s.fill}>
          <Txt size="base">{entry.name}</Txt>
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
        <Icon name="chevron-right" size={18} color={c.text3} />
      </Pressable>
    </TourTarget>
  )

  return (
    <Screen title={t('more.title')} subtitle={t('more.subtitle')} wide>
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
          <PanelTitle hint={t('more.runtime.hint')}>{t('more.runtime.title')}</PanelTitle>
          {[
            {
              id: 'storage',
              label: t('more.runtime.storage'),
              // Read from the write queue rather than asserted. A row that says
              // "on this device" while writes are failing is the one lie this
              // panel exists to prevent.
              meta: storageMeta(health),
              status: storageStatus(health),
              icon: 'database' as const,
            },
            /*
             * Read from the settings, not asserted.
             *
             * Both of these were hardcoded — every user was told their model was
             * offline whatever they had configured, and that no device was
             * paired whether or not one was. This panel's own header says "a
             * status strip whose figures are invented is worse than none", and
             * these two were the invented ones.
             *
             * Deliberately reports "configured" rather than "connected": this
             * screen does not probe, and claiming a live connection it has not
             * checked would be the same defect wearing a better word. Settings
             * probes and can say which.
             */
            {
              id: 'model',
              label: t('more.runtime.model'),
              meta: modelReady
                ? t('more.runtime.modelConfigured', { model: settings.model })
                : t('more.runtime.modelNotSetUp'),
              status: modelReady ? ('on' as const) : ('off' as const),
              icon: 'cpu' as const,
            },
            {
              id: 'transfer',
              label: t('more.runtime.transfer'),
              meta:
                handedOverAt === null
                  ? t('more.runtime.transferNever')
                  : t('more.runtime.transferLast', { date: domain.shortDate(handedOverAt) }),
              status: 'off' as const,
              icon: 'share-2' as const,
            },
          ].map((r, i) => (
            <View key={r.id}>
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

      {/* The status notice, at the foot of the screen that holds everything
          else about the app. The web app puts the same line in its sidebar; the
          phone has no sidebar, and More is where somebody goes when they want
          to know what jojo is. The words come from `core/status.ts` so the two
          platforms cannot drift. */}
      {/* English in every language, on purpose: it is the single source the
          README, NOTICE and the web's Licence page are checked against, and a
          translated liability statement is a second text that can disagree.
          What IS translated is the line saying so, and the English is marked as
          English so a screen reader does not read it in the phone's voice. */}
      <Panel>
        {i18n.language.split('-')[0] !== 'en' ? (
          <Txt size="xs" tone="muted" style={{ marginBottom: space[1] }}>
            {t('more.statusEnglish')}
          </Txt>
        ) : null}
        <Txt size="sm" weight="medium" tone="warning" accessibilityLanguage="en">
          {STATUS_HEADLINE}
        </Txt>
        <Txt size="xs" tone="muted" style={{ marginTop: space[1] }} accessibilityLanguage="en">
          {STATUS_SUMMARY}
        </Txt>
        {STATUS_POINTS.map((point) => (
          <Txt
            key={point.label}
            size="xs"
            tone="muted"
            style={{ marginTop: space[2] }}
            accessibilityLanguage="en"
          >
            <Txt size="xs">{point.label}. </Txt>
            {point.body}
          </Txt>
        ))}
      </Panel>

      <Txt size="xs" tone="muted" center>
        {t('more.footer')}
        {overdue > 0 ? ` ${t('more.overdue', { count: overdue })}` : ''}
      </Txt>
    </Screen>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 60 },
  badge: { paddingHorizontal: space[2], paddingVertical: 2, borderRadius: radius.full },
  runtimeRow: { flexDirection: 'row', alignItems: 'center', gap: space[2.5], minHeight: 48 },
})
