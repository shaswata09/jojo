import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { Check, Pipette } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { hexOfHsv, hsvOf, normaliseHex } from '@jojo/service/core/ink'
import type { Hsv } from '@jojo/service/core/ink'
import { cn } from '@/lib/utils'

/**
 * Any colour off the spectrum, picked INSIDE the page.
 *
 * ## Why this is not `<input type="color">` any more
 *
 * It was, and it broke in exactly the way people use a colour picker. The
 * native control opens the operating system's own panel — a separate window —
 * and reports every movement of its handle as a change. The first change
 * applied the colour, applying it put focus back in the editor, focus leaving
 * the popover closed it, and closing it unmounted the input the panel was
 * attached to. So any click in the panel dismissed the palette, and the colour
 * circle could not be dragged at all: the drag's first frame tore down the
 * thing being dragged. That is the bug this file was rewritten to fix.
 *
 * Built here, the square and the strip are ordinary elements in the popover:
 * a drag is a pointer captured by an element on this page, nothing leaves the
 * document, and nothing about it can look like "the person went somewhere
 * else" to the popover holding it.
 *
 * ## Committed on release, not on every frame
 *
 * The handle moves and the preview follows on every pointer move; `onCommit`
 * fires once, when the drag ends. One drag is one write — one keyword recolour
 * in the journal and one Undo, one `foreColor` in the editor — rather than the
 * sixty a second a live write would have produced.
 *
 * ## Selection is not disturbed
 *
 * `onMouseDown` is prevented on both surfaces, which keeps a click from moving
 * focus or collapsing the text selection behind the popover. The editor still
 * restores the selection it last had before applying (`RichTextEditor`'s
 * `lastRange`), so this is the first line of defence and not the only one.
 */
