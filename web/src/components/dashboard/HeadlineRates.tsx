import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ClipboardList } from 'lucide-react'
import { EmptyState } from '@/components/common/EmptyState'
import { statsFor } from '@jojo/service/core/statistics'
import { useScopedApplications } from '@/lib/roles-scope'
import { useDomain } from '@/i18n/domain'

/**
 * The four headline rates — reply, interview, offer and the rest.
 *
 * The tiles were written inline in `routes/Statistics.tsx` and could only ever
 * appear there. `StatsCard` needed the same four on the dashboard, and the
 * choice was to copy the markup or to lift it; `statsFor` was already a pure
 * function in the service package, so lifting cost nothing and a copy would have
 * been the second definition of what "reply rate" means.
 *
 * Rendered only once something has actually been sent. A rate over an empty
 * denominator is a made-up number, and 0% is a claim rather than an absence —
 * the same reason Statistics guards the section it used to live in.
 */
export function HeadlineRatesBody({ showTypical = false }: { showTypical?: boolean }) {
  const { t } = useTranslation('dashboard')
  const domain = useDomain()
  const { all } = useScopedApplications()
  const { sent, kpis } = useMemo(() => statsFor(all), [all])

  if (sent === 0) {
    return (
      <EmptyState
        icon={ClipboardList}
        title={t('headlineRates.emptyTitle')}
        description={t('headlineRates.emptyDescription')}
      />
    )
  }

  return (
    // Two across rather than four: this renders in the dashboard's narrow
    // column as well as on the full-width Statistics page, and four tiles at
    // ~110px each put every label on three lines.
    <div className="grid grid-cols-2 gap-3">
      {kpis.map((k) => {
        const said = domain.kpi(k)
        return (
          <div key={k.id} className="surface rounded-lg px-4 py-3.5">
            <div className="text-xs text-text-2">{said.label}</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-semibold">{said.value}</span>
              {/* No arrow and no colour, for the reason the Statistics copy of
                this gives: a claim about change over time that the store has no
                history to support, painted in the two colours reserved for
                overdue and due-soon work. */}
              {showTypical ? <span className="text-xs text-text-3">{said.typical}</span> : null}
            </div>
            <div className="mt-1 text-xs text-text-3">{said.note}</div>
          </div>
        )
      })}
    </div>
  )
}
