/**
 * The Enter that commits a one-line field, and the Enter that does not.
 *
 * Typing Japanese, Chinese or Korean goes through an input method, and Enter
 * there picks a candidate — it is part of composing the word, not a request to
 * save it. Every inline "type a name, press Enter" field committed a half-typed
 * word on that key. `lib/composer-keys.ts` already handles this for the chat
 * composers; that rule also refuses Shift+Enter (the newline), which a one-line
 * field has no use for, so this is the narrower question.
 *
 * Two signals, because browsers disagree: `isComposing` is the standard one,
 * and Safari reports the Enter that ENDS a composition with `isComposing` false
 * but `keyCode` 229 ("an IME is processing this key").
 */

export type EnterKey = {
  key: string
  keyCode?: number
  nativeEvent?: { isComposing?: boolean; keyCode?: number }
}

/** Whether an IME owns this keypress. */
export function isImeKey(event: EnterKey): boolean {
  return (
    event.nativeEvent?.isComposing === true ||
    event.keyCode === 229 ||
    event.nativeEvent?.keyCode === 229
  )
}

/** A plain Enter that the field should treat as "done" — not an IME's. */
export function isCommitEnter(event: EnterKey): boolean {
  return event.key === 'Enter' && !isImeKey(event)
}
