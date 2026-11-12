import { describe, expect, it } from 'vitest'
import { isCommitEnter } from './enter-key'

describe('isCommitEnter', () => {
  it('commits on a plain Enter', () => {
    expect(isCommitEnter({ key: 'Enter', keyCode: 13, nativeEvent: { isComposing: false } })).toBe(
      true,
    )
  })

  it('leaves an Enter that is picking an IME candidate alone', () => {
    expect(isCommitEnter({ key: 'Enter', keyCode: 13, nativeEvent: { isComposing: true } })).toBe(
      false,
    )
  })

  it("leaves Safari's composition-ending Enter alone (keyCode 229)", () => {
    expect(isCommitEnter({ key: 'Enter', keyCode: 229, nativeEvent: { isComposing: false } })).toBe(
      false,
    )
  })

  it('ignores other keys', () => {
    expect(isCommitEnter({ key: 'a', nativeEvent: { isComposing: false } })).toBe(false)
  })
})
