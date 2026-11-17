import type { SendState } from '@/lib/handoff-send'
import { i18next } from '@/i18n/i18n'

/**
 * What a finished send says, from what the phone's person did with it. The
 * computer stamps its handover only on `applied` (`handoff-send.ts`).
 */
export function doneSentence(send: Pick<SendState, 'target' | 'outcome'>): string {
  const target = send.target
  switch (send.outcome) {
    case 'applied':
      return target === null
        ? i18next.t('transfer:done.applied')
        : i18next.t('transfer:done.appliedAt', { target })
    case 'declined':
      return i18next.t('transfer:done.declined')
    case 'failed':
      return i18next.t('transfer:done.failed')
    case 'unknown':
      return target === null
        ? i18next.t('transfer:done.unknown')
        : i18next.t('transfer:done.unknownTo', { target })
    default:
      return target === null
        ? i18next.t('transfer:done.waiting')
        : i18next.t('transfer:done.waitingTo', { target })
  }
}
