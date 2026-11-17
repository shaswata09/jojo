import { useTranslation } from 'react-i18next'
import { RefreshCcw } from 'lucide-react'
import { handoverStatus } from '@jojo/service/core/handover'
import { useKg } from '@jojo/service/react/kg-context'
import { domain } from '@/i18n/domain'

/**
 * How far this device has drifted from the copy it last handed over.
 *
 * Transfer is manual, on demand and whole-store — records move from the phone
 * to this computer or from this computer to the phone, and either way the
 * receiving end is REPLACED, not merged. What nothing ever said is the
 * consequence: add a record here and another there, and the two stores can
 * never be reconciled, because the only merge on offer is a restore, which
 * replaces everything.
 *
 * So this states the number before the button that overwrites it. It is not
 * sync and does not pretend to be; it answers one question from two facts this
 * store already holds — when the last handover was, and what has been written
 * since.
 *
 * DELIBERATELY NOT A WARNING. Working on two devices between transfers is a
 * normal thing to do and the app has no business scolding anybody for it. The
 * tone is the same one Settings uses about backups: here is what is true, the
 * decision is yours.
 */
export function HandoverStatus() {
  const { t } = useTranslation('transfer')
  const { repo } = useKg()

  const status = handoverStatus(repo.meta.handoverAt, repo.audit, new Date().toISOString())

  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-hairline bg-well px-3 py-2.5">
      <RefreshCcw
        className={`mt-0.5 size-3.5 shrink-0 ${
          status.state === 'drifted' ? 'text-warning' : 'text-text-3'
        }`}
        strokeWidth={1.8}
        aria-hidden
      />
      <p className="text-xs text-text-2">
        {domain.handover(status)}
        {status.state === 'drifted' ? (
          <>
            {' '}
            <span className="text-text-3">{t('handover.sendingAgain')}</span>
          </>
        ) : null}
      </p>
    </div>
  )
}
