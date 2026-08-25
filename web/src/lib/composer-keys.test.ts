import { describe, expect, it } from 'vitest'
import { fromReactKey, shouldSend, type ComposerKey } from './composer-keys'

/** A bare Enter, which is the only combination that sends. */
const enter = (over: Partial<ComposerKey> = {}): ComposerKey => ({
  key: 'Enter',
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  isComposing: false,
  ...over,
})

describe('what sends a message', () => {
  it('sends on a bare Enter', () => {
    expect(shouldSend(enter())).toBe(true)
  })

  it('does NOT send on Shift+Enter — that is the newline', () => {
    expect(shouldSend(enter({ shiftKey: true }))).toBe(false)
  })

  it('ignores every key that is not Enter', () => {
    for (const key of ['a', ' ', 'Tab', 'Escape', 'ArrowUp', 'NumpadEnter']) {
      expect(shouldSend(enter({ key })), key).toBe(false)
    }
  })
})

describe('an input method is composing', () => {
  it('never sends, whatever else is held', () => {
    /*
     * The bug this whole module exists for. Typing Japanese, Chinese or Korean,
     * Enter CHOOSES A CANDIDATE from the IME's list — it is part of typing a
     * word. Sending there fires off a half-written message on every character,
     * and somebody testing in English will never once see it happen.
     */
    expect(shouldSend(enter({ isComposing: true }))).toBe(false)
    expect(shouldSend(enter({ isComposing: true, shiftKey: true }))).toBe(false)
  })
})

describe('modifiers', () => {
  it('does not send when one is held', () => {
    // Enter already sends, so a modifier can only add a way to send by accident
    // while reaching for something else.
    expect(shouldSend(enter({ ctrlKey: true }))).toBe(false)
    expect(shouldSend(enter({ metaKey: true }))).toBe(false)
    expect(shouldSend(enter({ altKey: true }))).toBe(false)
  })
})

describe('reading a React event', () => {
  it('takes isComposing off the NATIVE event', () => {
    /*
     * React's synthetic event does not carry `isComposing`; the native one
     * does. Reading it from the wrong object yields `undefined`, which is
     * falsy, which silently reintroduces the IME bug — so this asserts the
     * hop rather than trusting it.
     */
    const composing = fromReactKey({
      key: 'Enter',
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      nativeEvent: { isComposing: true },
    })
    expect(composing.isComposing).toBe(true)
    expect(shouldSend(composing)).toBe(false)
  })

  it('treats a missing isComposing as not composing', () => {
    const plain = fromReactKey({
      key: 'Enter',
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      nativeEvent: {},
    })
    expect(plain.isComposing).toBe(false)
    expect(shouldSend(plain)).toBe(true)
  })

  it('carries the modifiers across', () => {
    const shifted = fromReactKey({
      key: 'Enter',
      shiftKey: true,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      nativeEvent: { isComposing: false },
    })
    expect(shouldSend(shifted)).toBe(false)
  })
})
