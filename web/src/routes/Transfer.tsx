import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Smartphone } from 'lucide-react'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader, PageOption } from '@/components/common/PageHeader'
import { HandoverStatus } from '@/components/transfer-ui/HandoverStatus'
import { Segment } from '@/components/common/Segment'
import { ReceivePanel } from '@/components/transfer-ui/ReceivePanel'
import { DetailsPanel, PayloadPanel } from '@/components/transfer-ui/SendPanel'
import { TransferStage, type TransferRole } from '@/components/transfer-ui/TransferStage'
import { totalOf, type TransferGroup } from '@/components/transfer-ui/groups'
import { ConnectPanel } from '@/components/transfer-ui/ConnectPanel'
import { useBackup } from '@/lib/backup'
import { useHandoffSend } from '@/lib/handoff-send'
import { usePairingSession } from '@/lib/pairing-session'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useApplications } from '@jojo/service/react/use-applications'
import { useProfile } from '@jojo/service/react/use-profile'
import { useScout } from '@jojo/service/react/use-scout'
import { useTimeline } from '@jojo/service/react/use-timeline'
import { useVault } from '@jojo/service/react/use-vault'
import { useLabels } from '@/lib/labels-context'
import { settingsPath, useTitle } from '@/lib/links'

const ROLES = [
  { value: 'send', label: 'Send from this device' },
  { value: 'receive', label: 'Receive on this device' },
] as const satisfies readonly { value: TransferRole; label: string }[]

/**
 * Moving your jojo data to another device.
 *
 * Every part of this page is now the real thing, which was not true for most of
 * its life and is worth stating plainly.
 *
 * The key on screen is a genuine offer from `core/pairing.ts`, minted with real
 * X25519 on this device, and it is carried by the animation's own dots rather
 * than by a symbol laid over them — `core/pulse.ts` says which regions light,
 * `DataTransferScene` lights them, and a phone's camera reads them back.
 * `ConnectPanel` then takes the address the phone shows, asks it for its half
 * of the handshake, and streams the backup in sealed chunks — over the local
 * network, to a private address, with no server and no relay anywhere in it.
 *
 * The last piece of theatre went with `useTransferRun`: the stage card walked a
 * timer through the groups and finished on "nothing moved" while, a few inches
 * to the right, a real transfer was reporting real chunks. Two things on one
 * screen describing the same transfer, one of them lying. `TransferStage` now
 * reads the send state directly and has nothing in it that moves on its own.
 *
 * ## Receiving
 *
 * A browser cannot. Not a gap — `TCPServerSocket` is Isolated-Web-Apps only, so
 * no web page can accept an inbound connection — and the reason the phone is
 * the listening side in the first place. The receive role says so and points at
 * the backup file, which is what actually works in that direction.
 *
 * The counts come from the live store rather than from a fixture, which is the
 * point of showing them: what you are about to move is what you actually have.
 */
