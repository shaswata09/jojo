import { useMemo } from 'react'
import { ClipboardList } from 'lucide-react'
import { EmptyState } from '@/components/common/EmptyState'
import { statsFor } from '@jojo/service/core/statistics'
import { useApplications } from '@jojo/service/react/use-applications'

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
  const { all } = useApplications()
  const { sent, kpis } = useMemo(() => statsFor(all), [all])

  if (sent === 0) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="No rates yet"
        description="Reply, interview and offer rates all count applications that have actually gone out. Move one out of Draft and this fills in."
      />
    )
  }

  return (
    // Two across rather than four: this renders in the dashboard's narrow
    // column as well as on the full-width Statistics page, and four tiles at
    // ~110px each put every label on three lines.
    <div className="grid grid-cols-2 gap-3">
      {kpis.map((k) => (
        <div key={k.label} className="surface rounded-lg px-4 py-3.5">
          <div className="text-xs text-text-2">{k.label}</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-semibold">{k.value}</span>
            {/* No arrow and no colour, for the reason the Statistics copy of
                this gives: a claim about change over time that the store has no
                history to support, painted in the two colours reserved for
                overdue and due-soon work. */}
            {showTypical ? <span className="text-xs text-text-3">{k.typical}</span> : null}
          </div>
          <div className="mt-1 text-xs text-text-3">{k.note}</div>
        </div>
      ))}
    </div>
  )
}
