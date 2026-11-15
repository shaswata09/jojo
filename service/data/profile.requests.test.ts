/**
 * Q153 — the demo applicant (G6).
 *
 * The owner asked for "Alex Rahman" to go everywhere, and for the demo profile
 * to carry his own details: Santa Clara, region US, role Assistant professor.
 * The name and links were later replaced by a fictional applicant on purpose
 * (see `seedProfile`'s comment: a stranger's first launch showed the
 * maintainer's identity, and drafts signed off as him). What is pinned here is
 * the part of the request that still stands, and the name the owner then chose
 * for the fictional applicant (2026-11-15).
 */
import { describe, expect, it } from 'vitest'
import { seedProfile } from './profile'
import * as profile from './profile'
import * as demoApplications from './demo-applications'
import * as timeline from './timeline'
import * as vault from './vault'
import * as scout from './scout'
import * as labels from './labels'

/** Every demo fixture, as data: exported values, and what zero-argument builders return. */
const fixtures = [profile, demoApplications, timeline, vault, scout, labels].flatMap((mod) =>
  Object.values(mod as Record<string, unknown>).map((v) =>
    typeof v === 'function' && v.length === 0 ? (v as () => unknown)() : v,
  ),
)

describe('the demo profile (Q153)', () => {
  it('is in Santa Clara, searching the US for an Assistant professor role', () => {
    const { text } = seedProfile()
    expect(text.location).toBe('Santa Clara, CA')
    expect(text.regions).toBe('US')
    expect(text.targetRoles).toBe('Assistant professor')
  })

  it('is called Lonardo Jenson, the name the owner chose', () => {
    expect(seedProfile().text.fullName).toBe('Lonardo Jenson')
  })

  it('names nobody called Alex Rahman, in any demo fixture', () => {
    const text = JSON.stringify(fixtures, (_k, v: unknown) => (typeof v === 'function' ? undefined : v))
    expect(text.length).toBeGreaterThan(5000)
    expect(text).toContain('Santa Clara')
    expect(text).not.toMatch(/Rahman/i)
  })
})
