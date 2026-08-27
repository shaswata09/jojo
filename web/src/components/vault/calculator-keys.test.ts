/**
 * The calculator's keyboard rules, which used to live in a `useEffect` where
 * nothing could reach them.
 *
 * `HTMLElement` is stubbed rather than provided by jsdom: the vitest
 * environment here is `node`, and the two predicates under test touch exactly
 * three things on an element (`instanceof`, `tagName`, `isContentEditable`). A
 * fake that small keeps the run in the environment the rest of the suite pays
 * for.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isActivationTarget, planCalculatorKey } from './calculator-keys'

/** Enough of an element for `instanceof` plus the two fields the guards read. */
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

const el = (tag: string) => new FakeHTMLElement(tag) as unknown as EventTarget

/** A keystroke with focus nowhere in particular, which is the ordinary case. */
const press = (key: string, target: EventTarget | null = el('DIV')) =>
  planCalculatorKey({ key, target })

beforeEach(() => {
  vi.stubGlobal('HTMLElement', FakeHTMLElement)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Enter while a control has focus', () => {
  it('leaves Enter to the focused button, link or summary', () => {
    /*
     * THE BUG THIS FILE EXISTS FOR. The listener is on `window`, so it saw
     * every Enter on the Vault page, and `preventDefault()` cancels the
     * keystroke's default action — which for a focused button or link IS the
     * click the browser would have fired. Tabbing to the sidebar, the tool
     * tabs, the History toggle or one of this pad's own keys and pressing Enter
     * did nothing whatsoever except silently run equals.
     */
    for (const tag of ['BUTTON', 'A', 'SUMMARY', 'SELECT']) {
      expect(planCalculatorKey({ key: 'Enter', target: el(tag) }), tag).toBeNull()
    }
  })

  it('still takes Enter when focus is not on anything Enter activates', () => {
    // Otherwise the fix would have cost the shortcut it was protecting: typing
    // 2 + 3 leaves focus on the body, and Enter there means equals.
    expect(press('Enter')).toEqual({ action: { kind: 'equals' }, preventDefault: true })
    expect(planCalculatorKey({ key: 'Enter', target: null })).toEqual({
      action: { kind: 'equals' },
      preventDefault: true,
    })
  })

  it('guards Enter only, not the other keys', () => {
    /*
     * A focused button consumes Enter and nothing else, so a digit typed with
     * one focused — which is where a mouse leaves focus after a click on this
     * very pad — still reaches the calculator. `=` too: no element treats it as
     * an activation key, so there is nothing there to steal.
     */
    const button = el('BUTTON')
    expect(planCalculatorKey({ key: '7', target: button })).toEqual({
      action: { kind: 'digit', value: '7' },
      preventDefault: false,
    })
    expect(planCalculatorKey({ key: '=', target: button })).toEqual({
      action: { kind: 'equals' },
      preventDefault: true,
    })
  })
})

describe('the routing table', () => {
  it('reads digits and the decimal point as typed', () => {
    for (const key of ['0', '5', '9', '.']) {
      expect(press(key), key).toEqual({
        action: { kind: 'digit', value: key },
        preventDefault: false,
      })
    }
  })

  it('maps the ascii operators onto the symbols the pad uses', () => {
    // The keyboard has no − × ÷; the display and `Op` have nothing else.
    expect(press('+')?.action).toEqual({ kind: 'operator', op: '+' })
    expect(press('-')?.action).toEqual({ kind: 'operator', op: '−' })
    expect(press('*')?.action).toEqual({ kind: 'operator', op: '×' })
    expect(press('/')?.action).toEqual({ kind: 'operator', op: '÷' })
    expect(press('^')?.action).toEqual({ kind: 'operator', op: '^' })
  })

  it('takes only the keys whose default action would get in the way', () => {
    // `/` opens Firefox's quick-find, and Backspace has been a back button in
    // enough browsers to be worth stopping. Escape and the digits are left as
    // they are, because cancelling a key this pad merely reads is how a
    // shortcut somewhere else quietly stops working.
    expect(press('/')?.preventDefault).toBe(true)
    expect(press('Backspace')).toEqual({ action: { kind: 'backspace' }, preventDefault: true })
    expect(press('Escape')).toEqual({ action: { kind: 'clear' }, preventDefault: false })
    expect(press('+')?.preventDefault).toBe(false)
  })

  it('has no opinion about a key it does not use', () => {
    for (const key of ['a', 'Tab', ' ', 'ArrowUp', 'F5', 'PageDown']) {
      expect(press(key), key).toBeNull()
    }
  })
})

