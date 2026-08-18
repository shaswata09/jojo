/**
 * The web host's rules, which nothing used to cover.
 *
 * This logic ran inside `KgProvider` for the whole of Wave 1 and was untestable
 * there: the vitest environment is `node`, so any test of it would have had to
 * render a React tree into a DOM that does not exist. Pulling it behind the
 * `Host` port left a plain function taking an event object, and the four guards
 * that decide whether ⌘Z reaches the journal — the chord, the modifiers, the
 * caret, the shift key — are each one assertion now.
 *
 * The globals are stubbed rather than provided by jsdom on purpose. `webHost`
 * touches exactly four things (`addEventListener`, `removeEventListener`,
 * `visibilityState`, `HTMLElement`), and a fake that small keeps the run in the
 * `node` environment the rest of the suite pays for.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webHost } from './host'

type Handler = (event: unknown) => unknown

function fakeEventTarget() {
  const listeners = new Map<string, Set<Handler>>()
  return {
    addEventListener(type: string, fn: Handler) {
      const set = listeners.get(type) ?? new Set<Handler>()
      set.add(fn)
      listeners.set(type, set)
    },
    removeEventListener(type: string, fn: Handler) {
      listeners.get(type)?.delete(fn)
    },
    /**
     * Hands back what each listener returned, which the DOM itself discards.
     *
     * Kept because that return value is the only observable difference between a
     * handler that starts a flush and one that awaits it — see "does not await
     * the flush". An `emit` that dropped it, as this one used to, made that test
     * pass against `async () => { await run() }`.
     */
    emit(type: string, event: unknown): unknown[] {
      return [...(listeners.get(type) ?? [])].map((fn) => fn(event))
    },
    listenerCount(type: string) {
      return listeners.get(type)?.size ?? 0
    },
  }
}

/** Enough of an element for `instanceof` plus the three fields `isTyping` reads. */
class FakeHTMLElement {
  isContentEditable = false
  tagName: string
  // Assigned in the body rather than as a parameter property: `erasableSyntaxOnly`
  // rejects the shorthand, because it is the one class syntax that does not
  // survive type stripping.
  constructor(tagName: string) {
    this.tagName = tagName
  }
}

type KeyChord = {
  key?: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  target?: unknown
}

const keydown = (chord: KeyChord = {}) => ({
  key: 'z',
  metaKey: true,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  target: new FakeHTMLElement('DIV'),
  preventDefault: vi.fn(),
  ...chord,
})

let win: ReturnType<typeof fakeEventTarget>
let doc: ReturnType<typeof fakeEventTarget> & { visibilityState: string }

