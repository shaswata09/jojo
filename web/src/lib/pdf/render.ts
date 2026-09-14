/**
 * Drawing a PDF page, and putting selectable text over it.
 *
 * The one part of this tool that genuinely needs a browser, so it is kept as
 * thin as it can be: it draws, and it hands back the projection that turns a
 * place on the drawing into a place in the document. Every decision taken with
 * those numbers is in `geometry.ts`, where it can be tested.
 *
 * ## Why the legacy build
 *
 * `pdfjs-dist@6` is compiled to syntax that includes `Promise.try` — Chrome
 * 128, Safari 18.2, Firefox 134 and no earlier. This repo's floor is iOS 16.4
 * (see the mobile platform note) and Vite is left on its default
 * baseline-widely-available target, roughly Safari 16, so the modern build
 * would fail to parse for a real share of the people this ships to, and fail at
 * load with no error the app can catch. The legacy build is the same API
 * compiled down, and it is what every import here points at.
 *
 * ## Fonts
 *
 * `useSystemFonts` rather than shipping pdf.js's standard-font and CMap data.
 * This affects the PREVIEW only — pdf.js never touches the bytes that get
 * saved, `pdf-lib` writes those — so the cost of a missing font file is that a
 * page is drawn in a substitute face, not that a document comes out wrong. A
 * PDF using CJK encodings may preview imperfectly for the same reason; copying
 * `pdfjs-dist/cmaps` into the build is the fix if that ever matters.
 */
import { GlobalWorkerOptions, TextLayer, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import type { Point } from './geometry'

/**
 * The worker, as a module worker Vite can see and bundle.
 *
 * `new URL(..., import.meta.url)` is the spelling Vite rewrites to a hashed
 * asset in the build. Setting `workerSrc` to a bare specifier instead leaves a
 * path that resolves in dev and 404s in production — and pdf.js reacts to a
 * missing worker by falling back to running on the main thread, so the failure
 * shows up as the page locking up rather than as an error.
 */
let workerReady = false
function ensureWorker(): void {
  if (workerReady) return
  GlobalWorkerOptions.workerPort = new Worker(
    new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url),
    { type: 'module' },
  )
  workerReady = true
}

/** A page drawn at a particular scale, and how to read positions off it. */
export type DrawnPage = {
  /** CSS pixels, which is what the canvas is sized to and what a rect is in. */
  readonly width: number
  readonly height: number
  /** A place on the drawing -> the same place in the document. */
  readonly toPdfPoint: (x: number, y: number) => Point
  /**
   * The exact inverse, for drawing an existing mark back onto the page.
   *
   * From pdf.js rather than reconstructed here. Undoing the projection by hand
   * looks like an axis flip and a divide, and that is only true for a page with
   * no `/Rotate` and equal scales — on a sideways scan it puts every highlight
   * on the wrong edge of the page.
   */
  readonly toViewPoint: (x: number, y: number) => Point
}

export type OpenPdf = {
  readonly pageCount: number
  /** How big page `index` is at scale 1, without drawing it. */
  size: (index: number) => Promise<{ width: number; height: number }>
  /** Draws page `index` (0-based) into `canvas`, and reports its geometry. */
  draw: (index: number, canvas: HTMLCanvasElement, scale: number) => Promise<DrawnPage>
  /** Fills `into` with positioned, selectable text for page `index`. */
  drawText: (index: number, into: HTMLElement, scale: number) => Promise<void>
  close: () => void
}

/**
 * Opens bytes for viewing.
 *
 * The bytes are COPIED first. pdf.js transfers the buffer it is given to its
 * worker, which detaches it: the caller's `Uint8Array` silently becomes zero
 * length, and since the caller here is holding the only copy of the document it
 * is about to save, the save writes an empty file. The copy costs one allocation
 * and removes a whole class of that.
 */
