import { isTypingTarget } from '@/components/common/typing-target'
import type { Op } from '@jojo/service/core/calculator'

/**
 * Which key does what on the calculator pad, and which keys it takes off the
 * browser.
 *
 * ## Why this is a module and not fifteen lines in a `useEffect`
 *
 * Nothing in this project mounts a component in a test, so a rule written
 * inline in a window listener is a rule nothing can check — and one of the
 * rules below was wrong in a way that reading the JSX does not show, because
 * the damage was to elements the calculator has never heard of.
 *
 * ## Enter belongs to whatever is focused
 *
 * The listener is on `window`, and the pad shares the Vault page with the
 * sidebar's links, the tool tabs, the History toggle and its own keypad.
 * `preventDefault()` on Enter does not merely stop scrolling: for a focused
 * `<button>` or `<a href>` the keystroke's DEFAULT ACTION *is* the click the
 * browser synthesises. So with the Tools tab open, tabbing to any control on
 * the page and pressing Enter did nothing at all — no navigation, no click, no
 * visible response — except silently run the calculator's equals. Every button
 * on the page, this pad's own included, was dead for anyone not using a mouse,
 * and a mouse is exactly what nobody hitting this bug was using.
 *
 * So Enter is left alone whenever something Enter activates has focus. The
 * calculator still gets it when focus is nowhere in particular, which is where
 * focus is for the whole of "type 2 + 3 and press Enter".
 */

/**
 * The parts of a keydown this decision reads.
 *
 * Structural rather than `KeyboardEvent`, so a test can state a case as a plain
 * object without a DOM to build one in.
 */
export type CalculatorKey = {
  key: string
  target: EventTarget | null
  /**
   * The calculator's own element, when the caller can supply one.
   *
   * Enter and Escape are both keys somebody ELSE on the page may already own —
   * a focused link, an open dialog — and tag names cannot tell those apart from
   * the pad's own buttons, which are `<button>` too. Containment can.
   */
  within?: HTMLElement | null
  /**
   * Modifier state. `⌘1`…`⌘9` switch browser tabs, `⌘0` resets zoom and `⌃-`
   * is a zoom-out — every one of them was reaching `digit()` and `operator()`
   * and silently changing the displayed number behind the person's back.
   */
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  /** Something upstream already claimed this key. */
  defaultPrevented?: boolean
}

/** What a handled key asks the pad to do. */
export type CalculatorAction =
  | { kind: 'digit'; value: string }
  | { kind: 'operator'; op: Op }
  | { kind: 'equals' }
  | { kind: 'backspace' }
  | { kind: 'clear' }

/**
 * `preventDefault` travels WITH the action rather than being decided at the
 * call site: taking a key off the browser and acting on it are one decision,
 * and splitting them is how a key ends up cancelled by a branch that then
 * declines to handle it.
 */
export type CalculatorKeyPlan = { action: CalculatorAction; preventDefault: boolean }

/**
 * Tags for which Enter is the browser's own activation key.
 *
 * Tag names are enough here: every custom-looking control in this app is a real
 * `<button>` underneath — the `role="button"`, `"radio"` and `"checkbox"`
 * attributes it uses all sit on buttons — so there is no ARIA role list to keep
 * in step with the markup. `SELECT` overlaps with `isTypingTarget`, which
 * already turns those away; it stays so that this predicate answers correctly
 * on its own rather than only in the order the two happen to be called.
 */
const ACTIVATED_BY_ENTER = new Set(['A', 'BUTTON', 'SELECT', 'SUMMARY'])

/**
 * Whether Enter on this element is already spoken for.
 *
 * `instanceof HTMLElement` rather than a truthy check on `tagName`: a keydown
 * that reaches `window` from `document` itself, or from a shadow root, carries
 * a target that is not an element at all.
 */
export function isActivationTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return ACTIVATED_BY_ENTER.has(target.tagName)
}

