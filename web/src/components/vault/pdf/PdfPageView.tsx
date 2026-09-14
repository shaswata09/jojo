import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { colourById, onPage, type Annotation } from '@/lib/pdf/annotations'
import {
  NOTE_SIZE,
  noteRect,
  quadFrom,
  usefulRects,
  viewRectFrom,
  type Quad,
  type ViewRect,
} from '@/lib/pdf/geometry'
import type { DrawnPage, OpenPdf } from '@/lib/pdf/render'

/**
 * One page: the drawing, the text over it, and the marks over that.
 *
 * Three layers, stacked, all the same size.
 *
 * 1. A `<canvas>` pdf.js paints the page into.
 * 2. pdf.js's own text layer — transparent, positioned characters. This is what
 *    makes SELECTION work: the browser's own selection, over real text nodes,
 *    so dragging across two lines behaves the way it does in any document
 *    rather than like a rubber band somebody wrote.
 * 3. The marks already made, drawn as plain divs.
 *
 * The marks are drawn from PDF coordinates every render rather than cached in
 * screen ones, so changing the zoom moves them with the words they are on.
 */
export function PdfPageView({
  document_,
  page,
  scale,
  annotations,
  tool,
  onHighlight,
  onNote,
}: {
  document_: OpenPdf
  /** 0-based. */
  page: number
  scale: number
  annotations: readonly Annotation[]
  tool: 'highlight' | 'comment'
  /** Called with the quads of a finished selection, and the words it covered. */
  onHighlight: (quads: ReturnType<typeof quadFrom>[], text: string) => void
  /** Called with a point in PDF space. */
  onNote: (at: { x: number; y: number }) => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const textLayer = useRef<HTMLDivElement>(null)
  const wrapper = useRef<HTMLDivElement>(null)
  const [drawn, setDrawn] = useState<DrawnPage | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setFailed(null)
    const run = async () => {
      const target = canvas.current
      const text = textLayer.current
      if (!target || !text) return
      try {
        const geometry = await document_.draw(page, target, scale)
        // Every await is a chance for the page or the zoom to have changed
        // under us. Without this the slower of two renders wins, and the canvas
        // ends up showing a page the rest of the UI is not on.
        if (!live) return
        setDrawn(geometry)
        await document_.drawText(page, text, scale)
      } catch (cause) {
        if (live) setFailed(cause instanceof Error ? cause.message : String(cause))
      }
    }
    void run()
    return () => {
      live = false
    }
  }, [document_, page, scale])

  /** A rect from the browser, moved into the canvas's own coordinates. */
  const relative = useCallback((rect: DOMRect): ViewRect => {
    const box = wrapper.current?.getBoundingClientRect()
    const left = box?.left ?? 0
    const top = box?.top ?? 0
    return {
      left: rect.left - left,
      top: rect.top - top,
      right: rect.right - left,
      bottom: rect.bottom - top,
    }
  }, [])

  /**
   * Turns whatever is selected into quads, once the gesture has finished.
   *
   * On `pointerup` and not on `selectionchange`: the latter fires for every
   * character crossed, and a highlight per intermediate state is both wrong and
   * a great deal of work. `getClientRects` gives one rect per LINE, which is
   * exactly the shape `/QuadPoints` wants — a multi-line highlight is several
   * quads, not one box swallowing the margin between them.
   */
  const takeSelection = useCallback(() => {
    if (tool !== 'highlight' || !drawn) return
    const selection = globalThis.getSelection?.()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    if (!textLayer.current?.contains(range.commonAncestorContainer)) return

    const rects = usefulRects([...range.getClientRects()].map(relative))
    if (rects.length === 0) return
    onHighlight(
      rects.map((rect) => quadFrom(rect, drawn.toPdfPoint)),
      selection.toString(),
    )
    selection.removeAllRanges()
  }, [drawn, onHighlight, relative, tool])

  const placeNote = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (tool !== 'comment' || !drawn) return
      const box = wrapper.current?.getBoundingClientRect()
      if (!box) return
      onNote(drawn.toPdfPoint(event.clientX - box.left, event.clientY - box.top))
    },
    [drawn, onNote, tool],
  )

  const marks = onPage(annotations, page)

  return (
    <div className="flex justify-center overflow-auto rounded-lg border border-hairline bg-well p-3">
      <div
        ref={wrapper}
        className={cn(
          'relative shadow-sm',
          tool === 'comment' ? 'cursor-copy' : 'cursor-text',
          drawn ? '' : 'min-h-40 min-w-40',
        )}
        style={drawn ? { width: drawn.width, height: drawn.height } : undefined}
        onMouseUp={takeSelection}
        onClick={placeNote}
      >
        <canvas ref={canvas} className="block rounded-sm bg-white" />
        {/*
         * `select-text` and a transparent colour: pdf.js's layer is real text
         * sitting over the picture of it, and it has to be invisible but
         * selectable. `pointer-events-none` while placing a comment, so a click
         * meant for the page is not eaten by a character.
         */}
        <div
          ref={textLayer}
          /*
           * `--total-scale-factor` is pdf.js's side of the CSS contract: it
           * sizes each span by multiplying this by the glyph height it measured.
           * Left unset, every character renders at font-size 0 and the layer is
           * invisible AND unselectable — which looks exactly like the text layer
           * having failed to load.
           */
          style={{ '--total-scale-factor': scale } as React.CSSProperties}
          className={cn(
            'pdf-text-layer',
            // Clicks are for placing a comment, so they must not be swallowed
            // by a character; while highlighting, the reverse.
            tool === 'comment' ? 'pointer-events-none' : 'select-text',
          )}
        />
        {drawn === null ? null : (
          <div className="pointer-events-none absolute inset-0">
            {marks.map((mark) =>
              mark.kind === 'highlight' ? (
                mark.quads.map((quad, at) => {
                  const rect = viewRectFrom(quad, drawn.toViewPoint)
                  return (
                    <span
                      key={`${mark.id}:${at}`}
                      // `mix-blend-multiply` so the tint darkens the words
                      // rather than washing them out, which is what a real
                      // highlight does and what the saved file will show.
                      className="absolute mix-blend-multiply"
                      style={{
                        left: rect.left,
                        top: rect.top,
                        width: rect.right - rect.left,
                        height: rect.bottom - rect.top,
                        backgroundColor: colourById(mark.colourId).hex,
                        opacity: 0.4,
                      }}
                    />
                  )
                })
              ) : (
                <NoteMark key={mark.id} body={mark.body} at={mark.at} drawn={drawn} />
              ),
            )}
          </div>
        )}
        {failed === null ? null : (
          <p
            role="alert"
            className="absolute inset-0 grid place-items-center p-4 text-sm text-danger"
          >
            {failed}
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * A sticky note's icon, boxed exactly where the PDF will put it.
 *
 * Built from `noteRect` — the same function that writes the annotation's
 * `/Rect` — rather than from a size in screen pixels, so what is on screen is
 * the thing that ends up in the file at every zoom level.
 */
function NoteMark({
  body,
  at,
  drawn,
}: {
  body: string
  at: { x: number; y: number }
  drawn: DrawnPage
}) {
  const [x0, y0, x1, y1] = noteRect(at, NOTE_SIZE)
  const box = viewRectFrom([x0, y1, x1, y1, x0, y0, x1, y0] as Quad, drawn.toViewPoint)
  return (
    <span
      title={body || 'Comment'}
      className="absolute flex items-center justify-center rounded-sm border border-amber-700/60 bg-amber-300 text-[10px] leading-none text-amber-950 shadow-sm"
      style={{
        left: box.left,
        top: box.top,
        width: box.right - box.left,
        height: box.bottom - box.top,
      }}
    >
      ●
    </span>
  )
}
