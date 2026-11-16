import { Smartphone } from 'lucide-react'
import { SceneBackdrop } from '@/components/transfer-ui/SceneBackdrop'
import { PulseOverlay } from '@/components/transfer/PulseOverlay'
import type { PulseFrame } from '@jojo/service/core/pulse'
import { summarise, type TransferGroup } from '@/components/transfer-ui/groups'
import { showsOffer, type RunStage } from '@/components/transfer-ui/send-cycle'
import { stageCopy, type TransferRole } from '@/components/transfer-ui/stage-copy'
import { cn } from '@/lib/utils'

export type { TransferRole }

/**
 * The stage card: the animation, what is about to move, and where the run is.
 *
 * ## What used to be here
 *
 * A simulation. `useTransferRun` walked a timer through the groups at 900ms
 * each, ticking them off with spinners, and finished on "Demonstration
 * finished — nothing moved". That was written when nothing DID move, and it
 * stopped being true the day `ConnectPanel` started streaming a real backup to
 * a real phone.
 *
 * What was left was worse than a stale sentence. Two progress bars on one
 * screen, describing the same transfer, disagreeing — one reporting chunks the
 * phone had acknowledged, the other counting down a timer that would have
 * reached 100% just the same with the phone switched off. `SendPanel` already
 * carries the note that says why there is only one bar on this page; this card
 * was the reason that note had to be written, and the simulation is now gone
 * rather than annotated.
 *
 * So the state below is read from the real send, and there is nothing here that
 * moves on its own.
 *
 * ## What it deliberately does not show
 *
 * A progress bar, and a per-group tick list.
 *
 * The bar belongs to `ConnectPanel`, beside the field that starts the run. The
 * tick list cannot be honest at all: a transfer is ONE sealed stream of chunks
 * — see `core/convoy.ts` — so there is no moment at which "applications" have
 * arrived and "the timeline" has not. Showing a group going green would be
 * inventing an order the protocol does not have. The list is a manifest of what
 * is included, which is a fact, and the counts beside it are the live store's.
 */
export function TransferStage({
  role,
  stage,
  groups,
  canStart,
  showScene = true,
  frames = null,
}: {
  role: TransferRole
  /**
   * The real run's state for the role on screen — `useHandoffSend` when this
   * device sends, `useHandoffPull` when it receives from the phone.
   */
  stage: RunStage
  groups: readonly TransferGroup[]
  /** False when nothing is selected, which is the only reason to hold back. */
  canStart: boolean
  /** Lets the page put the WebGPU scene away — see Transfer's page options. */
  showScene?: boolean
  /**
   * The key, as frames of the animation itself.
   *
   * There is no code laid over the picture. The scene is a field of dots that
   * brighten and fade; these say which AREAS of it brighten, and cycling
   * through them says the key. Two surfaces — one showing a picture, one
   * showing a symbol — invited the reading that the picture was decoration,
   * and it was.
   */
  frames?: readonly PulseFrame[] | null
}) {
  const copy = stageCopy(role, stage)
  // Only while the key is the thing on screen to look at: never mid-run, when
  // the offer is in use. After a run that stopped it is shown again, because
  // that offer is either still the live one or the new code the panel tells
  // the person to scan — hiding it there left nothing to scan. Both roles:
  // receiving pairs exactly as sending does, by the phone reading this screen.
  const showing = showsOffer(stage) ? frames : null

  return (
    <section className="surface relative flex min-h-[24rem] flex-col overflow-hidden rounded-lg px-4 py-4 sm:px-5 sm:py-5">
      {/* Behind the words, never over them. With the scene put away the key
          still has to be on screen — the phone cannot pair without it — so
          the overlay the scene's own fallback uses draws it alone. */}
      {showScene ? <SceneBackdrop frames={showing} /> : <PulseOverlay frames={showing} />}

      {/* While a key is up the copy keeps clear of the overlay's column, so
          no word sits over a region the camera has to measure. The same
          width as the overlay in `PulseOverlay`, plus a gutter. */}
      <div
        className={cn(
          'relative flex flex-1 flex-col',
          showing !== null && 'pr-[calc(min(40%,17rem)+2rem)]',
        )}
      >
        <h2 className="text-lg font-medium">{copy.title}</h2>
        <p className="mt-1 max-w-md text-sm text-text-2">{copy.body}</p>

        {groups.length > 0 ? (
          <>
            <ul className="mt-4 max-w-xs space-y-1.5">
              {groups.map((group) => (
                <li key={group.id} className="flex items-center gap-2 text-sm">
                  {/* A dot, not a tick or a spinner. It marks a line in a list
                      of what is included; nothing about it is a status. */}
                  <span aria-hidden className="grid size-3.5 place-items-center">
                    <span className="size-1.5 rounded-full bg-hairline-strong" />
                  </span>
                  <span className={cn(stage === 'done' ? 'text-text-1' : 'text-text-2')}>
                    {group.label}
                  </span>
                  <span className="tabular ml-auto text-xs text-text-3">{group.count}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 max-w-md text-sm text-text-2">
              {role === 'receive'
                ? `${summarise(groups)} — that is what is on this computer now, and what your phone's records replace.`
                : stage === 'done'
                  ? `${summarise(groups)} — that is what is now on the other device.`
                  : `${summarise(groups)} — that is what will move.`}
            </p>
          </>
        ) : null}

        {stage === 'idle' ? (
          <div className="mt-auto pt-5">
            <p className="flex items-center gap-2 text-xs text-text-3">
              <Smartphone className="size-3.5 shrink-0" strokeWidth={1.8} aria-hidden />
              {role === 'receive' || canStart
                ? "Point your phone's camera at the pulsing pattern of light here — that is the key — and it then shows you a short code to type on the right."
                : 'Choose at least one group to send.'}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  )
}
