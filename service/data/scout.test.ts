/**
 * The demo pipelines start switched off.
 *
 * Two of them name real boards (cra.org and higheredjobs.com). Seeded on, a new
 * person who only added a model found the scout crawling both on a daily timer
 * in their own browser, because of demo data they never chose. Only new seeds
 * are affected; a stored pipeline keeps whatever its owner set.
 */

import { describe, expect, it } from 'vitest'
import { parseSources } from '../kg/core/board'
import { pipelines } from './scout'

describe('the demo pipelines', () => {
  it('are all seeded switched off', () => {
    for (const p of pipelines) expect(p.enabled, p.id).toBe(false)
  })

  it('still point at real boards, so turning one on works', () => {
    const named = pipelines.flatMap((p) => parseSources(p.source))
    expect(named).toContain('https://cra.org/ads')
    expect(named).toContain('https://higheredjobs.com/faculty')
  })
})
