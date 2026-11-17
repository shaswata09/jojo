import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { pairingQr, qrPath } from '@/lib/pairing-qr'
import { cn } from '@/lib/utils'

/**
 * The pairing offer, drawn as a QR code for the phone to scan.
 *
 * Dark modules on a white card in BOTH themes. A QR decoder expects dark on
 * light; an inverted code on the dark theme would be prettier and would fail on
 * the decoders that do not try both ways. The card is the one bright object on
 * a dark page, which is also what makes it easy to find through a viewfinder.
 *
 * The quiet zone is the card's padding — four modules, the width the standard
 * asks for — so nothing from the page behind can join the finder patterns.
 *
 * Crisp edges, no smoothing: anti-aliased module edges are grey a camera has
 * to guess about.
 */
export function PairingQrCard({ offer, className }: { offer: Uint8Array; className?: string }) {
  const { t } = useTranslation('transfer')
  const qr = useMemo(() => pairingQr(offer), [offer])
  const path = useMemo(() => qrPath(qr), [qr])
  const quiet = 4
  const box = qr.size + quiet * 2

  return (
    <div
      className={cn(
        'aspect-square w-full rounded-xl bg-white p-0 shadow-lg ring-1 ring-black/5',
        className,
      )}
    >
      <svg
        viewBox={`${-quiet} ${-quiet} ${box} ${box}`}
        role="img"
        aria-label={t('qr.label')}
        className="block size-full"
        shapeRendering="crispEdges"
      >
        <path d={path} fill="#000" />
      </svg>
    </div>
  )
}
