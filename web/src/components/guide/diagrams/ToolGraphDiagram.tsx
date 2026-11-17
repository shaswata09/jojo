import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Box, Connector } from '@/components/guide/diagrams/parts'

/**
 * Why the assistant is never offered a tool it cannot finish using.
 *
 * The figure answers one question and deliberately not two: given that jojo
 * hides most of its tools most of the time, how does it avoid hiding one that
 * the visible ones depend on?
 *
 * `keyword.attach` is the right example because the dependency is invisible in
 * the name. Nothing about "attach a keyword" says it needs a keyword that
 * already exists, and a person reading the tool list would not spot it either —
 * which is exactly why the app derives the answer from the schema rather than
 * asking anybody to remember it.
 *
 * The middle column is the point. A tool needs an ID of some kind; something
 * else makes IDs of that kind; so the second is pulled in behind the first,
 * automatically, every time. The dashed box says what would happen without it.
 *
 * Drawn left-to-right rather than top-down, unlike `ToolTraceDiagram`, because
 * this is a dependency and not a sequence — nothing here happens before
 * anything else, and a vertical stack would have implied an order that does not
 * exist.
 */

const ROW = 74
const TOP = 46
const BOX_W = 132
const BOX_H = 34

type Pull = {
  /** The tool somebody's words asked for. */
  asked: string
  /** What it cannot run without — a catalog key under `diagrams.toolGraph`. */
  needs: string
  /** The tool that makes one. */
  pulled: string
}

const PULLS: Pull[] = [
  { asked: 'keyword.attach', needs: 'needsKeyword', pulled: 'keyword.create' },
  { asked: 'vault.file.update', needs: 'needsFile', pulled: 'vault.file.add' },
  { asked: 'scout.posting.promote', needs: 'needsPosting', pulled: 'scout.posting.save' },
]

export function ToolGraphDiagram() {
  const { t } = useTranslation('guideReference')
  const [withoutFirst, withoutSecond] = t('diagrams.toolGraph.without').split('\n')
  const titleId = useId()
  const descId = useId()
  const height = TOP + PULLS.length * ROW + 54

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 440 ${String(height)}`}
        className="diagram h-auto w-full max-w-[560px]"
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
      >
        <title id={titleId}>{t('diagrams.toolGraph.title')}</title>
        <desc id={descId}>{t('diagrams.toolGraph.desc')}</desc>

        <text x={8} y={18} fontSize={11} fill="var(--text-3)">
          {t('diagrams.toolGraph.asked')}
        </text>
        <text x={186} y={18} fontSize={11} fill="var(--text-3)">
          {t('diagrams.toolGraph.needsHeader')}
        </text>
        <text x={300} y={18} fontSize={11} fill="var(--text-3)">
          {t('diagrams.toolGraph.offered')}
        </text>

        {PULLS.map((pull, i) => {
          const y = TOP + i * ROW
          const mid = y + BOX_H / 2
          return (
            <g key={pull.asked}>
              <Box x={4} y={y} w={BOX_W} h={BOX_H} />
              <text
                x={12}
                y={mid + 4}
                fontSize={10.5}
                fontFamily="ui-monospace, monospace"
                fill="var(--text-1)"
              >
                {pull.asked}
              </text>

              {/* The requirement, sitting on the arrow rather than beside it —
                  at 390px a separate column of prose wraps to two lines and the
                  row stops reading as one sentence. */}
              <Connector from={[BOX_W + 8, mid]} to={[298, mid]} dir="right" />
              <text x={190} y={mid - 6} fontSize={10} fill="var(--text-2)">
                {t(`diagrams.toolGraph.${pull.needs}`)}
              </text>

              <Box x={298} y={y} w={BOX_W} h={BOX_H} stroke="var(--accent)" />
              <text
                x={306}
                y={mid + 4}
                fontSize={10.5}
                fontFamily="ui-monospace, monospace"
                fill="var(--text-1)"
              >
                {pull.pulled}
              </text>
            </g>
          )
        })}

        {/* The counterfactual, said once at the bottom rather than drawn as a
            fourth row: a broken chain has no picture, which is the problem. */}
        <text x={8} y={height - 22} fontSize={10.5} fill="var(--text-3)">
          {withoutFirst}
        </text>
        <text x={8} y={height - 8} fontSize={10.5} fill="var(--text-3)">
          {withoutSecond}
        </text>
      </svg>
      <figcaption className="mt-2 text-xs text-text-3">
        {t('diagrams.toolGraph.caption')}
      </figcaption>
    </figure>
  )
}
