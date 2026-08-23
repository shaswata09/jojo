import { Smartphone } from 'lucide-react'
import { SceneBackdrop } from '@/components/transfer-ui/SceneBackdrop'
import type { PulseFrame } from '@jojo/service/core/pulse'
import { summarise, type TransferGroup } from '@/components/transfer-ui/groups'
import type { SendStage } from '@/lib/handoff-send'
import { cn } from '@/lib/utils'

export type TransferRole = 'send' | 'receive'

type Copy = { title: string; body: string }

/**
 * The one true thing about receiving in a browser.
 *
 * A web page cannot accept an inbound connection — `TCPServerSocket` exists
 * only for Isolated Web Apps — so this computer can never be the receiving end
 * of a live transfer, however both devices are connected. That is a platform
 * fact rather than a missing feature, which is why it is one sentence repeated
 * across every stage below instead of a sequence of states to walk through.
 * `ReceivePanel` carries what to do instead.
 */
const RECEIVE: Copy = {
  title: 'This computer cannot receive',
  body: 'A web page is not allowed to accept a connection, so a phone cannot reach this browser however both devices are connected. Send from the phone with a backup file instead, and open it under Settings.',
}

const COPY: Record<TransferRole, Record<SendStage, Copy>> = {
  send: {
    idle: {
      title: 'Waiting for the other device',
      body: 'Open jojo on your phone, choose Receive, and point its camera at this animation. The key is carried by the dots themselves — reading it agrees an encryption key between the two devices, and nothing is broadcast to do it.',
    },
    connecting: {
      title: 'Reaching your phone',
      body: 'Asking the address you typed for its half of the handshake. Nothing has been sent yet.',
    },
    packing: {
      title: 'Gathering your records',
      body: 'Reading everything in the list below out of this device. Still nothing on the network.',
    },
    sending: {
      title: 'Moving your records',
      body: 'Sealed chunks, straight to your phone over the local network. Progress is beside the code you typed.',
    },
    done: {
      title: 'Everything moved',
      body: 'Your phone now holds the records below. Nothing was removed from this device — a transfer is a copy.',
    },
    failed: {
      title: 'The transfer stopped',
      body: 'Nothing on this device has changed. What went wrong is written beside the code you typed.',
    },
  },
  receive: {
    idle: RECEIVE,
    connecting: RECEIVE,
    packing: RECEIVE,
    sending: RECEIVE,
    done: RECEIVE,
    failed: RECEIVE,
  },
}

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
  /** The real send state, straight from `useHandoffSend`. */
  stage: SendStage
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
  const copy = COPY[role][stage]
  // Only while the key is the thing on screen to look at. Once a phone has
  // answered, the offer it read is spent, and a card still cycling it would be
  // showing a key that pairs with nothing.
  const showing = role === 'send' && stage === 'idle' ? frames : null

  return (
    <section className="surface relative flex min-h-[24rem] flex-col overflow-hidden rounded-lg px-4 py-4 sm:px-5 sm:py-5">
      {/* Behind the words, never over them. */}
      {showScene ? <SceneBackdrop frames={showing} /> : null}

      <div className="relative flex flex-1 flex-col">
        <h2 className="text-lg font-medium">{copy.title}</h2>
        <p className="mt-1 max-w-md text-sm text-text-2">{copy.body}</p>

        {role === 'send' && groups.length > 0 ? (
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
              {stage === 'done'
                ? `${summarise(groups)} — that is what is now on the other device.`
                : `${summarise(groups)} — that is what will move.`}
            </p>
          </>
        ) : null}

        {role === 'send' && stage === 'idle' ? (
          <div className="mt-auto pt-5">
            <p className="flex items-center gap-2 text-xs text-text-3">
              <Smartphone className="size-3.5 shrink-0" strokeWidth={1.8} aria-hidden />
              {canStart
                ? 'Your phone reads the key from this animation, then shows you a short code to type on the right.'
                : 'Choose at least one group to send.'}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  )
}
