import { StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { TODAY } from '@/lib/today'
import { Feather } from '@react-native-vector-icons/feather/static'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Columns } from '@/components/ui/Screen'
import { Divider, Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'

import { useLabels } from '@/lib/labels-context'
import { useSheets } from '@/lib/sheets-context'
import { useApplications, useScout, useTimeline, useVault } from '@/lib/store-context'
import type { FeatherName } from '@/lib/timeline-visuals'
import type { RootStackParamList } from '@/navigation/types'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

/** `id` names the rung's `name`, `requires` and `gives` under `overview.layers` in the guide catalog. */
type Layer = {
  id: 'device' | 'model' | 'reader' | 'computer'
  icon: FeatherName
  active: boolean
}

/*
 * `active` means "this rung is built", not "you have it set up" — the same
 * distinction the web ladder's own comment spells out, and the same bug it had
 * to fix. The model rung here read `active: false` and "Would score scout
 * matches", in the future tense, while `AssistantScreen` was already running
 * `runAgent` against a real endpoint with an approval sheet in front of every
 * write. A page telling somebody a feature does not exist while they are using
 * it is worse than a page that says nothing.
 *
 * There are four rungs rather than two for the same reason: the reader and
 * Transfer were both built and neither was listed, so the ladder was answering
 * "what can this thing do" with a third of the truth. The extension rung is
 * genuinely absent — it is a desktop browser extension and there is nothing to
 * install here.
 */
const LAYERS: Layer[] = [
  { id: 'device', icon: 'smartphone', active: true },
  { id: 'model', icon: 'cpu', active: true },
  { id: 'reader', icon: 'file-text', active: true },
  { id: 'computer', icon: 'refresh-cw', active: true },
]

/**
 * One thing to do, and whether it has been done.
 *
 * `done` is read off the store, never remembered separately — a checklist that
 * kept its own ticks would go on claiming you had added an application after you
 * deleted the last one, which is the failure every frozen count in this app has
 * already been through once.
 *
 * A step with `done: undefined` is one nothing here can observe: a message is
 * drafted into the clipboard and leaves no record, so that row offers the work
 * without pretending to know whether it happened.
 */
type Step = {
  id: string
  title: string
  body: string
  done?: boolean
  label: string
  onPress: () => void
}

export function GuideOverview() {
  const { t } = useTranslation('guide')
  const c = useColors()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const { open } = useSheets()
  const { all: applications } = useApplications()
  const { all: items, reminders } = useTimeline()
  const { links, files } = useVault()
  const { postings } = useScout()
  const { labels, countFor } = useLabels()

  const steps: Step[] = [
    {
      id: 'application',
      title: t('overview.steps.application.title'),
      body: t('overview.steps.application.body'),
      done: applications.length > 0,
      label: t('overview.steps.application.label'),
      onPress: () => open('application'),
    },
    {
      id: 'dated',
      title: t('overview.steps.dated.title'),
      body: t('overview.steps.dated.body'),
      done: items.some((i) => !i.remind),
      label: t('overview.steps.dated.label'),
      onPress: () => open('timelineItem', { mode: 'event', initial: { date: TODAY } }),
    },
    {
      id: 'reminder',
      title: t('overview.steps.reminder.title'),
      body: t('overview.steps.reminder.body'),
      done: reminders.length > 0,
      label: t('overview.steps.reminder.label'),
      onPress: () => open('timelineItem', { mode: 'reminder' }),
    },
    {
      id: 'posting',
      title: t('overview.steps.posting.title'),
      body: t('overview.steps.posting.body'),
      done: postings.length > 0 || links.length > 0,
      label: t('overview.steps.posting.label'),
      onPress: () => navigation.navigate('JobScout'),
    },
    {
      id: 'file',
      title: t('overview.steps.file.title'),
      body: t('overview.steps.file.body'),
      done: files.length > 0,
      label: t('overview.steps.file.label'),
      onPress: () => navigation.navigate('Tabs', { screen: 'Vault', params: { tool: 'files' } }),
    },
    {
      id: 'keyword',
      title: t('overview.steps.keyword.title'),
      body: t('overview.steps.keyword.body'),
      done: labels.some((l) => countFor(l.id) > 0),
      label: t('overview.steps.keyword.label'),
      onPress: () => navigation.navigate('Settings'),
    },
    {
      id: 'draft',
      // Nothing records that a message was written, so this row never ticks —
      // and says why rather than sitting permanently un-done for no reason.
      title: t('overview.steps.draft.title'),
      body: t('overview.steps.draft.body'),
      label: t('overview.steps.draft.label'),
      onPress: () => open('draft'),
    },
  ]

  const trackable = steps.filter((s) => s.done !== undefined)
  const doneCount = trackable.filter((s) => s.done).length

  return (
    <>
      {LAYERS.map((l) => (
        <Panel key={l.id} style={l.active ? { borderColor: c.accentBorder } : undefined}>
          <View style={s.row}>
            <Feather name={l.icon} size={17} color={l.active ? c.accent : c.text3} />
            <Txt size="base" weight="medium" style={s.fill}>
              {t(`overview.layers.${l.id}.name`)}
            </Txt>
            {/* "optional" undersold it: neither of the lower two is present in
                this build, and the tense of each `gives` line matches. */}
            <Txt size="xs" tone={l.active ? 'accent' : 'muted'}>
              {l.active ? t('overview.active') : t('overview.notConnected')}
            </Txt>
          </View>
          <Txt size="xs" tone="muted" style={{ marginTop: space[2] }}>
            {t(`overview.layers.${l.id}.requires`)}
          </Txt>
          <Txt size="sm" tone="secondary" style={{ marginTop: space[1.5] }}>
            {t(`overview.layers.${l.id}.gives`)}
          </Txt>
        </Panel>
      ))}

      {/* Explanatory panels with no order between them. Side by side on a tablet. */}
      <Columns>
        <Panel>
          <PanelTitle hint={t('overview.progress', { done: doneCount, total: trackable.length })}>
            {t('overview.gettingStarted')}
          </PanelTitle>
          <Txt size="sm" tone="secondary" style={{ marginBottom: space[3] }}>
            {doneCount === trackable.length ? t('overview.allDone') : t('overview.howItWorks')}
          </Txt>

          {steps.map((step, i) => (
            <View key={step.id}>
              {i > 0 ? <Divider /> : null}
              <View style={styles.step}>
                <View
                  style={[
                    styles.badge,
                    {
                      backgroundColor: step.done ? c.successSoft : c.accentSoft,
                      borderColor: step.done ? c.successBorder : c.accentBorder,
                    },
                  ]}
                >
                  {step.done ? (
                    <Feather name="check" size={13} color={c.success} />
                  ) : step.done === undefined ? (
                    <View style={[styles.dot, { backgroundColor: c.accent }]} />
                  ) : (
                    <Txt size="xs" weight="semibold" tone="accent">
                      {/* Numbered against the trackable steps only, so the last
                          number matches the "x of N done" count above. */}
                      {steps.slice(0, i + 1).filter((step) => step.done !== undefined).length}
                    </Txt>
                  )}
                </View>

                <View style={s.fill}>
                  <View style={styles.stepTitle}>
                    <Txt size="base" weight="medium">
                      {step.title}
                    </Txt>
                    {/* Only two states are ever claimed. "Available" is not a
                        badge — the button below already says the step is
                        reachable. */}
                    {step.done ? (
                      <Chip tone="green" size="sm">
                        {t('overview.done')}
                      </Chip>
                    ) : null}
                  </View>
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
        </Panel>

        <Panel>
          <PanelTitle hint={t('overview.profile.hint')}>{t('overview.profile.title')}</PanelTitle>
          <Txt size="sm" tone="secondary">
            {t('overview.profile.body')}
          </Txt>
          <Button
            label={t('overview.profile.open')}
            variant="outline"
            onPress={() => navigation.navigate('Profile')}
            style={{ marginTop: space[3], alignSelf: 'flex-start' }}
          />
        </Panel>

        <Panel style={{ borderColor: c.warningBorder }}>
          <View style={s.row}>
            <Feather name="alert-triangle" size={18} color={c.warning} />
            <Txt size="base" weight="medium" style={s.fill}>
              {t('overview.database.title')}
            </Txt>
          </View>
          <Txt size="sm" tone="secondary" style={{ marginTop: space[2] }}>
            {t('overview.database.body')}
          </Txt>
        </Panel>
      </Columns>
    </>
  )
}

const styles = StyleSheet.create({
  step: { flexDirection: 'row', gap: space[3], paddingVertical: space[3] },
  badge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 2,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  stepTitle: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' },
})
