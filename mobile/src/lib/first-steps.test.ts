/**
 * When the first-steps checklist is on screen.
 *
 * The rule failed in both directions before it was a rule: it latched on "the
 * store is completely empty" in component state, so a person who added an
 * application and reopened the app lost the two steps they had not done, and a
 * person who pressed "hide these steps" got them back on the next launch.
 */
import { describe, expect, it } from 'vitest'
import { allDone, showFirstSteps } from './first-steps'

const steps = (a: boolean, d: boolean, r: boolean) => ({ application: a, dated: d, reminder: r })

describe('showFirstSteps', () => {
  it('stays up while any step is outstanding', () => {
    // THE case. One of three done is exactly when a checklist is most useful,
    // and exactly when the old rule hid it.
    expect(showFirstSteps(steps(true, false, false), false)).toBe(true)
    expect(showFirstSteps(steps(true, true, false), false)).toBe(true)
    expect(showFirstSteps(steps(false, false, false), false)).toBe(true)
  })

  it('goes when the three are done', () => {
    expect(showFirstSteps(steps(true, true, true), false)).toBe(false)
  })

  it('stays gone once dismissed, however empty the store gets', () => {
    // The other direction: dismissing is a fact about the person, and clearing
    // the records is not a reason to ask them again.
    expect(showFirstSteps(steps(false, false, false), true)).toBe(false)
    expect(showFirstSteps(steps(true, false, false), true)).toBe(false)
  })

  it('renders nothing at all until the stored answer has arrived', () => {
    // `null` is "still reading". Guessing either way flickers: "shown" flashes
    // the panel at somebody who dismissed it, "hidden" hides it for a frame
    // from the person it is for. Rendering neither is the honest third state.
    expect(showFirstSteps(steps(false, false, false), null)).toBe(false)
    expect(showFirstSteps(steps(true, true, true), null)).toBe(false)
  })
})

describe('allDone', () => {
  it('needs all three, not a majority', () => {
    expect(allDone(steps(true, true, true))).toBe(true)
    for (const s of [steps(false, true, true), steps(true, false, true), steps(true, true, false)]) {
      expect(allDone(s)).toBe(false)
    }
  })
})
