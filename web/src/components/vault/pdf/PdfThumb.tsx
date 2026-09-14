import { useEffect, useRef, useState } from 'react'
import type { OpenPdf } from '@/lib/pdf/render'

/**
 * A small picture of one page, turned the way the plan says it will be.
 *
 * The rotation is applied as a CSS transform rather than by re-rendering the
 * page: pdf.js would have to redraw for every quarter turn, and the answer is
 * the same picture at a different angle. The transform is on the canvas, and
 * the box it sits in keeps its own size — otherwise a turned page pushes its
 * neighbours around the grid every time somebody clicks a rotate button.
 */
export function PdfThumb({
  document_,
  page,
  rotation,
  label,
  width = 130,
}: {
  document_: OpenPdf
  /** 0-based, into the ORIGINAL document. */
  page: number
  rotation: number
  label: string
  width?: number
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    const run = async () => {
      const target = canvas.current
      if (!target) return
      try {
        // Asked for the size rather than rendering once to find it out: the
        // thumbnail has to come out the same width whatever paper the page is
        // on — a fixed scale makes A4 and US Letter visibly different, and
        // turns a poster into a thumbnail the size of the panel — but drawing
        // it full size first to measure means every thumbnail is rendered
        // twice, the first time at the size it is least wanted.
        const { width: full } = await document_.size(page)
        if (!live) return
        await document_.draw(page, target, width / full)
      } catch {
        if (live) setFailed(true)
      }
    }
    void run()
    return () => {
      live = false
    }
  }, [document_, page, width])

  const turned = rotation === 90 || rotation === 270

  return (
    <div
      className="grid place-items-center overflow-hidden rounded-sm bg-white"
      style={{ height: width * 1.3 }}
      role="img"
      aria-label={`${label}${rotation === 0 ? '' : `, turned ${rotation} degrees`}`}
    >
      {failed ? (
        <span className="text-xs text-text-3">No preview</span>
      ) : (
        <canvas
          ref={canvas}
          className="block origin-center transition-transform"
          style={{
            transform: `rotate(${rotation}deg)`,
            // A page on its side is as wide as it was tall; without this it
            // overflows the box it is turning inside.
            maxWidth: turned ? `${width * 1.3}px` : '100%',
            maxHeight: turned ? `${width}px` : '100%',
          }}
        />
      )}
    </div>
  )
}
