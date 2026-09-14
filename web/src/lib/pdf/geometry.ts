/**
 * From a rectangle on the rendered page to the numbers a PDF annotation holds.
 *
 * Two coordinate systems meet here and they disagree about almost everything.
 * The browser measures in CSS pixels from the TOP-left, at whatever zoom the
 * page is drawn at, with the page's own `/Rotate` already baked into the
 * picture. A PDF measures in points from the BOTTOM-left of the unrotated page.
 * Getting this wrong does not throw — it writes a highlight somewhere else on
 * the page, or on the mirror image of where the text is, which is why the
 * conversion is a module with tests rather than four lines inside a click
 * handler.
 *
 * The actual projection is `viewport.convertToPdfPoint` from pdf.js, which
 * already knows the scale and the rotation. It is taken as a PARAMETER rather
 * than imported: that keeps this file free of a 1MB renderer, and it means the
 * cases below can be written against a projection whose answers are obvious by
 * hand.
 */

export type Point = { readonly x: number; readonly y: number }

/** A rectangle on the rendered page, in CSS pixels from the canvas's top-left. */
export type ViewRect = {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/** Eight numbers: four corners, in the order described on `quadFrom`. */
export type Quad = readonly [number, number, number, number, number, number, number, number]

/** `(x, y)` in CSS pixels on the rendered page -> the same spot in PDF space. */
export type ToPdfPoint = (x: number, y: number) => Point

/**
 * The four corners of a highlighted rectangle, as `/QuadPoints` wants them.
 *
 * ORDER IS THE WHOLE TRAP. PDF 32000-1 §12.5.6.10 says the four vertices go
 * "in counterclockwise order", and that sentence is wrong about every viewer
 * ever shipped: Acrobat, Preview, Chrome and pdf.js all read the order
 * upper-left, upper-right, lower-left, lower-right — a Z, not a loop. Emit what
 * the spec says and the highlight comes out as a bow-tie with two twisted
 * corners. So this emits the Z, and this comment is why.
 *
 * The rect is normalised first: a selection dragged right-to-left arrives with
 * `right` smaller than `left`, and the corners would otherwise come out
 * crossed in the same way.
 */
export function quadFrom(rect: ViewRect, toPdf: ToPdfPoint): Quad {
  const box = normalise(rect)
  const ul = toPdf(box.left, box.top)
  const ur = toPdf(box.right, box.top)
  const ll = toPdf(box.left, box.bottom)
  const lr = toPdf(box.right, box.bottom)
  return [ul.x, ul.y, ur.x, ur.y, ll.x, ll.y, lr.x, lr.y]
}

/** Corners in either order -> corners in reading order. */
export function normalise(rect: ViewRect): ViewRect {
  return {
    left: Math.min(rect.left, rect.right),
    right: Math.max(rect.left, rect.right),
    top: Math.min(rect.top, rect.bottom),
    bottom: Math.max(rect.top, rect.bottom),
  }
}

/**
 * The `/Rect` that has to enclose every quad of an annotation.
 *
 * A viewer is entitled to clip an annotation to its `/Rect`, so a `/Rect` that
 * is merely *near* the quads loses whichever line falls outside it. Computed
 * from the quads rather than tracked alongside them so the two cannot disagree.
 */
export function boundsOf(quads: readonly Quad[]): readonly [number, number, number, number] {
  const xs: number[] = []
  const ys: number[] = []
  for (const quad of quads) {
    for (let i = 0; i < quad.length; i += 2) {
      xs.push(quad[i] ?? 0)
      ys.push(quad[i + 1] ?? 0)
    }
  }
  if (xs.length === 0) return [0, 0, 0, 0]
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

/**
 * The square a sticky note's icon occupies, from the point that was clicked.
 *
 * 24pt because that is the size every viewer draws a note icon at; a `/Rect` of
 * a different size does not resize the icon, it just moves where clicking it
 * registers. The point is the icon's TOP-left, which is where a person expects
 * the thing they placed to appear relative to the cursor — hence `y - size`,
 * PDF space counting upwards.
 */
export const NOTE_SIZE = 24

export function noteRect(at: Point, size = NOTE_SIZE): readonly [number, number, number, number] {
  return [at.x, at.y - size, at.x + size, at.y]
}

/**
 * The other direction: a quad already in the document, back onto the drawing.
 *
 * For painting a mark that has already been made — the tint a person sees over
 * the words after they highlight them. All four corners are projected and the
 * extremes taken, rather than just two: under a quarter-turn the corner that
 * was top-left is no longer the smallest of anything, so projecting a pair and
 * assuming the rest gives a box on the wrong edge of the page.
 */
export function viewRectFrom(quad: Quad, toView: ToPdfPoint): ViewRect {
  const points = [
    toView(quad[0], quad[1]),
    toView(quad[2], quad[3]),
    toView(quad[4], quad[5]),
    toView(quad[6], quad[7]),
  ]
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  }
}

/**
 * Drops the rectangles a text selection produces that are not text.
 *
 * `Range.getClientRects()` returns one rect per line box, and among them the
 * empty ones at a line's end and the hairline slivers where a selection clips
 * the edge of an inline element. Left in, each becomes its own quad, and a
 * viewer draws every one — so a three-line selection highlights as three lines
 * and four specks. Measured in CSS pixels, before any conversion, because that
 * is the space the threshold is meaningful in.
 */
export function usefulRects(rects: readonly ViewRect[], minSize = 1): ViewRect[] {
  return rects
    .map(normalise)
    .filter((rect) => rect.right - rect.left >= minSize && rect.bottom - rect.top >= minSize)
}