export function Transfer() {
  useTitle('Transfer')
  const { all: applications } = useApplications()
  const { all: items, reminders } = useTimeline()
  const { links, files, snippets } = useVault()
  const { pipelines, postings, matches } = useScout()
  const { isBlank: profileIsBlank } = useProfile()
  const { labels } = useLabels()

  const [role, setRole] = useState<TransferRole>('send')
  /*
   * The live pairing offer.
   *
   * Only minted while this device is the one SENDING — the offer holds a private
   * key and a secret, and a receiving device has no use for either. Switching
   * role tears the session down, which is what `active` does here.
   */
  const pairing = usePairingSession(role === 'send')
  const backup = useBackup()
  /*
   * The transfer itself.
   *
   * `build` is passed rather than called: the backup is gathered only after the
   * phone has answered, so a mistyped code or an unreachable device costs
   * nothing. `documents: sendFiles` is the switch on the right — the one thing
   * about the payload a person chooses.
   */
  const send = useHandoffSend({
    // `pairing.complete` returns the keys rather than a flag, deliberately —
    // reading `pairing.keys` here would read this render's value, which is null
    // until React re-renders, and the transfer would stop saying it had failed.
    complete: pairing.complete,
    build: () => backup.build({ documents: sendFiles }),
  })
  /**
   * Off by default.
   *
   * Files are the heavy, slow half of a handoff, and the half a person is most
   * likely to already have on the other device. Everything else here is small
   * text that is never worth leaving behind, so it moves without asking.
   */
  const [sendFiles, setSendFiles] = useState(false)
  /**
   * The scene is a WebGPU canvas running a shader every frame. On a laptop on
   * battery, or beside a progress readout someone is actually trying to read,
   * being able to put it away is worth more than the picture.
   */
  const [showScene, setShowScene] = useState(true)

  const groups = useMemo<TransferGroup[]>(
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
      // The audit found these three missing while the subtitle promised
      // everything: six scout records sat on /scout and in the graph's legend
      // and were never in the manifest, so the closing sentence itemised a
      // total that quietly excluded them.
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
        hint: 'Your name, links, match terms and the scout switches',
        // One record, so this is a 1 or a 0 rather than a count — and a 0 when
        // nothing has been filled in, which keeps it out of the run entirely
        // instead of offering to move a page of blank fields.
        count: profileIsBlank ? 0 : 1,
      },
    ],
    [
      applications.length,
      items.length,
      reminders.length,
      links,
      files,
      snippets,
      labels.length,
      pipelines.length,
      postings.length,
      matches.length,
      profileIsBlank,
    ],
  )

  /**
   * What the run walks through.
   *
   * The sender can leave files behind; the receiver does not get a say — it is
   * being handed someone else's selection, and a receiving device that quietly
   * dropped half of what arrived would be the worst kind of surprise.
   */
  const offered = useMemo(
    () =>
      groups.filter(
        (group) => group.count > 0 && (role === 'receive' || group.id !== 'files' || sendFiles),
      ),
    [groups, sendFiles, role],
  )

  /*
   * Locked once the transfer is under way.
   *
   * Read off the real send rather than a phase of its own: the payload switch
   * decides what `build()` gathers, and `build()` has already run by `sending`.
   * A switch that still moved after that would change the label on the card
   * without changing a byte of what was going across.
   */
  const { cancel } = send
  const locked = send.stage !== 'idle' && send.stage !== 'failed'

  // Switching roles abandons a run rather than leaving it going behind a panel
  // nobody is looking at.
  useEffect(() => cancel(), [role, cancel])

  const empty = totalOf(groups) === 0

  return (
    <>
      <PageHeader
        title="Transfer"
        subtitle="Move everything to another device"
        settings={
          <>
            <PageOption
              label="Show the animation"
              hint="A WebGPU scene redrawing every frame — turn it off on battery"
              control={
                <Switch
                  checked={showScene}
                  onCheckedChange={setShowScene}
                  aria-label="Show the animation"
                />
              }
            />
            {/* "Transfer files" is deliberately NOT repeated here. It has its
                own panel on the right, where it sits beside the thing it
                changes; the same switch in two places on one screen reads as
                two settings that might disagree. */}
          </>
        }
        actions={
          /* Switchable at any point, including mid-run: the effect above puts
             the run back to the start, which is honest, where a control
             disabled halfway through a demonstration is just a dead end. */
          <Segment label="This device's part" options={ROLES} value={role} onChange={setRole} />
        }
      />

      {/* Above the panels rather than inside one: it is true of the whole page
          and of both roles, and it belongs before the button that overwrites
          the other device rather than beside it. */}
      <HandoverStatus />

      {empty ? (
        <section className="surface rounded-lg px-4 py-4 sm:px-5 sm:py-5">
          <EmptyState
            icon={Smartphone}
            title="Nothing to move yet"
            description="There are no applications, reminders, vault records, keywords or scout records on this device, and the profile is blank. Add something, or load the demo data, and it will show up here as a group you can send."
            action={
              <Button size="sm" asChild>
                <Link to={settingsPath()}>Load the demo data</Link>
              </Button>
            }
          />
        </section>
      ) : (
        <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <TransferStage
            role={role}
            stage={send.stage}
            groups={offered}
            showScene={showScene}
            canStart={offered.length > 0}
            frames={pairing.frames}
          />

          <div className="flex flex-col gap-4 sm:gap-5">
            {role === 'send' ? (
              <>
                <DetailsPanel
                  groups={offered}
                  paired={pairing.keys !== null}
                  target={send.target}
                />
                <ConnectPanel send={send} token={pairing.token} />
                <PayloadPanel
                  sendFiles={sendFiles}
                  fileCount={files.length}
                  locked={locked}
                  onToggleFiles={setSendFiles}
                />
              </>
            ) : (
              <ReceivePanel />
            )}
          </div>
        </div>
      )}
    </>
  )
}