export async function openPdf(bytes: Uint8Array): Promise<OpenPdf> {
  ensureWorker()
  const document_: PDFDocumentProxy = await getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
  }).promise

  /*
   * One render at a time per canvas, and per text container.
   *
   * pdf.js refuses two concurrent renders into the same canvas and refuses them
   * by THROWING — "Cannot use the same canvas during multiple render()
   * operations". React runs every effect twice in development, so this is the
   * normal case rather than an exotic one, and the failure is worse than a slow
   * redraw: the throw skips whatever came after it, so the page appeared with
   * no text layer over it and nothing on it could be selected.
   *
   * Cancelling the previous task is not enough on its own. Both calls spend
   * their first moments awaiting `getPage`, so the second reaches the cancel
   * before the first has a task to cancel, and then both call `render()`. So
   * there are two halves: `cancel` to stop the old render finishing work nobody
   * will see, and a per-canvas chain to WAIT for it to let go. `WeakMap`, so a
   * canvas React has thrown away takes its entry with it.
   */
  const inFlight = new WeakMap<HTMLCanvasElement, RenderTask>()
  const queue = new WeakMap<object, Promise<unknown>>()
  const textLayers = new WeakMap<HTMLElement, TextLayer>()

  /** Runs `work` after whatever was last queued against `key` has settled. */
  function afterPrevious<T>(key: object, work: () => Promise<T>): Promise<T> {
    const previous = queue.get(key) ?? Promise.resolve()
    const run = previous.then(work, work)
    // Stored already-handled, so one failure does not reject every later call
    // chained behind it.
    queue.set(
      key,
      run.then(
        () => undefined,
        () => undefined,
      ),
    )
    return run
  }

  return {
    pageCount: document_.numPages,

    async size(index) {
      const viewport = (await document_.getPage(index + 1)).getViewport({ scale: 1 })
      return { width: viewport.width, height: viewport.height }
    },

    draw(index, canvas, scale) {
      // Signal first so the old render stops early, then queue behind it.
      inFlight.get(canvas)?.cancel()
      return afterPrevious(canvas, () => drawNow(index, canvas, scale))
    },

    drawText(index, into, scale) {
      textLayers.get(into)?.cancel()
      return afterPrevious(into, () => drawTextNow(index, into, scale))
    },

    close() {
      /*
       * Through the loading task, which is what owns the worker. `cleanup()` on
       * the document only drops cached page resources; the worker survives it,
       * and one is started per document opened.
       */
      void document_.loadingTask.destroy()
    },
  }

  async function drawNow(
    index: number,
    canvas: HTMLCanvasElement,
    scale: number,
  ): Promise<DrawnPage> {
    const page = await document_.getPage(index + 1)
    const viewport = page.getViewport({ scale })
    /*
     * Two sizes, deliberately. The canvas BACKING store is in device pixels
     * so the page is sharp on a retina screen; its CSS box stays in CSS
     * pixels so that every rect measured against it — a text selection, a
     * click — is in the same units the projection below expects. Sizing only
     * the backing store gives a page drawn at half size on a 2x display.
     */
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 3)
    canvas.width = Math.floor(viewport.width * ratio)
    canvas.height = Math.floor(viewport.height * ratio)
    canvas.style.width = `${Math.floor(viewport.width)}px`
    canvas.style.height = `${Math.floor(viewport.height)}px`

    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser would not give the page a canvas to draw on.')
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    const task = page.render({ canvas, canvasContext: context, viewport })
    inFlight.set(canvas, task)
    try {
      await task.promise
    } catch (cause) {
      // A cancellation is this function's own doing, not a failure: a newer
      // render is already painting the same canvas. Anything else is real.
      if ((cause as { name?: string })?.name !== 'RenderingCancelledException') throw cause
    } finally {
      if (inFlight.get(canvas) === task) inFlight.delete(canvas)
    }

    return {
      width: viewport.width,
      height: viewport.height,
      toPdfPoint: (x, y) => {
        const [pdfX, pdfY] = viewport.convertToPdfPoint(x, y)
        return { x: pdfX ?? 0, y: pdfY ?? 0 }
      },
      toViewPoint: (x, y) => {
        const [viewX, viewY] = viewport.convertToViewportPoint(x, y)
        return { x: Number(viewX ?? 0), y: Number(viewY ?? 0) }
      },
    }
  }

  async function drawTextNow(index: number, into: HTMLElement, scale: number): Promise<void> {
    const page = await document_.getPage(index + 1)
    const viewport = page.getViewport({ scale })
    into.replaceChildren()
    // pdf.js's own layer, rather than positioning spans by hand: it is what
    // makes the browser's NATIVE selection work over a canvas, so selecting
    // across two lines behaves the way it does in any other document.
    const layer = new TextLayer({
      textContentSource: page.streamTextContent(),
      container: into,
      viewport,
    })
    textLayers.set(into, layer)
    try {
      await layer.render()
    } finally {
      if (textLayers.get(into) === layer) textLayers.delete(into)
    }
  }
}
