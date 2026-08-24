import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Chip } from '@/components/ui/Chip'
import { Screen } from '@/components/ui/Screen'
import { Segment } from '@/components/ui/Segment'
import { Divider, Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { HandoverStatus } from '@/components/transfer/HandoverStatus'
import { ReceivePanel } from '@/components/transfer/ReceivePanel'
import { useLabels } from '@/lib/labels-context'
import { useApplications, useProfile, useScout, useTimeline, useVault } from '@/lib/store-context'
import { s } from '@/theme/styles'
import { space } from '@/theme/tokens'

type Role = 'send' | 'receive'

const ROLES = [
  { value: 'send', label: 'Send from here' },
  { value: 'receive', label: 'Receive here' },
] as const satisfies readonly { value: Role; label: string }[]

type Group = { id: string; label: string; unit: string; hint: string; count: number }

/**
 * Receiving your jojo data from another device.
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
 * ## Why the send half is a signpost rather than a feature
 *
 * The phone cannot send, and this is not a gap waiting to be filled. The whole
 * topology falls out of one platform fact: a browser cannot accept an inbound
 * connection, so the phone has to be the side that listens and the computer has
 * to be the side that connects. There is no arrangement of the same pieces in
 * which the phone pushes to a browser, and two phones cannot pair either —
 * neither can show the other an animation to read, because the scene is WebGPU
 * and this app has no browser in it.
 *
 * So sending points at the export under Settings, which reaches the other
 * device by whatever a phone is already good at.
 *
 * ## What is real
 *
 * Receiving, all of it. The camera reads the key off the other device's
 * animation, `core/pairing.ts` agrees a session, the phone opens a socket on
 * the local network, and what arrives is decrypted, authenticated and written
 * to the store by the same `repo/restore.ts` the browser uses for a backup
 * file. See `lib/restore-received.ts` for the last step.
 *
 * The counts come from the live store rather than from a fixture, which is the
 * point of showing them: what you are about to receive replaces exactly this.
 */
export function TransferScreen() {
  const { all: applications } = useApplications()
  const { all: items, reminders } = useTimeline()
  const { links, files, snippets } = useVault()
  const { pipelines, postings, matches } = useScout()
  const { isBlank: profileIsBlank } = useProfile()
  const { labels } = useLabels()

  // Receive first, because it is the half that works. A screen opening on the
  // one thing it cannot do is a screen that reads as broken.
  const [role, setRole] = useState<Role>('receive')

  const groups = useMemo<Group[]>(
    () => [
      {
        id: 'applications',
        label: 'Applications',
        unit: 'applications',
        hint: 'Every stage, note and outcome on each one',
        count: applications.length,
      },
      {
        id: 'timeline',
        label: 'Reminders and events',
        unit: 'reminders and events',
        hint: `${reminders.length} remind you, ${items.length - reminders.length} are dated events`,
        count: items.length,
      },
      {
        id: 'vault',
        label: 'Links and snippets',
        unit: 'links and snippets',
        hint: `${links.length} links · ${snippets.length} snippets`,
        count: links.length + snippets.length,
      },
      // Its own group rather than part of the vault, because it is the one the
      // switch controls — and a group nobody can exclude does not need to be
      // separable from its neighbours.
      {
        id: 'files',
        label: 'Files',
        unit: 'files',
        hint: 'CVs, statements and anything else saved against an application',
        count: files.length,
      },
      {
        id: 'keywords',
        label: 'Keywords',
        unit: 'keywords',
        hint: 'Your keyword list and every record it is attached to',
        count: labels.length,
      },
      {
        id: 'scout',
        label: 'Job scout',
        unit: 'job scout records',
        hint: `${pipelines.length} pipelines · ${postings.length} saved postings · ${matches.length} matches`,
        count: pipelines.length + postings.length + matches.length,
      },
      {
        id: 'profile',
        label: 'Profile',
        unit: 'profile',
        hint: 'Your basics, links, target roles and match terms',
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
    ],
  )

  const total = groups.reduce((n, g) => n + g.count, 0)

  return (
    <Screen
      title="Transfer"
      subtitle="Take everything from your computer onto this phone, over your local network. Nothing goes to the internet and nothing is stored anywhere else."
    >
      {/* Above the direction switch: it is true of the whole screen, and on
          this device it is the answer to "how old is what I am holding". */}
      <HandoverStatus />

      <Segment label="Direction" options={ROLES} value={role} onChange={setRole} />

      {role === 'send' ? (
        <Panel>
          <PanelTitle hint="not possible from a phone">Send from here</PanelTitle>
          <Txt size="sm" tone="secondary">
            A transfer needs one device to listen and the other to connect, and only this phone can
            listen — a web page is never allowed to accept a connection. So records move onto this
            phone, not off it.
          </Txt>
          <Txt size="sm" tone="secondary" style={{ marginTop: space[2] }}>
            To copy what is here somewhere else, use Export under Settings. It writes the whole
            store, and any device can read it.
          </Txt>
        </Panel>
      ) : (
        <ReceivePanel />
      )}

      <Panel>
        <PanelTitle hint={`${total} records`}>What is on this phone now</PanelTitle>

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
                  empty
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
          Receiving replaces all of it. Everything above is overwritten by what arrives, and it
          cannot be undone — export first if you want to keep this.
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
