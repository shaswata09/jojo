import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { DASH } from '@/components/guide/diagrams/marks'
import { Box, Connector, Rule } from '@/components/guide/diagrams/parts'
import { CATALOG } from '@jojo/service/agent/catalog'

/**
 * The path a request takes, and the two places it can be stopped.
 *
 * This is the figure that has to carry the distinction people get wrong about
 * every system like this: choosing what to OFFER is a hint, and checking what
 * was CALLED is a rule. A model can emit any name it likes regardless of what
 * it was shown — small ones routinely do — so a design that only narrows the
 * list has narrowed nothing that matters.
 *
 * Both gates are drawn, in the order they act, with the second marked as the
 * one that actually holds. The two side-branches are the honest outcomes: an
 * unclear question skips the first gate entirely, and a name that was never
 * offered dies at the second.
 *
 * Top-to-bottom here, unlike `ToolGraphDiagram`, because this genuinely IS a
 * sequence — and the order is the content.
 */

/*
 * Read from the catalog, not typed.
 *
 * This said "all 82" and was wrong within a day of being written — four tools
 * were added and the figure carried on claiming a number that had stopped being
 * true. A count in a diagram is exactly as prone to going stale as a count in
 * prose, and this page argues that jojo does not let that happen.
 *
 * The words are catalog KEYS (`guideReference:diagrams.toolGate.*`), translated
 * where the figure draws them, so the table never freezes in one language.
 */
const STEPS = [
  { label: 'typed', tone: 'plain' as const, note: '' },
  { label: 'pick', tone: 'gate' as const, note: 'pickNote' },
  { label: 'needs', tone: 'plain' as const, note: 'needsNote' },
  { label: 'chooses', tone: 'plain' as const, note: '' },
  { label: 'offered', tone: 'stop' as const, note: 'offeredNote' },
  { label: 'change', tone: 'plain' as const, note: '' },
]

const TOP = 26
const PITCH = 56
const H = 32
const W = 190

export function ToolGateDiagram() {
  const { t } = useTranslation('guideReference')
  const total = String(CATALOG.length)
  const titleId = useId()
  const descId = useId()
  const height = TOP + STEPS.length * PITCH

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 420 ${String(height)}`}
        className="diagram h-auto w-full max-w-[520px]"
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
      >
        <title id={titleId}>{t('diagrams.toolGate.title')}</title>
        <desc id={descId}>{t('diagrams.toolGate.desc')}</desc>

        {STEPS.map((step, i) => {
          const y = TOP + i * PITCH
          const mid = y + H / 2
          const stroke =
            step.tone === 'stop'
              ? 'var(--danger)'
              : step.tone === 'gate'
                ? 'var(--accent)'
                : 'var(--hairline-strong)'
          return (
            <g key={step.label}>
              <Box
                x={4}
                y={y}
                w={W}
                h={H}
                stroke={stroke}
                width={step.tone === 'plain' ? 1 : 1.5}
              />
              <text x={14} y={mid + 4} fontSize={11} fill="var(--text-1)">
                {t(`diagrams.toolGate.${step.label}`)}
              </text>

              {/* The escape, drawn as a branch off to the right rather than as a
                  step of its own: neither of these continues down the column,
                  and drawing them inline would imply they do. */}
              {step.note ? (
                <>
                  <Rule x1={W + 8} y1={mid} x2={228} y2={mid} stroke={stroke} dash={DASH.soft} />
                  <text x={234} y={mid + 4} fontSize={10} fill="var(--text-2)">
                    {t(`diagrams.toolGate.${step.note}`, { total })}
                  </text>
                </>
              ) : null}

              {i < STEPS.length - 1 ? (
                <Connector from={[W / 2, y + H]} to={[W / 2, y + PITCH]} dir="down" />
              ) : null}
            </g>
          )
        })}
      </svg>
      <figcaption className="mt-2 text-xs text-text-3">{t('diagrams.toolGate.caption')}</figcaption>
    </figure>
  )
}