describe('keys headed for a field', () => {
  it('leaves every one of them alone', () => {
    // A calculator that eats what you are typing into a note is worse than one
    // with no keyboard support at all.
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      for (const key of ['7', '+', 'Enter', 'Backspace', 'Escape']) {
        expect(planCalculatorKey({ key, target: el(tag) }), `${tag} ${key}`).toBeNull()
      }
    }
    const editable = new FakeHTMLElement('DIV')
    editable.isContentEditable = true
    expect(planCalculatorKey({ key: '7', target: editable as unknown as EventTarget })).toBeNull()
  })
})

describe('a target that is not an element', () => {
  it('is treated as nowhere in particular rather than throwing', () => {
    // A keydown reaching `window` from `document` itself carries a target that
    // is not an HTMLElement, and reading `.tagName` off it threw.
    for (const target of [null, {} as EventTarget]) {
      expect(() => planCalculatorKey({ key: 'Enter', target })).not.toThrow()
      expect(isActivationTarget(target)).toBe(false)
    }
  })
})

/**
 * The three symptoms the first fix left standing, and the one it introduced.
 *
 * Turning Enter away from every `<button>` reads right and breaks the ordinary
 * flow: the pad's own keys ARE buttons, and a mouse leaves focus on the last one
 * clicked. Containment is the distinction a tag name cannot make.
 */
describe('who owns Enter and Escape', () => {
  /** A calculator root that contains `inside` and nothing else. */
  const pad = (inside: EventTarget) =>
    ({ contains: (node: unknown) => node === inside }) as unknown as HTMLElement

  it('takes Enter from a button INSIDE the pad, which is where a mouse leaves focus', () => {
    // Click 2, +, 3 with the mouse, then press Enter. The first fix returned
    // null here, so the browser re-clicked the focused `3` and appended a digit
    // instead of showing the result.
    const button = el('BUTTON')
    expect(planCalculatorKey({ key: 'Enter', target: button, within: pad(button) })).toEqual({
      action: { kind: 'equals' },
      preventDefault: true,
    })
  })

  it('leaves Enter to a button OUTSIDE the pad', () => {
    const elsewhere = el('BUTTON')
    expect(planCalculatorKey({ key: 'Enter', target: elsewhere, within: pad(el('BUTTON')) })).toBeNull()
  })

  it('leaves Escape to whatever is open over the pad', () => {
    /*
     * The unfixed half: Escape was gated only by `isTypingTarget`, so dismissing
     * the nav drawer or a toast — both of which listen on `window` too — also
     * wiped the display, the accumulator and the pending operator, silently.
     */
    const dialogButton = el('BUTTON')
    expect(planCalculatorKey({ key: 'Escape', target: dialogButton, within: pad(el('DIV')) })).toBeNull()
  })

  it('still clears on Escape when focus is nowhere in particular', () => {
    expect(planCalculatorKey({ key: 'Escape', target: el('BODY'), within: pad(el('DIV')) })).toEqual({
      action: { kind: 'clear' },
      preventDefault: false,
    })
  })
})

/**
 * Modifiers, which were not read at all.
 *
 * `⌘1`…`⌘9` switch browser tabs, `⌘0` resets zoom and `⌃-` zooms out. Every one
 * arrives as a bare `key` of `'1'` or `'-'`, so every one was calling `digit()`
 * or `operator()` — the number on screen changing while the person was doing
 * something else, which is indistinguishable from a typo they did not make.
 */
describe('keys the browser has already spoken for', () => {
  it('ignores a digit held with meta', () => {
    expect(planCalculatorKey({ key: '1', target: el('DIV'), metaKey: true })).toBeNull()
  })

  it('ignores an operator held with control', () => {
    expect(planCalculatorKey({ key: '-', target: el('DIV'), ctrlKey: true })).toBeNull()
  })

  it('ignores alt', () => {
    expect(planCalculatorKey({ key: '5', target: el('DIV'), altKey: true })).toBeNull()
  })

  it('ignores a key something upstream already claimed', () => {
    expect(planCalculatorKey({ key: '7', target: el('DIV'), defaultPrevented: true })).toBeNull()
  })

  it('still takes the same keys unmodified', () => {
    expect(planCalculatorKey({ key: '1', target: el('DIV') })).toEqual({
      action: { kind: 'digit', value: '1' },
      preventDefault: false,
    })
  })
})
