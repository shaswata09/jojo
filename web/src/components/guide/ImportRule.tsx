import { useId } from 'react'

/**
 * The import rule, and the two scripts that enforce it.
 *
 * A six-box stack of layer names was drawn first and thrown away: it restated a
 * list, and a list is what prose is for. What prose cannot carry cheaply is the
 * DIRECTION — that every arrow points one way and there are none going back —
 * and the two brackets, which are the reason the direction survives contact
 * with an editor's auto-import. So the boxes are the least interesting thing
 * here and are drawn as plainly as possible; the arrows and the brackets are
 * the content.
 *
 * Hand-rolled SVG, like the donut and the radar on the statistics page. No
 * chart library, no external request: the app's whole claim is that nothing
 * leaves the device, and a diagram that phoned home for a runtime would be the
 * one place on the page contradicting the page.
 *
 * COLOUR comes from CSS custom properties, never from hex. The guide is read in
 * both themes and a hardcoded #1c1c1c stroke is invisible in one of them —
 * `currentColor` and `var(--…)` are re-evaluated by the browser when the theme
 * attribute flips, with no JavaScript and no second copy of the drawing.
 *
 * SIZE: one viewBox, scaled by the container. `w-full` with `h-auto` means the
 * drawing shrinks to a 390px phone rather than forcing the page sideways, and
 * `max-w` stops it growing to billboard size in a wide panel. Type is set at 11
 * and 9.5 user units so that at the narrowest it lands around 9px rather than
 * disappearing.
 *
 * ACCESSIBILITY: `role="img"` with a title and a description, and — because a
 * description a screen reader has to hold in its head is not documentation —
 * the same facts are repeated as ordinary prose beneath it, visible to
 * everyone. The description has to state what the picture states, so when the
 * drawing was corrected below the description was corrected with it; the old
 * one said "every import arrow points downward and none points back up" beside
 * a drawing that no longer has an arrow in every gap, which left the text
 * alternative describing a figure nobody could see any more.
 * The ids are minted per instance: two copies of this figure on one page with
 * the same `aria-labelledby` target would both point at the first.
 */

type Band = {
  tier: string
  name: string
  note: string
  /** The two exceptions. Everything interesting on this drawing is an exception. */
  accent?: true
  /**
   * What goes in the gap UNDER this band.
   *
   * Every gap used to get an arrowhead, which put one between `core` and
   * `storage` and drew an import the lint rule forbids: `check-layers.mjs`
   * allows `core` only `['core']` and `storage` only `['storage']`, so neither
   * can name the other — `repo` is what imports both. The stack is a partial
   * order, not a chain, and a drawing that fills in every gap claims it is a
   * chain. So the gaps are declared one at a time and the one real absence is
   * labelled rather than left as a space the eye closes up on its own.
   */
  below?: { kind: 'imports' } | { kind: 'note'; lines: readonly [string, string] }
}

const BANDS: Band[] = [
  {
    tier: 'L4',
    name: 'react',
    note: 'the binding — hooks, providers, projections',
    below: { kind: 'imports' },
  },
  {
    tier: 'L3',
    name: 'tools',
    note: '62 named writes, one per operation',
    // Narrow, and the drawing does not have room to say how narrow: what tools
    // may name is `repo/repository` and `repo/journal`, the interface and the
    // journal shape, never a driver or the live singleton. The caption says so.
    below: { kind: 'imports' },
  },
  {
    tier: 'L2',
    name: 'repo',
    note: 'the only layer allowed to be async',
    accent: true,
    below: { kind: 'imports' },
  },
  {
    tier: 'L1',
    name: 'core',
    note: 'imports nothing — not even React',
    below: {
      kind: 'note',
      lines: ['core and storage never import each other', 'repo is what imports both'],
    },
  },
  { tier: 'L0', name: 'storage', note: 'the only layer allowed a platform API', accent: true },
]

const BAND_H = 34
const BAND_GAP = 10
/** Wide enough for two lines of 9.5 without either touching a band. */
const NOTE_GAP = 32
const TOP = 26
const BAND_X = 74
const BAND_W = 232
const BAND_MID = BAND_X + BAND_W / 2

const gapUnder = (band: Band) => (band.below?.kind === 'note' ? NOTE_GAP : BAND_GAP)

/**
 * Band tops, accumulated rather than multiplied out.
 *
 * The gaps are no longer all the same height, so `TOP + index * (h + gap)` is
 * off by 22 for every band under the annotated one.
 */
