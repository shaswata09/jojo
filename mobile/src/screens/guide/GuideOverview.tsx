import { StyleSheet, View } from 'react-native'
import { TODAY } from '@/lib/today'
import { Feather } from '@expo/vector-icons'
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

type Layer = {
  icon: FeatherName
  name: string
  requires: string
  gives: string
  active: boolean
}

const LAYERS: Layer[] = [
  {
    icon: 'smartphone',
    name: 'This device only',
    requires: 'Nothing to set up',
    gives: 'Track applications, deadlines, follow-ups and documents',
    active: true,
  },
  {
    icon: 'hard-drive',
    name: '+ Localhost bridge',
    requires: 'A small companion server',
    gives: 'Would mirror to a JSON file on disk and keep submission snapshots',
    active: false,
  },
  {
    icon: 'cpu',
    name: '+ Local model',
    requires: 'vLLM, Ollama or LM Studio',
    gives: 'Would score scout matches and draft against your own documents',
    active: false,
  },
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
      title: 'Add an application',
      body: 'A position, its stage and its deadline. Everything else in jojo hangs off this record.',
      done: applications.length > 0,
      label: 'New application',
      onPress: () => open('application'),
    },
    {
      id: 'dated',
      title: 'Give something a date',
      body: 'Deadlines, interviews and campus visits are one kind of record, so they reach the calendar, the week ahead and the application at once.',
      done: items.some((i) => !i.remind),
      label: 'New event',
      onPress: () => open('timelineItem', { mode: 'event', initial: { date: TODAY } }),
    },
    {
      id: 'reminder',
      title: 'Set a follow-up',
      body: 'A reminder is the same record with a nudge switched on. Once its date passes it is flagged on Today until you tick it off.',
      done: reminders.length > 0,
      label: 'New reminder',
      onPress: () => open('timelineItem', { mode: 'reminder' }),
    },
    {
      id: 'posting',
      title: 'Keep a posting before it is taken down',
      body: 'Nothing is fetched and no copy is stored — what is kept is the URL, the employer guessed from it and the day you saved it. That is enough to find the ad again.',
      done: postings.length > 0 || links.length > 0,
      label: 'Open Job scout',
      onPress: () => navigation.navigate('JobScout'),
    },
    {
      id: 'file',
      title: 'File your documents',
      body: 'Record a CV or a statement in the Vault. Names, sizes and types are kept; the file itself is never read.',
      done: files.length > 0,
      label: 'Open the Vault',
      onPress: () => navigation.navigate('Tabs', { screen: 'Vault', params: { tool: 'files' } }),
    },
    {
      id: 'keyword',
      title: 'Tag something with a keyword',
      body: 'Keywords are yours, shared by applications, reminders and everything in the Vault — unlike the fixed role tags. The tag button on any row adds one.',
      done: labels.some((l) => countFor(l.id) > 0),
      label: 'Manage keywords',
      onPress: () => navigation.navigate('Settings'),
    },
    {
      id: 'draft',
      // Nothing records that a message was written, so this row never ticks —
      // and says why rather than sitting permanently un-done for no reason.
      title: 'Draft a message',
      body: 'Built from your own email snippets, with the role, employer and dates filled in from the record. A person’s name is never filled in for you. Nothing here records that you sent it, so this step does not tick itself.',
      label: 'Draft a message',
      onPress: () => open('draft'),
    },
  ]

  const trackable = steps.filter((s) => s.done !== undefined)
  const doneCount = trackable.filter((s) => s.done).length

  return (
    <>
      {LAYERS.map((l) => (
        <Panel key={l.name} style={l.active ? { borderColor: c.accentBorder } : undefined}>
          <View style={s.row}>
            <Feather name={l.icon} size={17} color={l.active ? c.accent : c.text3} />
            <Txt size="base" weight="medium" style={s.fill}>
              {l.name}
            </Txt>
            {/* "optional" undersold it: neither of the lower two is present in
                this build, and the tense of each `gives` line matches. */}
            <Txt size="xs" tone={l.active ? 'accent' : 'muted'}>
              {l.active ? 'active' : 'not connected'}
            </Txt>
          </View>
          <Txt size="xs" tone="muted" style={{ marginTop: space[2] }}>
            {l.requires}
          </Txt>
          <Txt size="sm" tone="secondary" style={{ marginTop: space[1.5] }}>
            {l.gives}
          </Txt>
        </Panel>
      ))}

      {/* Explanatory panels with no order between them. Side by side on a tablet. */}
      <Columns>
        <Panel>
          <PanelTitle hint={`${doneCount} of ${trackable.length} done`}>Getting started</PanelTitle>
          <Txt size="sm" tone="secondary" style={{ marginBottom: space[3] }}>
            {doneCount === trackable.length
              ? 'Every step is done. The checklist reads your records, so it follows if you clear them.'
              : 'Each step opens the real thing, and ticks itself once a record exists. Nothing here is a tutorial you have to sit through.'}
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
                        Done
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
          <PanelTitle hint="the profile is not part of the checklist">
            Fill in your profile
          </PanelTitle>
          <Txt size="sm" tone="secondary">
            Your basics, links, target roles and match terms live under My profile. They are what
            the scout would score against and what the assistant would draft from, so they matter —
            but this build keeps them for the visit only rather than writing them anywhere, which is
            why the checklist above cannot tick for them.
          </Txt>
          <Button
            label="Open my profile"
            variant="outline"
            onPress={() => navigation.navigate('Profile')}
            style={{ marginTop: space[3], alignSelf: 'flex-start' }}
          />
        </Panel>

        <Panel style={{ borderColor: c.warningBorder }}>
          <View style={s.row}>
            <Feather name="alert-triangle" size={18} color={c.warning} />
            <Txt size="base" weight="medium" style={s.fill}>
              The app is the database
            </Txt>
          </View>
          <Txt size="sm" tone="secondary" style={{ marginTop: space[2] }}>
            Your records are saved on this device and survive a restart. Nothing is sent anywhere —
            no account, no sync, no network call. Settings is where you clear them, reload the demo
            data, or export a copy to the clipboard.
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
