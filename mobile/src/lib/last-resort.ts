/**
 * The two failures React cannot catch, reported instead of vanishing.
 *
 * An error boundary catches a throw during RENDER. It does nothing about a
 * rejected promise nobody awaited, and nothing about a throw from a timer or a
 * native callback — and there are ~28 deliberately fire-and-forget promises in
 * `mobile/src` alone. Every one of those rejections was, until this file
 * existed, discarded in silence on both platforms.
 *
 * WHAT THIS DOES NOT DO is recover. There is nothing to recover: by the time a
 * rejection is unhandled the work is already lost. What it buys is a line in
 * `adb logcat` naming what failed, which is the difference between a bug report
 * that can be acted on and "it stopped working". With no backend and no crash
 * reporter, that log line is the only diagnostic the product has.
 *
 * `ErrorUtils` is React Native's own global hook and is not in any type
 * definition, hence the guarded lookup rather than an import.
 */

type GlobalHandler = (error: unknown, isFatal?: boolean) => void
type ErrorUtilsShape = {
  getGlobalHandler?: () => GlobalHandler
  setGlobalHandler?: (handler: GlobalHandler) => void
}

export function installLastResortHandlers(): void {
  const globals = globalThis as typeof globalThis & {
    ErrorUtils?: ErrorUtilsShape
    HermesInternal?: { enablePromiseRejectionTracker?: (config: unknown) => void }
  }

  const errorUtils = globals.ErrorUtils
  if (errorUtils?.setGlobalHandler && errorUtils.getGlobalHandler) {
    // Chained, never replaced. React Native's own handler is what shows the red
    // box in development and what ends the process on a fatal; swapping it out
    // would trade a visible crash for a silent one.
    const previous = errorUtils.getGlobalHandler()
    errorUtils.setGlobalHandler((error, isFatal) => {
      console.error(`Uncaught error${isFatal === true ? ' (fatal)' : ''}:`, error)
      previous(error, isFatal)
    })
  }

  /*
   * Hermes tracks rejections but reports them nowhere by default.
   *
   * `allRejections: true` means every rejection is reported, not only the ones
   * that were never handled at all — a promise handled 30 seconds late still
   * indicates a bug worth seeing. The tracker de-duplicates by id, so a
   * rejection later handled arrives once more through `onHandled`, which is why
   * that half is worth wiring rather than leaving the first line to mislead.
   */
  globals.HermesInternal?.enablePromiseRejectionTracker?.({
    allRejections: true,
    onUnhandled: (id: number, error: unknown) => {
      console.error(`Unhandled promise rejection (#${String(id)}):`, error)
    },
    onHandled: (id: number) => {
      console.warn(`Promise rejection #${String(id)} was handled late, after being reported.`)
    },
  })
}
