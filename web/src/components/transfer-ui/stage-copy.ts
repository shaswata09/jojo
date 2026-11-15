/**
 * What the stage card says, per direction and per stage.
 *
 * Pure and outside `TransferStage` so the words can be tested without
 * mounting it (D20) — and because the receive half used to be ONE sentence
 * repeated across every stage, "This computer cannot receive". That stopped
 * being true when the computer learned to pull the phone's records
 * (`core/handoff-pull.ts`): a browser still cannot be connected to, but it can
 * connect and ask, which is all receiving needs.
 *
 * Both directions say the same thing about the network, because it is the same
 * network: the phone listens on it, the computer dials the phone's private
 * address, and nothing in between relays. If the two are not on one local
 * network, nothing connects — the copy says that rather than "your wifi",
 * which is the commonest case and not the rule.
 */

import type { SendStage } from '@/lib/handoff-send'
import type { PullStage } from '@/lib/handoff-pull'
import type { RunStage } from '@/components/transfer-ui/send-cycle'

export type TransferRole = 'send' | 'receive'

export type StageCopy = { title: string; body: string }

/** One sentence both directions end their opening card with. */
export const SAME_NETWORK =
  'Both devices need to be on the same local network — the records go straight between them, with no server and no relay.'

const SEND: Record<SendStage, StageCopy> = {
  idle: {
    title: 'Waiting for the other device',
    body: `Open jojo on your phone, choose Transfer, then Receive from a computer, and point its camera at this animation. The key is carried by the dots themselves — reading it agrees an encryption key between the two devices, and nothing is broadcast to do it. ${SAME_NETWORK}`,
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
}

const RECEIVE: Record<PullStage, StageCopy> = {
  idle: {
    title: 'Waiting for your phone',
    body: `Open jojo on your phone, choose Transfer, then Send to a computer, and point its camera at this animation. Your phone then shows a short code to type on the right. ${SAME_NETWORK}`,
  },
  connecting: {
    title: 'Reaching your phone',
    body: 'Asking the address you typed for its half of the handshake. Nothing has been received yet.',
  },
  receiving: {
    title: "Receiving your phone's records",
    body: 'Sealed chunks, straight from your phone over the local network. Nothing on this computer changes until you agree to it.',
  },
  confirming: {
    title: 'Everything arrived',
    body: "Your phone's records arrived and checked out. Nothing here has changed yet — say whether they should replace what is on this computer.",
  },
  restoring: {
    title: 'Replacing the records here',
    body: 'Writing what your phone sent over what was on this computer.',
  },
  done: {
    title: 'Everything moved',
    body: "This computer now holds your phone's records. Nothing was removed from the phone — a transfer is a copy.",
  },
  failed: {
    title: 'The transfer stopped',
    body: 'Nothing on this computer has changed. What went wrong is written beside the code you typed.',
  },
}

/**
 * The card's words for a role and a stage.
 *
 * A stage that does not belong to the role — the page passes the stage of the
 * run for the role on screen, so this is a mistake rather than a state — falls
 * back to that role's waiting card rather than to the other direction's words.
 */
export function stageCopy(role: TransferRole, stage: RunStage): StageCopy {
  if (role === 'send') return SEND[stage as SendStage] ?? SEND.idle
  return RECEIVE[stage as PullStage] ?? RECEIVE.idle
}
