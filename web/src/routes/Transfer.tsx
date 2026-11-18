import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Smartphone } from 'lucide-react'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader, PageOption } from '@/components/common/PageHeader'
import { HandoverStatus } from '@/components/transfer-ui/HandoverStatus'
import { Segment } from '@/components/common/Segment'
import { ReceivePanel } from '@/components/transfer-ui/ReceivePanel'
import { DetailsPanel, PayloadPanel } from '@/components/transfer-ui/SendPanel'
import { TransferStage, type TransferRole } from '@/components/transfer-ui/TransferStage'
import { countByGroup, totalOf, type TransferGroup } from '@/components/transfer-ui/groups'
import { ConnectPanel } from '@/components/transfer-ui/ConnectPanel'
import { useBackup } from '@/lib/backup'
import { useHandoffSend } from '@/lib/handoff-send'
import { useHandoffPull } from '@/lib/handoff-pull'
import { usePairingSession } from '@/lib/pairing-session'
import { replacesOffer } from '@/components/transfer-ui/send-cycle'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useApplications } from '@jojo/service/react/use-applications'
import { useGraph } from '@jojo/service/react/kg-context'
import { useProfile } from '@jojo/service/react/use-profile'
import { useScout } from '@jojo/service/react/use-scout'
import { useStickyNotes } from '@jojo/service/react/use-sticky-notes'
import { useTimeline } from '@jojo/service/react/use-timeline'
import { useVault } from '@jojo/service/react/use-vault'
import { useLabels } from '@/lib/labels-context'
import { settingsPath, useTitle } from '@/lib/links'

/** The two roles; each label is `page.roles.<value>` in the catalog. */
const ROLES = ['send', 'receive'] as const satisfies readonly TransferRole[]

/**
 * Moving your jojo data to another device.
 *
 * Every part of this page is now the real thing, which was not true for most of
 * its life and is worth stating plainly.
 *
 * The key on screen is a genuine offer from `core/pairing.ts`, minted with real
 * X25519 on this device, drawn as a QR code beside the copy (Q329) for the
 * jojo app on a phone to scan. The animation behind it is decoration.
 * `ConnectPanel` then takes the address the phone shows, asks it for its half
 * of the handshake, and streams the backup in sealed chunks — over the local
 * network, to a private address, with no server and no relay anywhere in it.
 * Both devices have to be on the same local network for any of it to connect,
 * and the copy on both roles says so.
 *
 * The last piece of theatre went with `useTransferRun`: the stage card walked a
 * timer through the groups and finished on "nothing moved" while, a few inches
 * to the right, a real transfer was reporting real chunks. Two things on one
 * screen describing the same transfer, one of them lying. `TransferStage` now
 * reads the send state directly and has nothing in it that moves on its own.
 *
 * ## Receiving
 *
 * A browser cannot be connected TO — `TCPServerSocket` is Isolated-Web-Apps
 * only — which is why the phone is always the listening side. It never needed
 * to be. The phone chooses Send to a computer, reads the same animation, and
 * listens exactly as it does to receive; this page dials it the same way, and
 * then ASKS for the phone's backup chunk by chunk instead of posting its own
 * (`lib/handoff-pull.ts`). What arrives goes through the restore a backup file
 * goes through, behind the same confirmation.
 *
 * The counts come from the live store rather than from a fixture, which is the
 * point of showing them: what you are about to move is what you actually have.
 */