export function SpectrumPicker({
  value,
  onCommit,
  className,
}: {
  /** The colour to open on — the one in use, so adjusting it starts where it is. */
  value: string | undefined
  onCommit: (hex: string) => void
  className?: string
}) {
  const [hsv, setHsv] = useState<Hsv>(() => hsvOf(value ?? '') ?? { h: 262, s: 0.76, v: 0.93 })
  const [typed, setTyped] = useState(() => hexOfHsv(hsv))
  const live = hexOfHsv(hsv)

  // A different colour handed in — another keyword, another selection — moves
  // the handles to it. Not while dragging: that would fight the pointer.
  const dragging = useRef(false)
  useEffect(() => {
    if (dragging.current) return
    const next = value === undefined ? null : hsvOf(value)
    if (next) {
      setHsv(next)
      setTyped(hexOfHsv(next))
    }
  }, [value])

  const area = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLDivElement>(null)

  /** The point under the pointer, as 0-1 across and down the element. */
  const at = (el: HTMLElement, x: number, y: number) => {
    const r = el.getBoundingClientRect()
    return {
      fx: Math.min(1, Math.max(0, (x - r.left) / r.width)),
      fy: Math.min(1, Math.max(0, (y - r.top) / r.height)),
    }
  }

  const fromArea = (x: number, y: number, base: Hsv): Hsv => {
    if (!area.current) return base
    const { fx, fy } = at(area.current, x, y)
    return { h: base.h, s: fx, v: 1 - fy }
  }
  const fromStrip = (x: number, base: Hsv): Hsv => {
    if (!strip.current) return base
    const { fx } = at(strip.current, x, 0)
    // 359.9, not 360: the top of the strip is red again, and 360 % 360 would
    // jump the handle back to the left edge under the person's finger.
    return { ...base, h: fx * 359.9 }
  }

  /**
   * One drag, start to finish, for either surface.
   *
   * Pointer capture is what makes a drag survive leaving the element — and the
   * popover — without the browser treating the move as hovering something else.
   */
  const drag =
    (read: (x: number, y: number, base: Hsv) => Hsv) => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      const el = event.currentTarget
      el.setPointerCapture(event.pointerId)
      dragging.current = true
      let current = read(event.clientX, event.clientY, hsv)
      setHsv(current)
      setTyped(hexOfHsv(current))

      const move = (e: PointerEvent) => {
        current = read(e.clientX, e.clientY, current)
        setHsv(current)
        setTyped(hexOfHsv(current))
      }
      const end = () => {
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', end)
        el.removeEventListener('pointercancel', end)
        dragging.current = false
        onCommit(hexOfHsv(current))
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', end)
      el.addEventListener('pointercancel', end)
    }

  /**
   * Arrows move the handle; the colour is committed when the key comes up.
   *
   * On keyup rather than keydown so holding an arrow sweeps the colour and
   * writes once at the end, which is the keyboard's version of releasing a drag.
   */
  const nudge =
    (step: (base: Hsv, key: string, big: boolean) => Hsv | null) =>
    (event: KeyboardEvent<HTMLDivElement>) => {
      const next = step(hsv, event.key, event.shiftKey)
      if (next === null) return
      event.preventDefault()
      setHsv(next)
      setTyped(hexOfHsv(next))
    }
  const commitKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key.startsWith('Arrow')) onCommit(live)
  }

  const commitTyped = () => {
    const hex = normaliseHex(typed.startsWith('#') ? typed : `#${typed}`)
    if (hex === null) {
      // Back to what is on screen rather than leaving a half-typed value that
      // nothing will apply.
      setTyped(live)
      return
    }
    const next = hsvOf(hex)
    if (next) setHsv(next)
    setTyped(hex)
    onCommit(hex)
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div
        ref={area}
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuetext={live}
        // A 2D slider has no ARIA role of its own; these say what ONE arrow
        // pair does, and `aria-valuetext` says where the handle is.
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsv.s * 100)}
        onMouseDown={(e) => e.preventDefault()}
        onPointerDown={drag((x, y, base) => fromArea(x, y, base))}
        onKeyDown={nudge((base, key, big) => {
          const d = big ? 0.1 : 0.02
          if (key === 'ArrowLeft') return { ...base, s: Math.max(0, base.s - d) }
          if (key === 'ArrowRight') return { ...base, s: Math.min(1, base.s + d) }
          if (key === 'ArrowUp') return { ...base, v: Math.min(1, base.v + d) }
          if (key === 'ArrowDown') return { ...base, v: Math.max(0, base.v - d) }
          return null
        })}
        onKeyUp={commitKey}
        className="relative h-32 w-full cursor-crosshair touch-none rounded-md"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hexOfHsv({ h: hsv.h, s: 1, v: 1 })})`,
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: live }}
        />
      </div>

      <div
        ref={strip}
        role="slider"
        tabIndex={0}
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        onMouseDown={(e) => e.preventDefault()}
        onPointerDown={drag((x, _y, base) => fromStrip(x, base))}
        onKeyDown={nudge((base, key, big) => {
          const d = big ? 15 : 3
          if (key === 'ArrowLeft' || key === 'ArrowDown') return { ...base, h: Math.max(0, base.h - d) }
          if (key === 'ArrowRight' || key === 'ArrowUp') return { ...base, h: Math.min(359.9, base.h + d) }
          return null
        })}
        onKeyUp={commitKey}
        className="relative h-3 w-full cursor-pointer touch-none rounded-full"
        style={{
          background:
            'linear-gradient(to right, #f00, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00)',
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
          style={{ left: `${(hsv.h / 359.9) * 100}%`, background: hexOfHsv({ h: hsv.h, s: 1, v: 1 }) }}
        />
      </div>

      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="size-6 shrink-0 rounded-md border border-hairline"
          style={{ background: live }}
        />
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onBlur={commitTyped}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitTyped()
            }
          }}
          aria-label="Hex colour"
          spellCheck={false}
          maxLength={7}
          className="h-7 w-full min-w-0 rounded-md border border-input bg-transparent px-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>
    </div>
  )
}

/**
 * The swatch beside the eight keyword colours that opens the picker.
 *
 * A popover of its own rather than an inline picker, because the swatch row
 * sits in a settings row and in a chip's menu, and a 128px square in either
 * would push everything around it. It stays open across commits so a colour can
 * be adjusted twice without reopening it; Escape or a click elsewhere closes it.
 */
export function SpectrumSwatch({
  value,
  fill,
  onPick,
  selected,
  label = 'Any colour',
  className,
}: {
  /** The custom colour as STORED — what the picker opens on and would re-save. */
  value: string | undefined
  /**
   * What the disc shows, when that differs from the stored colour: a keyword's
   * swatch draws the ink `inkOf` derives for the theme on screen. Kept apart
   * from `value` so opening the picker and committing without moving cannot
   * quietly replace the chosen colour with its theme-adjusted shadow.
   */
  fill?: string
  onPick: (hex: string) => void
  selected?: boolean
  label?: string
  className?: string
}) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={label}
        title={label}
        className={cn(
          'group/swatch relative grid size-6 cursor-pointer place-items-center rounded-full',
          className,
        )}
      >
        <span
          aria-hidden
          className={cn(
            'grid size-4 place-items-center rounded-full text-panel transition-transform group-hover/swatch:scale-110',
            // The rainbow says "anything", as a conic gradient so it costs no
            // request and stays sharp at any zoom. A custom colour in use
            // replaces it, as every other disc in the row shows its own.
            value === undefined &&
              'bg-[conic-gradient(from_0deg,#ef4444,#eab308,#22c55e,#06b6d4,#3b82f6,#a855f7,#ec4899,#ef4444)]',
          )}
          style={value === undefined ? undefined : { background: fill ?? value }}
        >
          {selected ? (
            <Check className="size-2.5" strokeWidth={3.5} />
          ) : value === undefined ? (
            <Pipette className="size-2.5 text-panel" strokeWidth={2.5} />
          ) : null}
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56" aria-label={label}>
        <SpectrumPicker value={value} onCommit={onPick} />
      </PopoverContent>
    </Popover>
  )
}
