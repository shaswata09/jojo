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
import { hostOf, normalizeUrl, openHref, parseUrl, pathLabel, titleFromUrl } from './url'

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
    expect(pathLabel('https://linkedin.com/in/shaswatamitra')).toBe('linkedin.com/in/shaswatamitra')
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
    expect(parseUrl('mailto:mockemail@email.com')).toBeNull()
    expect(parseUrl('https://jobs.rice.edu')?.hostname).toBe('jobs.rice.edu')
  })

  it('titleFromUrl leads with the page and keeps the host for context', () => {
    expect(titleFromUrl(new URL(RICE))).toBe('jobs.rice.edu — 1')
    expect(titleFromUrl(new URL('https://www.jobs.rice.edu/'))).toBe('jobs.rice.edu')
  })
})

/**
 * What the open button beside a URL field is allowed to navigate to.
 *
 * The refusals are the interesting half. This runs on a value the user is still
 * typing, so it is asked about half-written nonsense far more often than about
 * a finished address, and every case below is a string that reaches it.
 */
describe('openHref', () => {
  it('opens a full address unchanged, query string and all', () => {
    expect(openHref('https://scholar.google.com/citations?user=drsx2nkAAAAJ&hl=en')).toBe(
      'https://scholar.google.com/citations?user=drsx2nkAAAAJ&hl=en',
    )
  })

  it('fills in the scheme people leave off', () => {
    expect(openHref('github.com/shaswata09')).toBe('https://github.com/shaswata09')
    expect(openHref('  linkedin.com/in/shaswatamitra  ')).toBe(
      'https://linkedin.com/in/shaswatamitra',
    )
  })

  it('offers nothing for an empty or half-typed field', () => {
    expect(openHref('')).toBeUndefined()
    expect(openHref('   ')).toBeUndefined()
    expect(openHref('htt')).toBeUndefined()
    expect(openHref('my site')).toBeUndefined()
  })

  it('refuses a host with no dot in it', () => {
    // `new URL` is happy with these and a link to one goes nowhere.
    expect(openHref('http://localhost:11434')).toBeUndefined()
    expect(openHref('notes')).toBeUndefined()
  })

  it('refuses a scheme that is not http', () => {
    expect(openHref('javascript:alert(1)')).toBeUndefined()
    expect(openHref('ftp://files.rice.edu')).toBeUndefined()
    expect(openHref('data:text/html,hi')).toBeUndefined()
  })

  it('refuses an email rather than normalising it into a website', () => {
    // The trap: `normalizeUrl` only looks for `scheme://`, so this would become
    // `https://mailto:mockemail@email.com` — which parses, as username `mailto`
    // on host `email.com`, and offers to open a site nobody named.
    expect(openHref('mailto:mockemail@email.com')).toBeUndefined()
    expect(openHref('tel:+15550100')).toBeUndefined()
  })

  it('still normalises a host that carries a port', () => {
    // `jobs.rice.edu:8080` looks like an opaque scheme to a careless regex.
    expect(openHref('jobs.rice.edu:8080/postings')).toBe('https://jobs.rice.edu:8080/postings')
  })
})