export function Transfer() {
  const { t } = useTranslation('transfer')
  useTitle(t('page.title'))
  const { all: applications } = useApplications()
  const { all: items, reminders } = useTimeline()
  const { links, files, snippets } = useVault()
  const { pipelines, postings, matches } = useScout()
  const { notes: stickyNotes } = useStickyNotes()
  const { isBlank: profileIsBlank } = useProfile()
  const { labels } = useLabels()

  const [role, setRole] = useState<TransferRole>('send')
  /*
   * The live pairing offer.
   *
   * Minted in BOTH roles: receiving pairs exactly as sending does, by the phone
   * reading this screen. A role switch puts a fresh code up (below), so the
   * code on screen always belongs to the direction on screen.
   */
  const pairing = usePairingSession(true, role === 'send' ? 'push' : 'pull')
  const backup = useBackup()
  /*
   * Whether the current run has handed the phone's answer to the pairing — the
   * line between a failure the same code can retry and one that spends it (see
   * `send-cycle.ts`). State rather than a ref so that the effect below sees it
   * flip even if React folds a run's 'connecting' into its 'failed' render.
   */
  const [answered, setAnswered] = useState(false)
  const { complete: pair } = pairing
  const complete = useCallback(
    (response: Uint8Array) => {
      setAnswered(true)
      return pair(response)
    },
    [pair],
  )
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
    complete,
    build: () => backup.build({ documents: sendFiles }),
  })
  /*
   * Receiving from the phone. Shares `complete` with the send, so the same
   * `answered` line decides when the code is spent in either direction.
   */
  const pull = useHandoffPull({ complete })
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

  const graph = useGraph()
  const stored = useMemo(() => countByGroup(graph.nodes()), [graph])

  const groups = useMemo<TransferGroup[]>(
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
        // gave Arabic one plural form for every number.
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
      // The audit found these three missing while the subtitle promised
      // everything: six scout records sat on /scout and in the graph's legend
      // and were never in the manifest, so the closing sentence itemised a
      // total that quietly excluded them.
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
        id: 'notes',
        label: t('groups.notes.label'),
        hint: t('groups.notes.hint'),
        count: stickyNotes.length,
      },
      {
        id: 'profile',
        label: t('groups.profile.label'),
        hint: t('groups.profile.hint'),
        // One record, so this is a 1 or a 0 rather than a count — and a 0 when
        // nothing has been filled in, which keeps it out of the run entirely
        // instead of offering to move a page of blank fields.
        count: profileIsBlank ? 0 : 1,
      },
      // Counted off the store, not off a hook: these two moved uncounted
      // until the transfer audit (2026-11-16) — `countByGroup`.
      {
        id: 'people',
        label: t('groups.people.label'),
        hint: t('groups.people.hint'),
        count: stored.people ?? 0,
      },
      {
        id: 'background',
        label: t('groups.background.label'),
        hint: t('groups.background.hint'),
        count: stored.background ?? 0,
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
      stickyNotes.length,
      profileIsBlank,
      stored,
      t,
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
  // nobody is looking at — and so does LEAVING THE PAGE, which is why `cancel`
  // is returned rather than called.
  //
  // `() => cancel()` invoked it as the effect body and handed React its
  // `undefined` return as the cleanup, so unmount cancelled nothing: the chunk
  // loop kept posting, then recorded a completed handover for a transfer the
  // user had walked away from. Coming back offered a fresh pairing and a second
  // convoy to the same phone. Returning the function covers both — React runs
  // cleanup before re-running the effect, so a role switch still cancels.
  useEffect(() => cancel, [role, cancel])
  const { cancel: cancelPull } = pull
  useEffect(() => cancelPull, [role, cancelPull])

  /*
   * A new code once the run that used this one is over — done, failed after
   * the phone answered, or abandoned. The offer is single-use and its re-mint
   * timer stands down once paired, so without this a failed send could not be
   * retried and a second device could not be sent to without leaving the page
   * (R18). A run that stopped BEFORE the answer keeps the code: the phone still
   * holds it, and retyping the address is the whole fix. Clearing `answered`
   * with the refresh is what makes one finished run mint one new code.
   */
  const { refresh } = pairing
  // The stage of the run for the role on screen. The other role's run was
  // cancelled by the switch, so it cannot be the one holding the offer.
  const stage = role === 'send' ? send.stage : pull.stage
  useEffect(() => {
    if (!replacesOffer(stage, answered)) return
    setAnswered(false)
    refresh()
  }, [stage, answered, refresh])

  // A fresh code on every role switch — not on the first render, which mints
  // its own. A phone that scanned the send code and is waiting to RECEIVE
  // would refuse a pull anyway (`core/handoff.ts` speaks one direction per
  // listener); a new code makes the mismatch impossible rather than refused.
  const shownRole = useRef(role)
  useEffect(() => {
    if (shownRole.current === role) return
    shownRole.current = role
    setAnswered(false)
    refresh()
  }, [role, refresh])

  /*
   * Nothing to SEND is not nothing to do: an empty computer is exactly the one
   * that wants to receive from the phone — a new laptop after "Start empty".
   * The whole page used to give way to "Nothing to move yet", Receive panel
   * and pulse included (transfer audit, 2026-11-16), so the empty state now
   * stands in for the send role only.
   */
  const empty = role === 'send' && totalOf(groups) === 0
  const roles = ROLES.map((value) => ({ value, label: t(`page.roles.${value}`) }))

  return (
    <>
      <PageHeader
        title={t('page.title')}
        subtitle={t('page.subtitle')}
        settings={
          <>
            <PageOption
              label={t('page.showAnimation')}
              hint={t('page.showAnimationHint')}
              control={
                <Switch
                  checked={showScene}
                  onCheckedChange={setShowScene}
                  aria-label={t('page.showAnimation')}
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
          <Segment label={t('page.roleLabel')} options={roles} value={role} onChange={setRole} />
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
            title={t('page.empty.title')}
            description={t('page.empty.description')}
            action={
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setRole('receive')}>
                  {t('page.empty.receive')}
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link to={settingsPath()}>{t('page.empty.loadDemo')}</Link>
                </Button>
              </div>
            }
          />
        </section>
      ) : (
        <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <TransferStage
            role={role}
            stage={stage}
            groups={offered}
            showScene={showScene}
            canStart={offered.length > 0}
            offer={pairing.offer}
          />

          <div className="flex flex-col gap-4 sm:gap-5">
            {role === 'send' ? (
              <>
                <DetailsPanel
                  groups={offered}
                  paired={pairing.keys !== null}
                  target={send.target}
                />
                <ConnectPanel send={send} tokens={pairing.tokens} />
                <PayloadPanel
                  sendFiles={sendFiles}
                  fileCount={files.length}
                  locked={locked}
                  onToggleFiles={setSendFiles}
                />
              </>
            ) : (
              <ReceivePanel pull={pull} tokens={pairing.tokens} />
            )}
          </div>
        </div>
      )}
    </>
  )
}
