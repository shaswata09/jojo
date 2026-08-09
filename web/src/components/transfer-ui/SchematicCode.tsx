import { useMemo } from 'react'
import { cn } from '@/lib/utils'

const GRID = 9

/**
 * A drawing of a code, deliberately not a code.
 *
 * The honest options here were to encode the pairing string with a real QR
 * encoder written into this bundle, or to draw something that could never be
 * mistaken for one. This is the second: nothing in this build transmits, so a
 * camera that successfully read a code off this screen would have read a
 * promise the app cannot keep — a person would point a phone at it, get a
 * string, and reasonably conclude a device on the other side was listening.
 *
 * So the shape is wrong on purpose. Round modules, corner brackets rather than
 * QR's three finder squares, and a caption that says what it is. It still
 * *derives* from the code, so regenerating the pairing code visibly changes the
 * drawing and the two read as the same fact in two forms.
 */
export function SchematicCode({ code, className }: { code: string; className?: string }) {
  const modules = useMemo(() => bitsFor(code), [code])

  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <div className="relative rounded-lg border border-hairline bg-well p-3">
        <svg
          viewBox={`0 0 ${GRID} ${GRID}`}
          className="size-40 text-text-2"
          role="img"
          aria-label="Schematic illustration of the pairing code. It is a drawing, not a scannable code."
        >
          {modules.map((on, i) =>
            on ? (
              <circle
                key={i}
                cx={(i % GRID) + 0.5}
                cy={Math.floor(i / GRID) + 0.5}
                r={0.34}
                fill="currentColor"
                // Faded on the outer ring so the block reads as an illustration
                // fading into the card rather than as a hard-edged symbol.
                opacity={edgeDistance(i) === 0 ? 0.32 : 0.72}
              />
            ) : null,
          )}
          {/* Brackets, not finder patterns. A reader who knows what a QR code
              looks like should be able to tell at a glance that this is not one. */}
          {CORNERS.map(([x, y, sx, sy], i) => (
            <path
              key={i}
              d={`M ${x + sx * 1.6} ${y} H ${x} V ${y + sy * 1.6}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={0.28}
              strokeLinecap="round"
              opacity={0.5}
            />
          ))}
        </svg>
      </div>
      <p className="max-w-56 text-center text-xs text-text-3">
        A schematic, not a scannable code. Nothing on this device is broadcasting.
      </p>
    </div>
  )
}

/** Corner brackets: x, y and the direction each arm runs. */
const CORNERS: [number, number, number, number][] = [
  [0.35, 0.35, 1, 1],
  [8.65, 0.35, -1, 1],
  [0.35, 8.65, 1, -1],
  [8.65, 8.65, -1, -1],
]

const edgeDistance = (i: number) => {
  const x = i % GRID
  const y = Math.floor(i / GRID)
  return Math.min(x, y, GRID - 1 - x, GRID - 1 - y)
}

/**
 * One bit per cell, derived from the code with FNV-1a and a small xorshift so
 * the pattern is stable for a given code and visibly different for the next
 * one. The threshold leaves roughly half the grid filled, which is what stops
 * it reading as either a solid block or a sprinkle.
 */
function bitsFor(code: string) {
  let hash = 0x811c9dc5
  for (const ch of code) {
    hash = Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0
  }

  const cells: boolean[] = []
  let state = hash || 1
  for (let i = 0; i < GRID * GRID; i++) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    cells.push(state % 100 < 46)
  }
  return cells
}
