/**
 * When Enter sends a message and when it types a newline.
 *
 * ## Why this is a module and not three lines in an onKeyDown
 *
 * Nothing in this project mounts a component in a test, so a rule written
 * inline in a handler is a rule nothing can check. The interesting cases below
 * are all invisible from reading the JSX — an IME candidate, a modifier held
 * down — and each one is a real way for a chat box to eat somebody's message.
 *
 * ## The IME case is the one that matters
 *
 * Typing Japanese, Chinese or Korean goes through an input method: you type
 * latin letters, a candidate list appears, and **Enter picks the candidate**.
 * That Enter is part of composing a word, not a request to send. A composer
 * that does not check `isComposing` sends a half-typed message every time
 * somebody chooses a character — and it is invisible to anybody testing in
 * English, which is exactly why it survives to production so often.
 *
 * The browser tells us: `KeyboardEvent.isComposing` is true for the whole
 * composition session. React exposes it on `nativeEvent`.
 *
 * ## Modifiers do not send
 *
 * Only a bare Enter sends. Ctrl/Cmd/Alt+Enter deliberately do NOT — some apps
 * make Cmd+Enter a second send shortcut, but here Enter already sends, so the
 * only thing a modifier could add is a way to send by accident while reaching
 * for something else.
 */

/**
 * The parts of a keyboard event this decision uses.
 *
 * Structural rather than `KeyboardEvent`, so a test can state a case as a plain
 * object and so this stays reachable from a file that has no DOM.
 */
export type ComposerKey = {
  key: string
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  /** True while an input method is composing. See the header. */
  isComposing: boolean
}

/**
 * Whether this keypress should send the message.
 *
 * Everything that is not a bare, non-composing Enter answers false and is left
 * to the textarea — which is what puts the newline in on Shift+Enter, without
 * this file having to insert one.
 */
export function shouldSend(event: ComposerKey): boolean {
  if (event.key !== 'Enter') return false
  // An Enter that is choosing an IME candidate belongs to the input method.
  if (event.isComposing) return false
  // The newline, which is the whole point of the pairing.
  if (event.shiftKey) return false
  if (event.ctrlKey || event.metaKey || event.altKey) return false
  return true
}

/**
 * Reads the shape above off a React keyboard event.
 *
 * `isComposing` lives on the native event rather than React's synthetic one,
 * and forgetting that is how the IME bug gets written even by somebody who knew
 * to look for it.
 */
export function fromReactKey(event: {
  key: string
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  nativeEvent: { isComposing?: boolean }
}): ComposerKey {
  return {
    key: event.key,
    shiftKey: event.shiftKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    isComposing: event.nativeEvent.isComposing === true,
  }
}
