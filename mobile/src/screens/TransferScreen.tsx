import { useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Feather } from '@react-native-vector-icons/feather/static'
import { Meter } from '@/components/charts/Charts'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { SettingRow, Toggle } from '@/components/ui/Field'
import { Screen } from '@/components/ui/Screen'
import { Segment } from '@/components/ui/Segment'
import { Divider, Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { useLabels } from '@/lib/labels-context'
import { useApplications, useProfile, useScout, useTimeline, useVault } from '@/lib/store-context'
import { useToast } from '@/lib/toast-context'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { radius, space } from '@/theme/tokens'

type Role = 'send' | 'receive'

const ROLES = [
  { value: 'send', label: 'Send from here' },
  { value: 'receive', label: 'Receive here' },
] as const satisfies readonly { value: Role; label: string }[]

type Group = { id: string; label: string; unit: string; hint: string; count: number }

/**
 * A pairing code, minted once per visit.
 *
 * It identifies this session of this device, not the device itself — which is
 * what a real pairing code does, and why it is regenerated rather than stored.
 * Deterministic from a counter rather than random: nothing crosses the wire, so
 * an unpredictable code would be theatre with no security behind it.
 */
let codeSeq = 0
function makePairingCode() {
  codeSeq += 1
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const from = (n: number, len: number) =>
    Array.from({ length: len }, (_, i) => alphabet[(n * 7 + i * 13 + 5) % alphabet.length]).join('')
  return `${from(codeSeq, 4)}-${from(codeSeq + 3, 4)}`
}

/**
 * Moving your jojo data to another device.
 *
 * The whole journey is a demonstration: this build opens no sockets, asks for no
 * camera and writes to no store. That is said where a person could act on it —
 * under the code, which is the one thing here that looks like it is
 * broadcasting — rather than in a banner across the top. Everything else is
 * shaped the way the real handoff would be.
 *
 * The counts come from the live store rather than from a fixture, which is the
 * point of showing them: what you are about to move is what you actually have.
 */
export function TransferScreen() {
  const c = useColors()
  const { all: applications } = useApplications()
  const { all: items, reminders } = useTimeline()
  const { links, files, snippets } = useVault()
  const { pipelines, postings, matches } = useScout()
  const { isBlank: profileIsBlank } = useProfile()
  const { labels } = useLabels()
  const { toast } = useToast()

  const [role, setRole] = useState<Role>('send')
  const [code] = useState(makePairingCode)
  /**
   * Off by default. Files are the heavy, slow half of a handoff and the half a
   * person is most likely to already have on the other device.
   */
  const [sendFiles, setSendFiles] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  useEffect(() => () => clearInterval(timer.current), [])

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

  const included = groups.filter((g) => (g.id === 'files' ? sendFiles : true) && g.count > 0)
  const total = included.reduce((n, g) => n + g.count, 0)

  const run = () => {
    clearInterval(timer.current)
    setProgress(0)
    timer.current = setInterval(() => {
      setProgress((p) => {
        if (p === null) return null
        // Deliberately quick, and deliberately not smooth: it steps through the
        // groups rather than pretending to measure bytes that never move.
        const next = p + 1 / Math.max(included.length, 1)
        if (next >= 1) {
          clearInterval(timer.current)
          toast({
            title: 'Nothing was transmitted',
            description: `The handoff is a demonstration in this build. ${total} records would have moved.`,
          })
          return 1
        }
        return next
      })
    }, 420)
  }

  return (
    <Screen
      title="Transfer"
      subtitle="Pair with a second device and hand over everything. A demonstration in this build — nothing is transmitted."
    >
      <Segment label="Direction" options={ROLES} value={role} onChange={setRole} />

      {role === 'send' ? (
        <Panel>
          <PanelTitle hint="read this out on the other device">Pairing code</PanelTitle>
          <View style={[styles.code, { backgroundColor: c.well, borderColor: c.hairline }]}>
            <Txt size="xxl" weight="semibold" mono>
              {code}
            </Txt>
          </View>
          {/* Said here, under the one thing on the screen that looks like it is
              broadcasting, rather than in a banner nobody reads. */}
          <Txt size="xs" tone="muted" center style={{ marginTop: space[2] }}>
            No connection is open. This code is generated on this device and goes nowhere.
          </Txt>
        </Panel>
      ) : (
        <Panel>
          <PanelTitle hint="type the code shown on the other device">Receive</PanelTitle>
          <View style={[styles.code, { backgroundColor: c.well, borderColor: c.hairline }]}>
            <Feather name="smartphone" size={28} color={c.text3} />
            <Txt size="sm" tone="muted" center style={{ marginTop: space[2] }}>
              Nothing is listening. Receiving needs the pairing service this build does not open.
            </Txt>
          </View>
        </Panel>
      )}

      <Panel>
        <PanelTitle hint={`${total} records`}>What would move</PanelTitle>

        {groups.map((g, i) => {
          const excluded = g.id === 'files' && !sendFiles
          return (
            <View key={g.id}>
              {i > 0 ? <Divider /> : null}
              <View style={styles.groupRow}>
                <View style={s.fill}>
                  <Txt size="base" tone={excluded || g.count === 0 ? 'muted' : 'primary'}>
                    {g.label}
                  </Txt>
                  <Txt size="xs" tone="muted">
                    {g.hint}
                  </Txt>
                </View>
                {g.count === 0 ? (
                  <Chip size="sm" tone="gray">
                    nothing to move
                  </Chip>
                ) : excluded ? (
                  <Chip size="sm" tone="gray">
                    excluded
                  </Chip>
                ) : (
                  <Txt size="base" weight="semibold" mono>
                    {g.count}
                  </Txt>
                )}
              </View>
            </View>
          )
        })}

        <Divider style={{ marginVertical: space[3] }} />

        <SettingRow
          label="Include files"
          description="The heavy half of a handoff, and the half you most likely already have on the other device."
          control={<Toggle value={sendFiles} onValueChange={setSendFiles} label="Include files" />}
        />
      </Panel>

      <Panel>
        <PanelTitle>Hand over</PanelTitle>
        {progress === null ? (
          <Txt size="sm" tone="secondary">
            Walk through the handoff to see its shape. It writes nothing on either device.
          </Txt>
        ) : (
          <>
            <Meter value={progress} max={1} color={c.info} />
            <Txt size="sm" tone="secondary" style={{ marginTop: space[2] }}>
              {progress >= 1
                ? `Finished. ${total} records would have moved — none of them did.`
                : `Walking through ${included.length} groups…`}
            </Txt>
          </>
        )}

        <Button
          label={
            progress === null ? 'Walk through it' : progress >= 1 ? 'Run it again' : 'Running…'
          }
          size="md"
          disabled={progress !== null && progress < 1}
          onPress={run}
          style={{ marginTop: space[3], alignSelf: 'flex-start' }}
        />
      </Panel>
    </Screen>
  )
}

const styles = StyleSheet.create({
  code: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space[6],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[3],
  },
})