beforeEach(() => {
  win = fakeEventTarget()
  doc = Object.assign(fakeEventTarget(), { visibilityState: 'visible' })
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', doc)
  vi.stubGlobal('HTMLElement', FakeHTMLElement)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('webHost.onUndoRequest', () => {
  it('reports undo for the chord and redo for the shifted chord', () => {
    const run = vi.fn()
    webHost.onUndoRequest(run)

    win.emit('keydown', keydown())
    win.emit('keydown', keydown({ shiftKey: true }))
    // Ctrl rather than Meta, so Windows and Linux get the same binding.
    win.emit('keydown', keydown({ metaKey: false, ctrlKey: true }))
    // Capital Z is what the browser reports once Shift is down.
    win.emit('keydown', keydown({ key: 'Z', shiftKey: true }))

    expect(run.mock.calls.map(([d]) => d)).toEqual(['undo', 'redo', 'undo', 'redo'])
  })

  it('takes the keystroke off the browser only when it acts on it', () => {
    webHost.onUndoRequest(vi.fn())

    const handled = keydown()
    win.emit('keydown', handled)
    expect(handled.preventDefault).toHaveBeenCalledTimes(1)

    // Find-in-page, save, and the editors' own ⌥⌘Z must all still work.
    const ignored = [keydown({ key: 's' }), keydown({ metaKey: false }), keydown({ altKey: true })]
    for (const event of ignored) win.emit('keydown', event)
    for (const event of ignored) expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('leaves ⌘Z to the browser while the caret is in a text field', () => {
    // Otherwise ⌘Z inside a half-typed note reverted the last RECORD change
    // instead of the last few characters: the text stayed on screen and the only
    // visible effect was some other card silently changing behind the dialog.
    const run = vi.fn()
    webHost.onUndoRequest(run)

    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      win.emit('keydown', keydown({ target: new FakeHTMLElement(tag) }))
    }
    const editable = new FakeHTMLElement('DIV')
    editable.isContentEditable = true
    win.emit('keydown', keydown({ target: editable }))

    expect(run).not.toHaveBeenCalled()
  })

  it('survives a target that is not an element', () => {
    // A keydown reaching `window` from `document` itself carries a target that is
    // not an HTMLElement, and reading `.tagName` off it threw.
    const run = vi.fn()
    webHost.onUndoRequest(run)
    for (const target of [null, doc, {}]) {
      expect(() => win.emit('keydown', keydown({ target }))).not.toThrow()
    }
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('unbinds on unsubscribe', () => {
    const run = vi.fn()
    const stop = webHost.onUndoRequest(run)
    expect(win.listenerCount('keydown')).toBe(1)
    stop()
    expect(win.listenerCount('keydown')).toBe(0)
    win.emit('keydown', keydown())
    expect(run).not.toHaveBeenCalled()
  })
})

describe('webHost.onSuspend', () => {
  it('flushes on pagehide and on the tab going hidden', () => {
    // Both, because neither alone catches every ending: a mobile browser kills a
    // backgrounded tab without firing `pagehide`, and `visibilitychange` is the
    // last event guaranteed to run there.
    const run = vi.fn(async () => {})
    webHost.onSuspend(run)

    win.emit('pagehide', {})
    expect(run).toHaveBeenCalledTimes(1)

    doc.visibilityState = 'hidden'
    doc.emit('visibilitychange', {})
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('ignores a tab coming back into view', () => {
    const run = vi.fn(async () => {})
    webHost.onSuspend(run)

    doc.visibilityState = 'visible'
    doc.emit('visibilitychange', {})

    expect(run).not.toHaveBeenCalled()
  })

  it('does not await the flush', () => {
    // `queue.flush()` settles on a FAILED attempt on purpose, and a handler that
    // blocked on durability would hang on exactly the failure it exists to
    // survive. The listener has to return before the promise does.
    //
    // Asserted as "the listener returned nothing to await". That is the only
    // thing observable from outside: `addEventListener` discards the return
    // value, so a listener written `async () => { await run() }` looks identical
    // from a call site — it is called, it returns immediately, it throws
    // nothing. Which is why the earlier version of this test, which asserted
    // exactly those three things, stayed green against that rewrite. What does
    // change is the returned value: `void run()` yields `undefined`, awaiting
    // yields a pending promise, and Electron's `before-quit` is a caller that
    // would await one.
    let settle = () => {}
    const run = vi.fn(() => new Promise<void>((resolve) => (settle = resolve)))
    webHost.onSuspend(run)

    const returned = win.emit('pagehide', {})
    expect(run).toHaveBeenCalledTimes(1)
    expect(returned).toEqual([undefined])

    settle()
  })

  it('unbinds both listeners on unsubscribe', () => {
    const stop = webHost.onSuspend(vi.fn(async () => {}))
    expect(win.listenerCount('pagehide')).toBe(1)
    expect(doc.listenerCount('visibilitychange')).toBe(1)
    stop()
    expect(win.listenerCount('pagehide')).toBe(0)
    expect(doc.listenerCount('visibilitychange')).toBe(0)
  })
})

/**
 * The half of the port that had no test at all, which is worth naming: both
 * halves of this host listen on the same event, and the two guards that tell
 * them apart are one word each. Dropping `onResume`'s guard — so it answers to
 * every `visibilitychange` rather than to `visible` — left the whole suite
 * green.
 */
describe('webHost.onResume', () => {
  /**
   * `onResume` is optional on the port — a platform with no notion of a tab
   * going away need not answer — so a test has to say out loud that the web
   * host does. `webHost.onResume?.(run)` is the shorter spelling and would have
   * left every "did not fire" assertion below passing against a host that had
   * dropped the method entirely.
   */
  const resume = (run: () => void) => {
    const bind = webHost.onResume
    if (!bind) throw new Error('the web host no longer implements onResume')
    return bind(run)
  }

  it('reports a tab coming back, and says nothing about one going away', () => {
    // What the subscriber does with this is not cheap and is not idempotent: it
    // flushes, re-reads the database, and where another tab has written it
    // adopts those rows and clears the undo stack. Firing it on the way OUT
    // runs all of that at the moment the tab is being suspended — and takes ⌘Z
    // with it on every switch away.
    const run = vi.fn()
    resume(run)

    doc.visibilityState = 'hidden'
    doc.emit('visibilitychange', {})
    expect(run).not.toHaveBeenCalled()

    doc.visibilityState = 'visible'
    doc.emit('visibilitychange', {})
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('does not answer to focus', () => {
    // Clicking back from the URL bar, or dismissing a native dialog, fires
    // `focus` without the tab ever having been in the background — and neither
    // is a moment another tab can have changed the store.
    const run = vi.fn()
    resume(run)

    win.emit('focus', {})
    doc.emit('focus', {})

    expect(run).not.toHaveBeenCalled()
  })

  it('unbinds on unsubscribe', () => {
    const run = vi.fn()
    const stop = resume(run)
    expect(doc.listenerCount('visibilitychange')).toBe(1)
    stop()
    expect(doc.listenerCount('visibilitychange')).toBe(0)

    doc.visibilityState = 'visible'
    doc.emit('visibilitychange', {})
    expect(run).not.toHaveBeenCalled()
  })
})
