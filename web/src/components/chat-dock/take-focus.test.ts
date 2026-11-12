import { describe, expect, it } from 'vitest'
import { shouldTakeFocus } from './take-focus'

const base = { open: true, showing: 'w1', wasShowing: 'w1', dockUsed: false }

describe('shouldTakeFocus', () => {
  it('does not steal focus when a reload restores an open window', () => {
    expect(shouldTakeFocus({ ...base, wasOpen: null, wasShowing: null })).toBe(false)
  })

  it('takes it when a window the person opened mounts', () => {
    expect(shouldTakeFocus({ ...base, wasOpen: null, wasShowing: null, dockUsed: true })).toBe(true)
  })

  it('takes it when a minimised window is opened out', () => {
    expect(shouldTakeFocus({ ...base, wasOpen: false })).toBe(true)
  })

  it('does nothing on a re-render that changed nothing', () => {
    expect(shouldTakeFocus({ ...base, wasOpen: true, dockUsed: true })).toBe(false)
  })

  it('never focuses a minimised window', () => {
    expect(shouldTakeFocus({ ...base, open: false, wasOpen: null, dockUsed: true })).toBe(false)
  })

  it('takes it when a reused window switches to another conversation', () => {
    expect(shouldTakeFocus({ ...base, wasOpen: true, wasShowing: 'w0', dockUsed: true })).toBe(true)
  })
})
