import type { ReactNode } from 'react'
import { Panel } from '@/components/common/Panel'

/**
 * A card on the Settings page, a plain block inside a dialog.
 *
 * The first run already has chrome around it, and a card inside a card is the
 * tell that a settings panel has been reused somewhere it was not drawn for.
 */
export function Shell({
  bare,
  tour,
  focusId,
  children,
}: {
  bare: boolean
  /** The guided tour's mark for the card (components/tour); not on the bare form. */
  tour?: string
  /** The card's address for search (see `Panel`); not on the bare form either. */
  focusId?: string
  children: ReactNode
}) {
  return bare ? (
    <div className="space-y-3">{children}</div>
  ) : (
    <Panel data-tour={tour} focusId={focusId}>
      {children}
    </Panel>
  )
}
