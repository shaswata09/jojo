import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Chip } from '@/components/ui/Chip'
import { Screen } from '@/components/ui/Screen'
import { Segment } from '@/components/ui/Segment'
import { Divider, Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { HandoverStatus } from '@/components/transfer/HandoverStatus'
import { ReceivePanel } from '@/components/transfer/ReceivePanel'
import { SendPanel } from '@/components/transfer/SendPanel'
import { useLabels } from '@/lib/labels-context'
import { useApplications, useProfile, useScout, useTimeline, useVault } from '@/lib/store-context'
import { s } from '@/theme/styles'
import { space } from '@/theme/tokens'

type Role = 'send' | 'receive'

/** The two directions; each label is `screen.roles.<value>` in the catalog. */
const ROLES = ['send', 'receive'] as const satisfies readonly Role[]

type Group = { id: string; label: string; hint: string; count: number }

/**
 * Moving your jojo data between this phone and a computer, either way.
 *
 * ## What this screen used to claim
 *
 * Two things that had both stopped being true. It minted a pairing code from a
 * counter and showed it in the largest type on the screen — a string generated
 * on this device, checked by nothing, going nowhere — and it offered a "Walk
 * through it" button that stepped a progress bar through the groups and
 * finished on a toast saying nothing had been transmitted.
 *
 * Both were honest in their small print and wrong in their shape. A person
 * looking at a phone showing a code in 32pt type has been told to read it out;
 * the sentence underneath saying it goes nowhere is doing more work than a
 * sentence can. And the fake bar now sat beside `ReceivePanel`, which reports a
 * REAL transfer — two bars on one screen for one operation, one of them
 * measuring a timer.
 *
 * ## How the phone sends, when a browser cannot be connected to
 *
 * This screen used to say the phone could not send, and the reasoning was half
 * right. A browser cannot accept an inbound connection, so the phone is always
 * the side that LISTENS and the computer always the side that connects. But who
 * connects does not decide which way the records go. Sending to a computer is
 * the same pairing and the same socket as receiving; the computer then asks
 * this phone for its backup, chunk by chunk, instead of posting its own
 * (`lib/handoff-serve.ts`, `core/handoff-pull.ts`).
 *
 * Two phones still cannot pair — only the computer draws a pairing code, and
 * only the phone scans one — and two computers cannot either. Both sides of every transfer are this phone and
 * a computer, on the same local network.
 *
 * ## What is real
 *
 * Both directions, all of it. The camera reads the key off the computer's QR
 * code, `core/pairing.ts` agrees a session, and the phone opens a socket
 * on the local network. Receiving decrypts, authenticates and writes what
 * arrives with the same `repo/restore.ts` the browser uses for a backup file
 * (`lib/restore-received.ts`). Sending hands over this phone's backup in the
 * same format, and the computer restores it the way it restores a file —
 * behind the same confirmation.
 *
 * Neither has been run on a real phone yet: the socket, NetInfo and the
 * camera need hardware. The protocol both carry is tested in `@jojo/service`.
 *
 * The counts come from the live store rather than from a fixture, which is the
 * point of showing them: what you are about to receive replaces exactly this.
 */
export function TransferScreen() {
  const { t } = useTranslation('transfer')
  const { all: applications } = useApplications()
  const { all: items, reminders } = useTimeline()
  const { links, files, snippets } = useVault()
  const { pipelines, postings, matches } = useScout()
  const { isBlank: profileIsBlank } = useProfile()
  const { labels } = useLabels()

  // Receive first: it is what a new phone is opened for, and the order the
  // two halves were built in.
  const [role, setRole] = useState<Role>('receive')

  const groups = useMemo<Group[]>(
    () => [
      {
        id: 'applications',
        label: t('groups.applications.label'),
        hint: t('groups.applications.hint'),
        count: applications.length,
      },
      {
        id: 'timeline',
        label: t('groups.timeline.label'),
        // Each count worded by its own plural key, then joined: a count
        // dropped into one sentence read "1 links" and "1 remind you", and
        // gave Arabic one plural form for every number (as on the web).
        hint: t('groups.timeline.hint', {
          reminders: t('groups.timeline.reminders', { count: reminders.length }),
          events: t('groups.timeline.events', { count: items.length - reminders.length }),
        }),
        count: items.length,
      },
      {
        id: 'vault',
        label: t('groups.vault.label'),
        hint: t('groups.vault.hint', {
          links: t('groups.vault.links', { count: links.length }),
          snippets: t('groups.vault.snippets', { count: snippets.length }),
        }),
        count: links.length + snippets.length,
      },
      // Its own group rather than part of the vault, because it is the one the
      // switch controls — and a group nobody can exclude does not need to be
      // separable from its neighbours.
      {
        id: 'files',
        label: t('groups.files.label'),
        hint: t('groups.files.hint'),
        count: files.length,
      },
      {
        id: 'keywords',
        label: t('groups.keywords.label'),
        hint: t('groups.keywords.hint'),
        count: labels.length,
      },
      {
        id: 'scout',
        label: t('groups.scout.label'),
        hint: t('groups.scout.hint', {
          pipelines: t('groups.scout.pipelines', { count: pipelines.length }),
          postings: t('groups.scout.postings', { count: postings.length }),
          matches: t('groups.scout.matches', { count: matches.length }),
        }),
        count: pipelines.length + postings.length + matches.length,
      },
      {
        id: 'profile',
        label: t('groups.profile.label'),
        hint: t('groups.profile.hint'),
        count: profileIsBlank ? 0 : 1,
      },
    ],
    [
      applications,
      items,
      reminders,
      links,
      snippets,
      files,
      labels,
      pipelines,
      postings,
      matches,
      profileIsBlank,
      t,
    ],
  )

  const total = groups.reduce((n, g) => n + g.count, 0)
  const roles = ROLES.map((value) => ({ value, label: t(`screen.roles.${value}`) }))

  return (
    <Screen title={t('screen.title')} subtitle={t('screen.subtitle')}>
      {/* Above the direction switch: it is true of the whole screen, and on
          this device it is the answer to "how old is what I am holding". */}
      <HandoverStatus />

      <Segment label={t('screen.direction')} options={roles} value={role} onChange={setRole} />

      {role === 'send' ? <SendPanel /> : <ReceivePanel />}

      <Panel>
        <PanelTitle hint={t('screen.records', { count: total })}>{t('screen.onPhone')}</PanelTitle>

        {groups.map((g, i) => (
          <View key={g.id}>
            {i > 0 ? <Divider /> : null}
            <View style={styles.groupRow}>
              <View style={s.fill}>
                <Txt size="base" tone={g.count === 0 ? 'muted' : 'primary'}>
                  {g.label}
                </Txt>
                <Txt size="xs" tone="muted">
                  {g.hint}
                </Txt>
              </View>
              {g.count === 0 ? (
                <Chip size="sm" tone="gray">
                  {t('screen.empty')}
                </Chip>
              ) : (
                <Txt size="base" weight="semibold" mono>
                  {g.count}
                </Txt>
              )}
            </View>
          </View>
        ))}

        <Divider style={{ marginVertical: space[3] }} />

        {/* Said under the list it is about. A restore replaces the store
            wholesale — `repo.replaceAll` in one transaction — and the journal
            goes with it, so there is no undo of a transfer and no undo of
            anything that happened before one. Somebody deciding whether to
            start needs that before they point the camera, not after. */}
        <Txt size="xs" tone="muted">
          {role === 'send' ? t('screen.sendNote') : t('screen.receiveNote')}
        </Txt>
      </Panel>
    </Screen>
  )
}

const styles = StyleSheet.create({
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[3],
  },
})
