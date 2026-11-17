import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { DASH } from '@/components/guide/diagrams/marks'
import { Box, Connector } from '@/components/guide/diagrams/parts'

/**
 * The failure the benchmark was built to catch, drawn once.
 *
 * "Close the UT application — they turned me down" matches two records. One is
 * already closed; the other is live. There is no correct write, only a correct
 * question — and four of six benchmark runs wrote anyway, closing an
 * application that was still open.
 *
 * This is the figure that has to make one thing obvious: the model was not
 * confused about tools. It picked `application.stage.set`, which is exactly
 * right, and applied it to the wrong record. A tool-choice score cannot see
 * that, which is why the whole benchmark exists — and why this diagram sits
 * beside the results rather than in the design section above.
 *
 * The two records are drawn identically apart from their state, because that IS
 * the situation: nothing in the sentence distinguishes them, and a reader who
 * can tell them apart at a glance has been shown the wrong picture.
 */

const CARD_W = 176
const CARD_H = 52
const LEFT = 6
const RIGHT = 218
const CARDS_Y = 74

export function BenchAmbiguityDiagram() {
  const { t } = useTranslation('guideReference')
  const titleId = useId()
  const descId = useId()

  return (
    <figure className="m-0">
      <svg
        viewBox="0 0 420 208"
        className="diagram h-auto w-full max-w-[540px]"
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
      >
        <title id={titleId}>{t('diagrams.benchAmbiguity.title')}</title>
        <desc id={descId}>{t('diagrams.benchAmbiguity.desc')}</desc>

        {/* The sentence. Quoted, because the ambiguity is a property of the
            words rather than of the store. */}
        <Box x={LEFT} y={8} w={388} h={34} fill="var(--well)" />
        <text x={LEFT + 12} y={30} fontSize={11.5} fill="var(--text-1)">
          {t('diagrams.benchAmbiguity.quote')}
        </text>

        <Connector from={[LEFT + 94, 42]} to={[LEFT + 94, CARDS_Y]} dir="down" />
        <Connector from={[RIGHT + 88, 42]} to={[RIGHT + 88, CARDS_Y]} dir="down" />
        <text x={168} y={62} fontSize={9.5} fill="var(--text-3)">
          {t('diagrams.benchAmbiguity.matchesBoth')}
        </text>

        {/* The live one, marked as damaged. */}
        <Box x={LEFT} y={CARDS_Y} w={CARD_W} h={CARD_H} stroke="var(--danger)" width={1.5} />
        <text x={LEFT + 12} y={CARDS_Y + 20} fontSize={11} fill="var(--text-1)">
          UT Austin
        </text>
        <text x={LEFT + 12} y={CARDS_Y + 36} fontSize={10} fill="var(--text-2)">
          {t('diagrams.benchAmbiguity.austinState')}
        </text>
        <text x={LEFT + 12} y={CARDS_Y + 76} fontSize={10.5} fill="var(--danger)">
          {t('diagrams.benchAmbiguity.austinRuns')}
        </text>

        {/* The one that was already closed, and would have been harmless. */}
        <Box x={RIGHT} y={CARDS_Y} w={CARD_W} h={CARD_H} dash={DASH.soft} />
        <text x={RIGHT + 12} y={CARDS_Y + 20} fontSize={11} fill="var(--text-1)">
          UT Dallas
        </text>
        <text x={RIGHT + 12} y={CARDS_Y + 36} fontSize={10} fill="var(--text-2)">
          {t('diagrams.benchAmbiguity.dallasState')}
        </text>
        <text x={RIGHT + 12} y={CARDS_Y + 76} fontSize={10.5} fill="var(--text-3)">
          {t('diagrams.benchAmbiguity.dallasMeant')}
        </text>

        <text x={LEFT} y={194} fontSize={10} fill="var(--text-3)">
          {t('diagrams.benchAmbiguity.footer')}
        </text>
      </svg>
      <figcaption className="mt-2 text-xs text-text-3">
        {t('diagrams.benchAmbiguity.caption')}
      </figcaption>
    </figure>
  )
}
