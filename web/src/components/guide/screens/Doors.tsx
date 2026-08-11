const NAV_ROWS = [30, 44, 58, 72, 86, 100]

/**
 * Where the six sidebar pages, the four status tiles and the four top-bar icons
 * actually go.
 *
 * A picture rather than the list underneath it, because the fact people are
 * missing is spatial: half of jojo hangs off two clusters of unlabelled icons —
 * a 2x2 grid at the foot of the sidebar and four squares at the right of the top
 * bar — and "the Graph is behind the tile marked Browser storage" is a sentence
 * you have to read three times if you have never noticed the tiles. The list
 * below is still the lookup; this is what makes the list findable.
 *
 * Drawn against the shell as it stands at `lg` and above. Below that the sidebar
 * is a drawer, which the prose says rather than the drawing: two frames side by
 * side at 390px would halve both.
 */
export function Doors() {
  return (
    <svg
      viewBox="0 0 340 176"
      role="img"
      aria-labelledby="doors-title doors-desc"
      className="h-auto w-full max-w-[460px]"
    >
      <title id="doors-title">Where each page is reached from</title>
      <desc id="doors-desc">
        The six rows down the sidebar open the Dashboard, Applications, Calendar, Vault, Job scout
        and Statistics. The four tiles beneath them open the Graph, Transfer and — for the bridge
        and the model — Settings. The four icons at the right of the top bar open My profile,
        Settings, the Assistant and this guide. Nothing in the sidebar list leads to those last six.
      </desc>

      {/* The two pieces of chrome. */}
      <rect
        x="4"
        y="4"
        width="86"
        height="168"
        rx="6"
        style={{ fill: 'var(--panel)', stroke: 'var(--hairline)' }}
      />
      <rect
        x="96"
        y="4"
        width="240"
        height="20"
        rx="6"
        style={{ fill: 'var(--panel)', stroke: 'var(--hairline)' }}
      />

      {/* Brand card, search field and the New button — recognisable furniture,
          and none of it a door this page is about. */}
      <rect x="10" y="10" width="74" height="14" rx="4" style={{ fill: 'var(--well)' }} />
      <rect x="102" y="8" width="94" height="12" rx="4" style={{ fill: 'var(--well)' }} />
      <text x="107" y="17" fontSize="7.5" style={{ fill: 'var(--text-3)' }} className="font-sans">
        Search…
      </text>
      <rect x="204" y="8" width="26" height="12" rx="4" style={{ fill: 'var(--well)' }} />
      <text x="209" y="17" fontSize="7.5" style={{ fill: 'var(--text-3)' }} className="font-sans">
        New
      </text>

      {/* Door one: the six nav rows. */}
      {NAV_ROWS.map((y) => (
        <rect
          key={y}
          x="10"
          y={y}
          width="74"
          height="10"
          rx="3"
          style={{ fill: 'var(--accent-soft)', stroke: 'var(--accent-border)' }}
        />
      ))}

      {/* Door two: the runtime tiles, two by two. */}
      {[
        [10, 126],
        [49, 126],
        [10, 143],
        [49, 143],
      ].map(([x, y]) => (
        <rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width="35"
          height="13"
          rx="3"
          style={{ fill: 'var(--accent-soft)', stroke: 'var(--accent-border)' }}
        />
      ))}

      {/* Door three: the four icons at the right of the top bar. */}
      {[264, 282, 300, 318].map((x) => (
        <rect
          key={x}
          x={x}
          y="8"
          width="12"
          height="12"
          rx="3"
          style={{ fill: 'var(--accent-soft)', stroke: 'var(--accent-border)' }}
        />
      ))}

      {/* Brackets, tying each cluster to its line of text. */}
      <g fill="none" style={{ stroke: 'var(--accent-border)' }} strokeWidth="1.2">
        <path d="M92 30 h4 v80 h-4" />
        <path d="M92 126 h4 v30 h-4" />
        <path d="M262 28 v4 h72 v-4" />
      </g>

      <g style={{ fill: 'var(--text-2)' }} className="font-sans">
        <text x="332" y="42" fontSize="10" textAnchor="end">
          My profile · Settings ·
        </text>
        <text x="332" y="55" fontSize="10" textAnchor="end">
          Assistant · How to use
        </text>
        <text x="102" y="76" fontSize="10">
          Dashboard · Applications · Calendar
        </text>
        <text x="102" y="89" fontSize="10">
          Vault · Job scout · Statistics
        </text>
        <text x="102" y="145" fontSize="10">
          Graph · Transfer · Settings
        </text>
      </g>
    </svg>
  )
}
