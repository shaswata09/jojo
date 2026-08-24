import { useId } from 'react'

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
  /** What it cannot run without. */
  needs: string
  /** The tool that makes one. */
  pulled: string
}

const PULLS: Pull[] = [
  { asked: 'keyword.attach', needs: 'a keyword', pulled: 'keyword.create' },
  { asked: 'vault.file.update', needs: 'a file', pulled: 'vault.file.add' },
  { asked: 'scout.posting.promote', needs: 'a posting', pulled: 'scout.posting.save' },
]

export function ToolGraphDiagram() {
  const titleId = useId()
  const descId = useId()
  const height = TOP + PULLS.length * ROW + 54

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 440 ${String(height)}`}
        className="h-auto w-full max-w-[560px]"
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
      >
        <title id={titleId}>How one tool pulls in the tool that feeds it</title>
        <desc id={descId}>
          Three rows, each read left to right. In the first, asking for
          keyword.attach pulls in keyword.create, because attaching a keyword needs a keyword that
          already exists. In the second, vault.file.update pulls in vault.file.add, because updating
          a document needs a document. In the third, scout.posting.promote pulls in
          scout.posting.save, because promoting a saved posting needs a saved posting. In every
          case jojo works the dependency out from the tool&rsquo;s own input, and offers both tools
          together — so the assistant is never handed a first step with no way to reach the second.
        </desc>

        <text x={8} y={18} fontSize={11} fill="var(--text-3)">
          what you asked for
        </text>
        <text x={186} y={18} fontSize={11} fill="var(--text-3)">
          what it needs
        </text>
        <text x={300} y={18} fontSize={11} fill="var(--text-3)">
          offered with it
        </text>

        {PULLS.map((pull, i) => {
          const y = TOP + i * ROW
          const mid = y + BOX_H / 2
          return (
            <g key={pull.asked}>
              <rect
                x={4}
                y={y}
                width={BOX_W}
                height={BOX_H}
                rx={7}
                fill="var(--well)"
                stroke="var(--hairline-strong)"
              />
              <text x={12} y={mid + 4} fontSize={10.5} fontFamily="ui-monospace, monospace" fill="var(--text-1)">
                {pull.asked}
              </text>

              {/* The requirement, sitting on the arrow rather than beside it —
                  at 390px a separate column of prose wraps to two lines and the
                  row stops reading as one sentence. */}
              <line
                x1={BOX_W + 8}
                y1={mid}
                x2={294}
                y2={mid}
                stroke="var(--hairline-strong)"
                strokeWidth={1}
              />
              <path d={`M 294 ${String(mid)} l -6 -3.5 v 7 z`} fill="var(--hairline-strong)" />
              <text x={190} y={mid - 6} fontSize={10} fill="var(--text-2)">
                {pull.needs}
              </text>

              <rect
                x={298}
                y={y}
                width={BOX_W}
                height={BOX_H}
                rx={7}
                fill="var(--well)"
                stroke="var(--accent)"
              />
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
          Without this, the assistant could be offered the first box and not the second —
        </text>
        <text x={8} y={height - 8} fontSize={10.5} fill="var(--text-3)">
          and would stop halfway with nothing on screen to say why.
        </text>
      </svg>
      <figcaption className="mt-2 text-xs text-text-3">
        jojo reads each requirement out of the tool&rsquo;s own definition, so a tool added tomorrow
        is covered without anybody updating a list.
      </figcaption>
    </figure>
  )
}
