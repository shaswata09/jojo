import { useId } from 'react'
import { Box, Connector, DASH } from '@/components/guide/diagrams/parts'

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
        <title id={titleId}>One sentence, two records, and the wrong one changed</title>
        <desc id={descId}>
          At the top, the request: close the UT application, they turned me down. Below it, two
          records that both match — UT Austin, still submitted and live, and UT Dallas, already
          closed. Nothing in the sentence distinguishes them. The correct response is to ask which
          one; four of six benchmark runs instead closed UT Austin, the live application. The tool
          they chose was the right tool. The record they applied it to was not.
        </desc>

        {/* The sentence. Quoted, because the ambiguity is a property of the
            words rather than of the store. */}
        <Box x={LEFT} y={8} w={388} h={34} fill="var(--well)" />
        <text x={LEFT + 12} y={30} fontSize={11.5} fill="var(--text-1)">
          “Close the UT application — they turned me down.”
        </text>

        <Connector from={[LEFT + 94, 42]} to={[LEFT + 94, CARDS_Y]} dir="down" />
        <Connector from={[RIGHT + 88, 42]} to={[RIGHT + 88, CARDS_Y]} dir="down" />
        <text x={168} y={62} fontSize={9.5} fill="var(--text-3)">
          matches both
        </text>

        {/* The live one, marked as damaged. */}
        <Box x={LEFT} y={CARDS_Y} w={CARD_W} h={CARD_H} stroke="var(--danger)" width={1.5} />
        <text x={LEFT + 12} y={CARDS_Y + 20} fontSize={11} fill="var(--text-1)">
          UT Austin
        </text>
        <text x={LEFT + 12} y={CARDS_Y + 36} fontSize={10} fill="var(--text-2)">
          submitted — still live
        </text>
        <text x={LEFT + 12} y={CARDS_Y + 76} fontSize={10.5} fill="var(--danger)">
          closed by 4 of 6 runs
        </text>

        {/* The one that was already closed, and would have been harmless. */}
        <Box x={RIGHT} y={CARDS_Y} w={CARD_W} h={CARD_H} dash={DASH.soft} />
        <text x={RIGHT + 12} y={CARDS_Y + 20} fontSize={11} fill="var(--text-1)">
          UT Dallas
        </text>
        <text x={RIGHT + 12} y={CARDS_Y + 36} fontSize={10} fill="var(--text-2)">
          already closed
        </text>
        <text x={RIGHT + 12} y={CARDS_Y + 76} fontSize={10.5} fill="var(--text-3)">
          the one they meant
        </text>

        <text x={LEFT} y={194} fontSize={10} fill="var(--text-3)">
          The tool was right. The record was not — and no tool-choice score can see the difference.
        </text>
      </svg>
      <figcaption className="mt-2 text-xs text-text-3">
        jojo&rsquo;s own instruction tells the model to ask when a request could mean more than one
        record. Two of the three models wrote anyway.
      </figcaption>
    </figure>
  )
}
