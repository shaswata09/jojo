import { describe, expect, it } from 'vitest'
import { usageSwitchStart } from '@/components/common/consent-start'

describe('usageSwitchStart', () => {
  it('starts on for a first run whose default is on, though nothing reports yet', () => {
    // `analyticsEnabled()` is false here by design; the switch must not copy it.
    expect(usageSwitchStart(false, false, true)).toBe(true)
  })

  it('starts off for a first run whose build default is off', () => {
    expect(usageSwitchStart(false, false, false)).toBe(false)
  })

  it('shows what is in force once the question has been asked', () => {
    expect(usageSwitchStart(false, true, true)).toBe(false)
    expect(usageSwitchStart(true, true, false)).toBe(true)
  })
})
