/**
 * Q333: a search result lands ON the setting it named.
 *
 * The hook itself is DOM and timers (D20 — nothing mounts here); what is tested
 * is the decision it makes each frame, and the URLs that hand it an id.
 */

import { describe, expect, it } from 'vitest'
import {
  ARRIVAL_FALLBACK_MS,
  ARRIVAL_HIGHLIGHT_MS,
  ARRIVAL_WAIT_MS,
  arrivalTarget,
  focusSelector,
  offCentre,
  replayArrivalHighlights,
} from '@/lib/use-arrival-highlight'
import { guidePath, profilePath, scoutPath, settingsPath, statisticsPath } from '@/lib/links'

const on = (...ids: string[]) => {
  const present = new Set(ids)
  return (id: string) => (present.has(id) ? id : null)
}

describe('arriving at a focused place (Q333)', () => {
  it('lands on the named element as soon as it is drawn', () => {
    expect(arrivalTarget(on('model-api-key', 'model'), 'model-api-key', 'model', 0)).toBe(
      'model-api-key',
    )
  })

  it('waits for a late row before settling for its panel', () => {
    const find = on('model')
    expect(arrivalTarget(find, 'model-api-key', 'model', 0)).toBeNull()
    expect(arrivalTarget(find, 'model-api-key', 'model', ARRIVAL_FALLBACK_MS - 1)).toBeNull()
    expect(arrivalTarget(find, 'model-api-key', 'model', ARRIVAL_FALLBACK_MS)).toBe('model')
  })

  it('lands nowhere when neither the row nor a fallback exists', () => {
    expect(arrivalTarget(on(), 'skipped', undefined, ARRIVAL_WAIT_MS)).toBeNull()
    expect(arrivalTarget(on(), 'model-api-key', 'model', ARRIVAL_WAIT_MS)).toBeNull()
  })

  it('gives up looking long after the highlight would have faded anyway', () => {
    expect(ARRIVAL_FALLBACK_MS).toBeLessThan(ARRIVAL_WAIT_MS)
    expect(ARRIVAL_WAIT_MS).toBeGreaterThan(ARRIVAL_HIGHLIGHT_MS)
  })

  it('quotes the id it selects by, so no id can break the selector', () => {
    expect(focusSelector('appearance-theme')).toBe('[data-focus-id="appearance-theme"]')
    expect(focusSelector('keyword:a"b\\c')).toBe('[data-focus-id="keyword:a\\"b\\\\c"]')
  })

  it('carries the id in the URL of every page that can be arrived at', () => {
    expect(settingsPath({ focus: 'appearance-theme' })).toBe('/settings?focus=appearance-theme')
    expect(profilePath({ focus: 'profile-email' })).toBe('/profile?focus=profile-email')
    expect(profilePath()).toBe('/profile')
    expect(statisticsPath({ focus: 'stats-roles' })).toBe('/statistics?focus=stats-roles')
    expect(statisticsPath()).toBe('/statistics')
    expect(scoutPath({ focus: { kind: 'pipeline', id: 'p1' } })).toBe('/scout?focus=pipeline%3Ap1')
    expect(guidePath('screens', 'vault')).toBe('/guide/screens#vault')
    expect(guidePath('overview', 'dates')).toBe('/guide#dates')
    expect(guidePath('licence')).toBe('/guide/licence')
  })
})

describe('staying on the row while the page settles (review 2: web-a11y-1, web-lib-4)', () => {
  it('re-centres a row that growth above it pushed out of the middle of the screen', () => {
    // Measured at 360×780: the capture panel grew after the scroll and left the
    // Theme row at top 969 — below the screen.
    expect(offCentre({ top: 969, bottom: 1061 }, 780)).toBe(true)
    // At 1280×900 it stayed on screen but 95px off the bottom edge.
    expect(offCentre({ top: 744, bottom: 805 }, 900)).toBe(true)
    // Centred, it is left alone, so a settled page is never scrolled again.
    expect(offCentre({ top: 389, bottom: 481 }, 780)).toBe(false)
    expect(offCentre({ top: 427, bottom: 488 }, 900)).toBe(false)
  })

  it('replays the fade on a second arrival at the same row', () => {
    const animation = { currentTime: 1500 as number | null }
    const row = { getAnimations: () => [animation] }
    const root = { querySelectorAll: () => [row] } as unknown as ParentNode
    replayArrivalHighlights(root)
    expect(animation.currentTime).toBe(0)
  })
})
