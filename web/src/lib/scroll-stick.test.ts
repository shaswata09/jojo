import { describe, expect, it } from 'vitest'
import { STICK_SLACK_PX, atBottom } from './scroll-stick'

describe('whether the transcript stays pinned to its end', () => {
  it('counts a box with nothing to scroll as at its end', () => {
    // An empty conversation, which has to follow its first answer down.
    expect(atBottom(0, 400, 400)).toBe(true)
  })

  it('counts a box scrolled to the last pixel as at its end', () => {
    expect(atBottom(600, 1000, 400)).toBe(true)
  })

  /*
   * The rounding case, and the reason there is any slack at all: a pinned
   * scroller is routinely a pixel or two short of its own end, and treating
   * that as "the reader scrolled up" would unpin the view on the first token.
   *
   * LITERALS, not `STICK_SLACK_PX`. Written in terms of the constant this
   * reads as a test of the tolerance and is in fact a test of arithmetic:
   * mutation-checked, `STICK_SLACK_PX = 0` passed every assertion here, which
   * is the whole defect back — a scroller two device pixels short of its end
   * counts as "scrolled up" and the reader is stranded mid-answer.
   */
  it('tolerates being a few pixels short of it', () => {
    expect(atBottom(598, 1000, 400)).toBe(true)
    expect(atBottom(560, 1000, 400)).toBe(true)
    expect(atBottom(600 - STICK_SLACK_PX, 1000, 400)).toBe(true)
  })

  /*
   * And the tolerance is about one line of a reply, not an arbitrary number:
   * far enough to survive sub-pixel rounding, near enough that a reader who has
   * scrolled up to read anything at all is outside it. Pinned here because the
   * two bounds are the claim the comment in the module makes.
   */
  it('keeps the slack to about one line of prose', () => {
    expect(STICK_SLACK_PX).toBeGreaterThanOrEqual(16)
    expect(STICK_SLACK_PX).toBeLessThanOrEqual(96)
  })

  /*
   * The defect. Someone reading back through a run that is still going must
   * not be dragged to the bottom by the next streamed fragment.
   */
  it('does not count a reader who has scrolled up to read', () => {
    expect(atBottom(600 - STICK_SLACK_PX - 1, 1000, 400)).toBe(false)
    expect(atBottom(0, 4000, 400)).toBe(false)
  })
})
