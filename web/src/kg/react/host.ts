/**
 * L4 — the Host port: the platform events that have to act on graph state.
 *
 * Two members, and the bar for a third is high. `useUndoHotkey` used to sit
 * inside `KgProvider` and call `window.addEventListener('keydown', …)` directly
 * (in `kg.tsx`, now gone), which made the shared React layer unmountable
 * anywhere `window` is not defined — on React Native that is a `ReferenceError`
 * at mount, not a type error someone would have caught in review. Everything
 * `kg/react` needed from a browser now arrives through this interface, and the
 * implementations live outside `src/kg` where platform code is allowed.
 *
 * Both members are named for the INTENT, not the mechanism. An `onShortcut(keys)`
 * would have been the obvious shape and the wrong one: the three platforms
 * disagree about the mechanism completely — a `window` listener, a native menu
 * accelerator over IPC, and no hardware keyboard at all — so a key-shaped
 * signature would be a lowest common denominator none of them wanted, and the
 * DOM's own idea of "the caret is in a text field" would have had to cross the
 * seam with it. "The user asked to undo" is a sentence all three can say.
 *
 * The test for whether something belongs here: the graph owns state that a
 * platform event has to act on. Undo/redo mutates the journal; suspend has to
 * drain the write queue. A toast, a menu item, a keystroke that changes nothing
 * — those belong above this line, in the app shell.
 *
 * Passed as a prop to `KgProvider`, never imported from a module, for the same
 * reason D26 injects the clock: a module-level host is a host nobody passes, and
 * the second platform discovers it as a crash at import time.
 */

/** Which direction the user asked for. `redo` is ⇧⌘Z on web, Edit ▸ Redo on desktop. */
export type UndoDirection = 'undo' | 'redo'

export interface Host {
  /**
   * The user asked to undo or redo, by whatever means this platform offers.
   *
   * The adapter owns the whole decision, including whether to suppress it. On
   * web that means the ⌘Z/⇧⌘Z chord AND the "not while the caret is in a text
   * field" guard, because the browser's own undo inside an input is the one
   * people expect there and stealing it silently reverted a half-typed note over
   * somebody's last save. That guard is a DOM sentence; React Native's answer is
   * `TextInput` focus state, which is a different sentence rather than a
   * different implementation of the same one, so it stays in the adapter.
   *
   * Returns an unsubscribe, matching `repo.subscribe` and `queue.subscribe` so
   * an effect can return it directly.
   */
  onUndoRequest(run: (direction: UndoDirection) => void): () => void

  /**
   * The last moment before the platform may stop running our code.
   *
   * Wired to `repo.flush()`. `commit` is synchronous and the queue drains on a
   * microtask, so the exposure is one undrained batch — small, but a batch that
   * was still in the queue when the tab closed was work the user watched land on
   * screen and never got back.
   *
   * `run` returns a promise because Electron is the one platform that can
   * genuinely defer its `before-quit` until the write settles. Web and RN cannot
   * wait and must not try: `queue.flush()` resolves on a *failed* attempt on
   * purpose (see `flush` in `kg/repo/queue.ts`), so a handler that blocked on
   * durability would hang on exactly the failure it exists to survive.
   *
   * May fire more than once for one suspension — the web adapter listens to two
   * events that both fire on an ordinary tab close — so `run` must be idempotent.
   * `repo.flush()` is: it returns early with nothing pending and otherwise hands
   * back the same idle promise.
   */
  onSuspend(run: () => Promise<void>): () => void

  /**
   * The tab is in front of the user again after not being.
   *
   * The mirror of `onSuspend`, and it earns its place by the same test: the
   * graph owns state a platform event has to act on. What it acts on is the
   * possibility that another tab changed the store while we were away — which is
   * normally BroadcastChannel's job, and is nobody's job at all when the browser
   * has no BroadcastChannel (Safari before 15.4; a sandboxed frame with an
   * opaque origin, where constructing one throws). There, two tabs write whole
   * records over each other in silence and a stale undo stack replays over the
   * result. `repo/boot.ts` subscribes to this ONLY when the store reports
   * `crossTab: false`, so on a normal browser nothing here runs.
   *
   * Deliberately not "on focus": focus fires when the user clicks back into the
   * page from the URL bar, which is not a moment anything can have changed. The
   * web adapter uses `visibilitychange`, which is the event that actually means
   * "this tab was in the background and now is not".
   *
   * Optional, unlike the other two. A platform with a single window — Electron's
   * renderer, a native shell — has nothing to resume from, and a host that
   * cannot say so would have to lie.
   */
  onResume?(run: () => void): () => void
}

/** One shared no-op unsubscribe, so a headless host allocates nothing per mount. */
const unsubscribe = () => {}

/**
 * The host that supplies nothing.
 *
 * `KgProvider`'s default, and the right answer in three places: unit tests, a
 * React Native shell before anyone has written the AppState wiring, and any
 * renderer that mounts the graph without owning the app's chrome.
 *
 * It is the default rather than the web adapter deliberately. Defaulting to web
 * would mean `kg/react` importing a module that reads `window`, which puts the
 * DOM back inside `src/kg` through the import graph — the exact coupling this
 * port was cut to remove, and one that `check-layers` would then have to be
 * taught to ignore. The web app supplies its host at its single mount point
 * instead (`src/lib/store.tsx`), so nothing downstream of it changed.
 *
 * A frozen module const rather than a factory: `KgProvider` puts the host in an
 * effect's dependency list, and a host minted per render would have torn down
 * and re-bound every subscription on every render.
 */
export const headlessHost: Host = Object.freeze({
  onUndoRequest: () => unsubscribe,
  onSuspend: () => unsubscribe,
})

/**
 * What React Native would supply, when there is an RN app to supply it.
 *
 * Deliberately not written yet — an adapter no app mounts is an adapter no test
 * covers, and the seam is the deliverable, not a guess at the implementation.
 * For whoever writes it:
 *
 * - `onUndoRequest`: `() => unsubscribe`. There is no hardware keyboard in the
 *   general case, and undo on a phone is an affordance — the toast's Undo action
 *   is already wired through `useTool` — not a chord. `runtime.undo()/redo()` is
 *   public on `KgContext`, so a long-press menu can call it directly without
 *   going through this port at all.
 * - `onSuspend`: `AppState.addEventListener('change', …)` firing on
 *   `'background'`. Note that RN throttles timers in the background, so the
 *   queue's backoff (`schedule` in `kg/repo/queue.ts`) will not fire there —
 *   the flush on
 *   suspend is the belt and the timer the braces, not the reverse.
 *
 * Electron's renderer can use the web adapter unchanged for `onUndoRequest`
 * today, but should not: a desktop user expects Edit ▸ Undo in the menu bar,
 * greyed out when there is nothing to undo, which is a native menu accelerator
 * forwarded over IPC rather than a renderer keydown.
 */
