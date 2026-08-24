import { DASH } from '@/components/guide/diagrams/parts'
/**
 * What happens between pressing Save and the record being on disk.
 *
 * Worth a picture because the shape is counter-intuitive and everything else on
 * the page depends on the reader having it: nothing in jojo waits on the disk,
 * which is why there are no spinners, why closing the tab is safe, and — the
 * part people get wrong — why the banner about a failed write does not offer a
 * Reload button. A change that has not reached the database is still in the
 * queue, and reloading is how you throw it away.
 *
 * The failure branch is the reason this is a diagram rather than a sentence.
 * Three boxes in a row is a list; three boxes with a dashed branch off the last
 * one is the thing being explained.
 */
/**
 * The boxes were laid out at `x = index * 120` with width 100 inside a
 * `0 0 340 124` viewBox, so the first box began at exactly x=0 and the last
 * ended at exactly x=340. A stroke straddles its path, so half of each 1-unit
 * outer border fell outside the box the browser clips to: "You press Save" lost
 * its left edge and "Saved in this browser" lost its right, and the three boxes
 * read as two closed and one open. Two units of margin on each side, and the
 * viewBox widened by the same four, so nothing else on the drawing moves
 * relative to the boxes.
 */
const SAVE_INSET = 2
const SAVE_BOX_W = 100
const SAVE_BOX_STEP = 120

export function SavePath() {
  const boxes = [
    ['You press', 'Save'],
    ['On screen,', 'at once'],
    ['Saved in this', 'browser'],
  ]

  const boxX = (index: number) => SAVE_INSET + index * SAVE_BOX_STEP
  const width = SAVE_INSET * 2 + (boxes.length - 1) * SAVE_BOX_STEP + SAVE_BOX_W
  /** The right edge of the last box, which the failure branch hangs off. */
  const lastRight = boxX(boxes.length - 1) + SAVE_BOX_W

  return (
    <svg
      viewBox={`0 0 ${width} 124`}
      role="img"
      aria-labelledby="save-path-title save-path-desc"
      className="diagram h-auto w-full max-w-lg"
    >
      <title id="save-path-title">What happens when you save something</title>
      <desc id="save-path-desc">
        Pressing Save changes what is on screen at once, and the write is queued and made to the
        browser&rsquo;s database a moment later. If that write fails, the change is kept in the
        queue and reported in a strip above the page rather than being thrown away.
      </desc>

      {boxes.map(([first, second], index) => {
        const x = boxX(index)
        return (
          <g key={first}>
            <rect
              x={x}
              y="8"
              width={SAVE_BOX_W}
              height="40"
              rx="8"
              style={{ fill: 'var(--well)', stroke: 'var(--hairline)' }}
            />
            <text
              x={x + 50}
              y="27"
              fontSize="11"
              textAnchor="middle"
              style={{ fill: 'var(--text-1)' }}
              className="font-sans"
            >
              {first}
            </text>
            <text
              x={x + 50}
              y="41"
              fontSize="11"
              textAnchor="middle"
              style={{ fill: 'var(--text-1)' }}
              className="font-sans"
            >
              {second}
            </text>
          </g>
        )
      })}

      {/* The arrow sits in the gap after each box but the last, so it is
          derived from the same layout rather than from two numbers that were
          right until the boxes moved. */}
      {boxes.slice(0, -1).map((box, index) => {
        const x = boxX(index) + SAVE_BOX_W
        return (
          <g key={box[0]} style={{ fill: 'var(--text-3)', stroke: 'var(--text-3)' }}>
            <line x1={x + 2} y1="28" x2={x + 12} y2="28" strokeWidth="1.5" />
            <polygon points={`${x + 18},28 ${x + 11},24.5 ${x + 11},31.5`} stroke="none" />
          </g>
        )
      })}

      <line
        x1={lastRight - SAVE_BOX_W / 2}
        y1="48"
        x2={lastRight - SAVE_BOX_W / 2}
        y2="72"
        style={{ stroke: 'var(--warning-border)' }}
        strokeWidth="1.5"
        strokeDasharray={DASH.soft}
      />
      <rect
        x={lastRight - 170}
        y="72"
        width="170"
        height="46"
        rx="8"
        fill="none"
        style={{ stroke: 'var(--warning-border)' }}
        strokeDasharray={DASH.soft}
      />
      <text
        x={lastRight - 158}
        y="94"
        fontSize="10"
        style={{ fill: 'var(--warning)' }}
        className="font-sans"
      >
        A write that fails is kept
      </text>
      <text
        x={lastRight - 158}
        y="107"
        fontSize="10"
        style={{ fill: 'var(--warning)' }}
        className="font-sans"
      >
        and reported, not dropped.
      </text>
    </svg>
  )
}
