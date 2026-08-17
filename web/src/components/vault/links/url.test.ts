/**
 * One saved URL, rendered on four screens, reading the same on all of them.
 *
 * There were four spellings of "the host of this URL" in the component layer
 * and they gave three different answers for
 * `https://www.jobs.rice.edu/postings/1/`. The cases below are chosen to be the
 * ones that told them apart: a `www.` prefix (kept by two of the four), a path
 * (kept by two), a trailing slash (kept by one), a port (kept by one) and a
 * missing scheme (which made one of them throw and fall back to the raw string).
 * Any of the three deleted implementations fails at least one of these.
 */

import { describe, expect, it } from 'vitest'
import { hostOf, normalizeUrl, parseUrl, pathLabel, titleFromUrl } from './url'

const RICE = 'https://www.jobs.rice.edu/postings/1/'

describe('hostOf', () => {
  it('is the host alone, without www., path, trailing slash or query', () => {
    expect(hostOf(RICE)).toBe('jobs.rice.edu')
    expect(hostOf('https://stripe.com/jobs/listing/ml-engineer?utm_source=x')).toBe('stripe.com')
  })

  it('reads a posting saved the way it was typed, with no scheme', () => {
    // The seeded postings carry no scheme. `new URL` throws on those, which is
    // how one of the old copies came to render a whole path where the other
    // three rendered a host.
    expect(hostOf('jobs.rice.edu/postings/29411')).toBe('jobs.rice.edu')
  })

  it('keeps a port, which is part of the address, and drops nothing else', () => {
    expect(hostOf('http://localhost.dev:5173/x')).toBe('localhost.dev')
  })

  it('answers undefined rather than guessing when the string is not an address', () => {
    // The draft dialog fills `[PORTAL]` from this. A blank placeholder is
    // visible in the composed email and a half-parsed one is not, so the
    // fallback has to be the caller's choice.
    expect(hostOf('')).toBeUndefined()
    expect(hostOf('not a url')).toBeUndefined()
    expect(hostOf('localhost')).toBeUndefined()
  })
})

describe('pathLabel', () => {
  it('keeps the path, because a link row names a page and not a host', () => {
    expect(pathLabel(RICE)).toBe('www.jobs.rice.edu/postings/1')
  })

  it('is what the vault rendered before hostOf existed, unchanged', () => {
    expect(pathLabel('https://linkedin.com/in/alexr')).toBe('linkedin.com/in/alexr')
  })
})

describe('the readers hostOf is built on', () => {
  it('normalizeUrl fills in a missing scheme and leaves a present one alone', () => {
    expect(normalizeUrl('  jobs.rice.edu ')).toBe('https://jobs.rice.edu')
    expect(normalizeUrl('http://jobs.rice.edu')).toBe('http://jobs.rice.edu')
    expect(normalizeUrl('   ')).toBe('')
  })

  it('parseUrl refuses a dotless host and a non-http scheme', () => {
    expect(parseUrl('https://localhost')).toBeNull()
    expect(parseUrl('mailto:alex@university.edu')).toBeNull()
    expect(parseUrl('https://jobs.rice.edu')?.hostname).toBe('jobs.rice.edu')
  })

  it('titleFromUrl leads with the page and keeps the host for context', () => {
    expect(titleFromUrl(new URL(RICE))).toBe('jobs.rice.edu — 1')
    expect(titleFromUrl(new URL('https://www.jobs.rice.edu/'))).toBe('jobs.rice.edu')
  })
})