const BAND_Y: number[] = []
let cursor = TOP
for (const band of BANDS) {
  BAND_Y.push(cursor)
  cursor += BAND_H + gapUnder(band)
}

function bandY(index: number) {
  return BAND_Y[index] ?? TOP
}

const HEIGHT = bandY(BANDS.length - 1) + BAND_H + 10

export function ImportRule() {
  const id = useId()
  const titleId = `${id}-title`
  const descId = `${id}-desc`

  /** The platform bracket covers the four portable layers — everything but storage. */
  const platformTop = bandY(0)
  const platformBottom = bandY(3) + BAND_H
  const layersTop = bandY(0)
  const layersBottom = bandY(BANDS.length - 1) + BAND_H

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 420 ${HEIGHT}`}
        className="h-auto w-full max-w-[560px]"
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
      >
        <title id={titleId}>
          The import rule inside service/kg, and the two scripts enforcing it
        </title>
        <desc id={descId}>
          Five layers stacked top to bottom: react, tools, repo, core, storage. Three arrowheads sit
          in the gaps — react into tools, tools into repo, repo into core — and every one of them
          points down the stack; none points back up. The gap between core and storage carries no
          arrow but a line of text instead, reading: core and storage never import each other, repo
          is what imports both. A bracket on the left labelled check-layers.mjs covers all five
          layers. A bracket on the right labelled check-platform.mjs covers the top four — react,
          tools, repo and core — and reads: no DOM, no Node, these four run unchanged off the web.
          Storage is outside that bracket because it is the one layer allowed to touch a platform
          API, and repo is marked as the only layer allowed to be asynchronous.
        </desc>

        {/* Column headings. Both scripts run in `npm run lint`, which is the
            fact that makes the brackets more than decoration. */}
        <text x="4" y="14" fontSize="10" fill="var(--text-3)" fontFamily="var(--font-mono)">
          check-layers
        </text>
        <text x="318" y="14" fontSize="10" fill="var(--text-3)" fontFamily="var(--font-mono)">
          check-platform
        </text>

        {/* The left spine: one arrow for the whole stack, because the rule is
            about the direction of the stack rather than about any one edge. */}
        <g stroke="var(--accent)" strokeWidth="1.4" fill="none" opacity="0.75">
          <line x1="52" y1={layersTop + 4} x2="52" y2={layersBottom - 10} />
          <path
            d={`M 47 ${layersBottom - 16} L 52 ${layersBottom - 6} L 57 ${layersBottom - 16}`}
          />
        </g>
        {/* Four short lines rather than three longer ones. The channel between
            the viewBox edge and the spine is 52 units wide and this text is set
            at 9.5, so "point down" — measured at 46 units from x=6 — came out
            with the spine drawn through the n. Nothing here may pass x=49. */}
        <g fill="var(--text-2)" fontSize="9.5">
          <text x="6" y={layersTop + 34}>
            imports
          </text>
          <text x="6" y={layersTop + 46}>
            point
          </text>
          <text x="6" y={layersTop + 58}>
            down,
          </text>
          <text x="6" y={layersTop + 70}>
            never up
          </text>
        </g>

        {/* The bands. Deliberately quiet — see the file comment. */}
        {BANDS.map((band, index) => {
          const y = bandY(index)
          return (
            <g key={band.name}>
              <rect
                x={BAND_X}
                y={y}
                width={BAND_W}
                height={BAND_H}
                rx="6"
                fill={band.accent ? 'var(--accent-soft)' : 'var(--well)'}
                stroke={band.accent ? 'var(--accent-border)' : 'var(--hairline)'}
                strokeWidth="1"
              />
              <text
                x={BAND_X + 10}
                y={y + 15}
                fontSize="9.5"
                fill="var(--text-3)"
                fontFamily="var(--font-mono)"
              >
                {band.tier}
              </text>
              <text
                x={BAND_X + 34}
                y={y + 15}
                fontSize="11"
                fontWeight="600"
                fill={band.accent ? 'var(--accent)' : 'var(--text-1)'}
                fontFamily="var(--font-mono)"
              >
                {band.name}
              </text>
              <text x={BAND_X + 10} y={y + 28} fontSize="9.5" fill="var(--text-2)">
                {band.note}
              </text>
            </g>
          )
        })}

        {/* The gaps. An arrowhead only where the band above really names the
            band below — three of them, none pointing back — and, where the
            interesting fact is that there is no edge, the fact in words. */}
        {BANDS.map((band, index) => {
          const below = band.below
          if (!below) return null
          const y = bandY(index) + BAND_H
          if (below.kind === 'imports') {
            return (
              <path
                key={`gap-${band.name}`}
                d={`M ${BAND_MID - 4} ${y + 2} L ${BAND_MID} ${y + 8} L ${BAND_MID + 4} ${y + 2}`}
                fill="none"
                stroke="var(--text-3)"
                strokeWidth="1.2"
              />
            )
          }
          return (
            <g key={`gap-${band.name}`} fill="var(--text-2)" fontSize="9.5" textAnchor="middle">
              {/* Sat one line lower to begin with, which put it nearer the
                  band below than the band above and read as a caption on
                  `storage` rather than as a statement about the gap. */}
              <text x={BAND_MID} y={y + 12}>
                {below.lines[0]}
              </text>
              <text x={BAND_MID} y={y + 23}>
                {below.lines[1]}
              </text>
            </g>
          )
        })}

        {/* The platform bracket: four layers, not five. The gap at the bottom
            is the whole point — it is where the browser is allowed in. */}
        <path
          d={`M 314 ${platformTop} L 320 ${platformTop} L 320 ${platformBottom} L 314 ${platformBottom}`}
          fill="none"
          stroke="var(--hairline-strong)"
          strokeWidth="1.2"
        />
        {/* This block also read "no clock", which put the clock ban inside a
            bracket that stops above storage — and so implied storage may read
            one. It may not: `check-platform.mjs` applies the `clock` group to
            every layer under service/kg and to the fixtures as well, because a driver
            that stamps its own timestamps breaks a replay exactly as a tool
            would. What the bracket really marks off is DOM and Node. The clock
            rule spans the whole stack, so it is stated in the caption, where a
            claim about all five layers is not being drawn beside four. */}
        <g fill="var(--text-2)" fontSize="9.5">
          <text x="326" y={platformTop + 26}>
            no DOM,
          </text>
          <text x="326" y={platformTop + 38}>
            no Node —
          </text>
          <text x="326" y={platformTop + 50}>
            these four
          </text>
          <text x="326" y={platformTop + 62}>
            run unchanged
          </text>
          <text x="326" y={platformTop + 74}>
            off the web
          </text>
        </g>

        {/* The layer bracket, on the left of the bands and inside the spine. */}
        <path
          d={`M 68 ${layersTop} L 62 ${layersTop} L 62 ${layersBottom} L 68 ${layersBottom}`}
          fill="none"
          stroke="var(--hairline-strong)"
          strokeWidth="1.2"
        />
      </svg>

      {/* The text alternative, visible to everyone rather than hidden behind
          the description. A diagram whose only prose equivalent is an alt
          attribute is decoration with a compliance note attached. */}
      {/* One figcaption, two paragraphs. A figure may carry at most one caption
          element, and a second sibling is dropped from the accessibility tree
          rather than read out — which would have quietly hidden the half of the
          text alternative that names the guards. */}
      <figcaption className="mt-3 text-sm text-text-2">
        <p>
          Five layers, and imports only ever point down the stack — but down, not along it.{' '}
          <span className="font-mono text-xs text-text-1">core</span> imports nothing at all — no
          third-party package, not even React — which is what lets the record model be tested
          without a browser. <span className="font-mono text-xs text-text-1">storage</span> imports
          no other layer either: it moves opaque JSON and a key, and the day it learns what an
          application is the boundary has already gone. So the two at the bottom never reference
          each other, and <span className="font-mono text-xs text-text-1">repo</span> — the only
          layer allowed to be asynchronous — is what imports both.{' '}
          <span className="font-mono text-xs text-text-1">tools</span> reaches down to the
          repository <em>interface</em> and the journal shape and nothing else, never a driver and
          never the live instance, because a tool that fetched the repository for itself could not
          be run inside someone else&rsquo;s transaction.
        </p>
        <p className="mt-2">
          None of that survives on good intentions, so both halves are scripts that run in the lint
          step. <span className="font-mono text-xs text-text-1">check-layers.mjs</span> reads every
          import line and fails on one pointing the wrong way.{' '}
          <span className="font-mono text-xs text-text-1">check-platform.mjs</span> parses the
          source — a regex cannot tell the global{' '}
          <span className="font-mono text-xs">document</span> from the word in a comment — and fails
          on a browser global or a Node built-in anywhere in the four portable layers, and on a
          wall-clock read in <span className="text-text-1">any</span> of the five, storage included:
          that last one is about determinism rather than portability, and a driver stamping its own
          timestamps breaks a replay exactly as a tool would.
        </p>
      </figcaption>
    </figure>
  )
}
