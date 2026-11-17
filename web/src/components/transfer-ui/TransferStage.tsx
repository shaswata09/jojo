import { useTranslation } from 'react-i18next'
import { Smartphone } from 'lucide-react'
import { SceneBackdrop } from '@/components/transfer-ui/SceneBackdrop'
import { PairingQrCard } from '@/components/transfer/PairingQrCard'
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
  offer = null,
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
   * The pairing offer (`encodeOffer`), drawn as a QR code beside the copy for
   * the phone to scan — the owner's decision of 2026-11-16 (Q329). The scene
   * behind is decoration and carries nothing.
   */
  offer?: Uint8Array | null
}) {
  const { t } = useTranslation('transfer')
  const copy = stageCopy(role, stage)
  // Only while the key is the thing on screen to look at: never mid-run, when
  // the offer is in use. After a run that stopped it is shown again, because
  // that offer is either still the live one or the new code the panel tells
  // the person to scan — hiding it there left nothing to scan. Both roles:
  // receiving pairs exactly as sending does, by the phone reading this screen.
  const showing = showsOffer(stage) ? offer : null

  return (
    <section className="surface relative flex min-h-[24rem] flex-col overflow-hidden rounded-lg px-4 py-4 sm:px-5 sm:py-5">
      {showScene ? <SceneBackdrop /> : null}

      {/* The code sits in its own column, beside the words and never under
          them: a QR code with copy over it is a QR code a camera cannot read,
          and copy over a QR code is copy nobody can read. Stacked under the
          copy on a narrow screen. */}
      <div className="relative flex flex-1 flex-col gap-5 sm:flex-row sm:items-center">
        <div className="relative flex min-w-0 flex-1 flex-col self-stretch">
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
                    <span className="tabular ms-auto text-xs text-text-3">{group.count}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 max-w-md text-sm text-text-2">
                {t(
                  role === 'receive'
                    ? 'stage.manifest.receive'
                    : stage === 'done'
                      ? 'stage.manifest.sent'
                      : 'stage.manifest.willMove',
                  { summary: summarise(groups) },
                )}
              </p>
            </>
          ) : null}

          {stage === 'idle' ? (
            <div className="mt-auto pt-5">
              <p className="flex items-center gap-2 text-xs text-text-3">
                <Smartphone className="size-3.5 shrink-0" strokeWidth={1.8} aria-hidden />
                {role === 'receive' || canStart ? t('stage.scanHint') : t('stage.chooseGroup')}
              </p>
            </div>
          ) : null}
        </div>

        {showing === null ? null : (
          <PairingQrCard offer={showing} className="mx-auto w-[min(100%,15rem)] shrink-0 sm:mx-0" />
        )}
      </div>
    </section>
  )
}
