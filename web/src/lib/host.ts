/**
 * The web adapter for `Host` — the only implementation that touches the DOM.
 *
 * It lives here rather than under `src/kg` because nothing under `src/kg` may
 * reference `window` or `document` any more: the graph, the tools and the React
 * bindings have to mount unchanged inside a React Native or Electron-main
 * bundle, and a single `window.addEventListener` in the shared layer is a
 * `ReferenceError` at mount there rather than a compile error anyone would have
 * caught. `src/lib` is where web-only already lives, alongside `storage.ts` and
 * the toast viewport.
 *
 * Exported as a const rather than a factory because `KgProvider` puts the host
 * in an effect's dependency list — a host minted per render would have torn down
 * and re-bound both listeners on every render. Nothing is read at module scope,
 * so importing this file in a non-DOM environment is safe; only calling its
 * methods needs a browser.
 */

import type { Host } from '@/kg/react/host'

export const webHost: Host = {
  /**
   * ⌘Z / ⇧⌘Z, once, at the root.
   *
   * The journal made this possible: every write is a commit with before-images,
   * so one handler undoes any of them and the 42 hand-written undo closures the
   * cards carried are no longer the only way back. Bound on `window` rather than
   * per route because the keystroke belongs to the app, not to whichever list
   * happens to be focused.
   *
   * `ctrlKey` as well as `metaKey` so Windows and Linux get it, and `altKey`
   * excluded because ⌥⌘Z is a different chord in several editors embedded in
   * the page and swallowing it would have made those unusable.
   */
  onUndoRequest(run) {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      if (event.key.toLowerCase() !== 'z') return
      if (isTyping(event.target)) return

      event.preventDefault()
      run(event.shiftKey ? 'redo' : 'undo')
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  },

  /**
   * Two events, because neither one alone catches every way a tab ends.
   *
   * `pagehide` is the reliable terminal event on desktop, but a mobile browser
   * routinely freezes or kills a backgrounded tab without ever firing it —
   * `visibilitychange` to `hidden` is the last thing guaranteed to run there.
   * Registering only `pagehide` lost the final batch every time someone switched
   * apps mid-edit on a phone and never came back to the tab.
   *
   * Both fire on an ordinary close, so `run` is called twice; that is why the
   * port requires it to be idempotent. Deliberately NOT awaited: `queue.flush()`
   * settles on a failed attempt on purpose, and a `pagehide` handler cannot
   * block the browser anyway — the promise exists for Electron, which can.
   */
  onSuspend(run) {
    const flush = () => {
      void run()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush()
    }

    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  },
}

/**
 * Whether the caret is somewhere the browser's own undo should win.
 *
 * Without this, ⌘Z inside a half-typed note reverted the last *record* change
 * instead of the last few characters — the user's text stayed on screen, so the
 * only visible effect was some other card silently changing behind the dialog.
 *
 * `instanceof HTMLElement` rather than a truthy check on `tagName`: the event
 * target is `EventTarget | null`, and a keydown that reached `window` from a
 * shadow root or from `document` itself would otherwise have thrown here.
 */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}
