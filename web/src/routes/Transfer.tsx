import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Smartphone } from 'lucide-react'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader, PageOption } from '@/components/common/PageHeader'
import { Segment } from '@/components/common/Segment'
import { ReceivePanel } from '@/components/transfer-ui/ReceivePanel'
import { CodePanel, PayloadPanel } from '@/components/transfer-ui/SendPanel'
import { TransferStage, type TransferRole } from '@/components/transfer-ui/TransferStage'
import { totalOf, type TransferGroup } from '@/components/transfer-ui/groups'
import { makePairingCode } from '@/components/transfer-ui/pairing'
import { useTransferRun } from '@/components/transfer-ui/use-transfer-run'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useApplications } from '@jojo/service/react/use-applications'
import { useProfile } from '@jojo/service/react/use-profile'
import { useScout } from '@jojo/service/react/use-scout'
import { useTimeline } from '@jojo/service/react/use-timeline'
import { useVault } from '@jojo/service/react/use-vault'
import { useLabels } from '@/lib/labels-context'
import { settingsPath, useTitle } from '@/lib/links'
import { useToast } from '@/lib/toast-context'

const ROLES = [
  { value: 'send', label: 'Send from this device' },
  { value: 'receive', label: 'Receive on this device' },
] as const satisfies readonly { value: TransferRole; label: string }[]

/**
 * Moving your jojo data to another device.
 *
 * The whole journey is a demonstration: this build opens no sockets, asks for
 * no camera and writes to no store. That is said where a person could act on
 * it — under the code, which is the one thing here that looks like it is
 * broadcasting — rather than in a banner across the top. Everything else is
 * shaped the way the real handoff would be, so the screen is worth walking
 * through even though nothing crosses it.
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
  const { toast } = useToast()

  const [role, setRole] = useState<TransferRole>('send')
  // Minted once per visit, like a real pairing code: it identifies this session
  // of this device, not the device itself.
  const [code, setCode] = useState(makePairingCode)
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

  const run = useTransferRun({ stepCount: offered.length, autoStart: role === 'send' })
  const { reset } = run
  const locked = run.phase !== 'waiting'

  // Switching devices starts a new run. A bar left at 60% from the other side
  // of the handoff describes something nobody is doing any more.
  useEffect(() => reset(), [role, reset])

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
            phase={run.phase}
            progress={run.progress}
            groups={offered}
            activeIndex={run.activeIndex}
            movedCount={run.movedCount}
            showScene={showScene}
            canStart={offered.length > 0}
            onSimulate={run.pair}
            onStart={run.start}
            onReset={run.reset}
          />

          <div className="flex flex-col gap-4 sm:gap-5">
            {role === 'send' ? (
              <>
                <CodePanel
                  code={code}
                  locked={locked}
                  onRegenerate={() => {
                    setCode(makePairingCode())
                    toast({
                      title: 'Pairing code replaced',
                      description: 'The old one no longer pairs — read the new one out instead.',
                    })
                  }}
                />
                <PayloadPanel
                  sendFiles={sendFiles}
                  fileCount={files.length}
                  locked={locked}
                  onToggleFiles={setSendFiles}
                />
              </>
            ) : (
              <ReceivePanel paired={locked} onPair={run.pair} />
            )}
          </div>
        </div>
      )}
    </>
  )
}