/**
 * Whether something other than the calculator has a claim on this keystroke.
 *
 * `body` and a non-element target both mean "focus is nowhere in particular",
 * which is the pad's case. Anything else is asked whether the calculator
 * contains it — and when the caller cannot say where the calculator is, the old
 * tag-name rule stands in, so this is never LESS careful than it was.
 */
function ownedElsewhere(target: EventTarget | null, within: HTMLElement | null | undefined): boolean {
  if (!(target instanceof HTMLElement)) return false
  // By tag, not by `=== ownerDocument.body`: this runs against a keydown whose
  // target may come from a shadow root or another document, and the question is
  // "is focus nowhere in particular", which the tag answers on its own.
  if (target.tagName === 'BODY') return false
  if (within === null || within === undefined) return isActivationTarget(target)
  return !within.contains(target)
}

/**
 * The pad's reading of one keystroke, or `null` to leave it to the browser.
 *
 * `null` is deliberately the answer for anything unrecognised as well as for
 * the two guards, so that a key this pad has no opinion about is never
 * cancelled on its way somewhere else.
 */
export function planCalculatorKey({
  key,
  target,
  within,
  ctrlKey,
  metaKey,
  altKey,
  defaultPrevented,
}: CalculatorKey): CalculatorKeyPlan | null {
  // Already claimed. Acting on it as well is how one keystroke does two things.
  if (defaultPrevented === true) return null

  /*
   * Any modifier, and the pad has no opinion.
   *
   * `⌘1`…`⌘9` switch browser tabs, `⌘0` resets zoom, `⌃-` zooms out — all of
   * them arrive here as a bare `key` of `'1'` or `'-'`, and all of them were
   * calling `digit()` and `operator()`. The number on screen changed while the
   * person was doing something else entirely, which is the worst shape a bug
   * in a calculator can take: silent, and indistinguishable from a typo.
   */
  if (ctrlKey === true || metaKey === true || altKey === true) return null

  // Never swallow keys meant for a field elsewhere on the page. The shared
  // helper rather than a third copy of the rule: the copy this replaced had
  // drifted already, missing `SELECT` that the other two carry.
  if (isTypingTarget(target)) return null

  /*
   * Enter and Escape belong to whoever has focus, unless that is the pad.
   *
   * The first fix here turned Enter away from every `<button>`, which reads
   * right and breaks the ordinary flow: the pad's own keys ARE buttons, and a
   * mouse leaves focus on the last one clicked. So `2`, `+`, `3` by mouse then
   * Enter stopped showing a result and re-clicked the `3`.
   *
   * Containment is the distinction tag names cannot make, and it is what the
   * audit recommended. `body` counts as the pad's: focus nowhere in particular
   * is the whole of "type 2 + 3 and press Enter", and no dialog or link owns
   * the key in that state.
   */
  if ((key === 'Enter' || key === 'Escape') && ownedElsewhere(target, within)) return null

  if (/^[0-9]$/.test(key) || key === '.') {
    return { action: { kind: 'digit', value: key }, preventDefault: false }
  }
  if (key === '+') return { action: { kind: 'operator', op: '+' }, preventDefault: false }
  if (key === '-') return { action: { kind: 'operator', op: '−' }, preventDefault: false }
  if (key === '*') return { action: { kind: 'operator', op: '×' }, preventDefault: false }
  if (key === '^') return { action: { kind: 'operator', op: '^' }, preventDefault: false }
  // `/` is Firefox's quick-find, which would open a search bar under the pad on
  // every division.
  if (key === '/') return { action: { kind: 'operator', op: '÷' }, preventDefault: true }
  if (key === 'Enter' || key === '=') return { action: { kind: 'equals' }, preventDefault: true }
  if (key === 'Backspace') return { action: { kind: 'backspace' }, preventDefault: true }
  if (key === 'Escape') return { action: { kind: 'clear' }, preventDefault: false }
  return null
}
