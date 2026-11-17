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

import { i18next } from '@/i18n/i18n'
import type { SendStage } from '@/lib/handoff-send'
import type { PullStage } from '@/lib/handoff-pull'
import type { RunStage } from '@/components/transfer-ui/send-cycle'

export type TransferRole = 'send' | 'receive'

export type StageCopy = { title: string; body: string }

/** One sentence both directions end their opening card with. */
export const sameNetwork = (): string => i18next.t('transfer:stage.sameNetwork')

/** The stages each role has words for — the keys under `stage.<role>` in the catalog. */
const SEND: ReadonlySet<SendStage> = new Set<SendStage>([
  'idle',
  'connecting',
  'packing',
  'sending',
  'done',
  'failed',
])

const RECEIVE: ReadonlySet<PullStage> = new Set<PullStage>([
  'idle',
  'connecting',
  'receiving',
  'confirming',
  'restoring',
  'done',
  'failed',
])

const copyOf = (role: TransferRole, stage: RunStage): StageCopy => ({
  title: i18next.t(`transfer:stage.${role}.${stage}.title`),
  body: i18next.t(`transfer:stage.${role}.${stage}.body`, { sameNetwork: sameNetwork() }),
})

/**
 * The card's words for a role and a stage.
 *
 * A stage that does not belong to the role — the page passes the stage of the
 * run for the role on screen, so this is a mistake rather than a state — falls
 * back to that role's waiting card rather than to the other direction's words.
 */
export function stageCopy(role: TransferRole, stage: RunStage): StageCopy {
  if (role === 'send') return copyOf('send', SEND.has(stage as SendStage) ? stage : 'idle')
  return copyOf('receive', RECEIVE.has(stage as PullStage) ? stage : 'idle')
}
