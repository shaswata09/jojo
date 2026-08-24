import { describe, expect, it } from 'vitest'
import { openHref } from './urls'

/**
 * What the open button beside a URL field is allowed to navigate to.
 *
 * Scoped to `openHref` because that is what is new here; the rest of `urls.ts`
 * predates this file and is still covered only by the screens that use it.
 *
 * The refusals are the interesting half. This runs on a value the user is still
 * typing, so it is asked about half-written nonsense far more often than about a
 * finished address, and every case below is a string that reaches it. It runs on
 * Node here and on `react-native-url-polyfill` on the phone — `polyfills.ts`
 * explains why the difference matters, and it is the throwing behaviour of `new
 * URL` that both the refusals below depend on.
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
    // Which is what keeps the button off the Settings endpoint field, where the
    // value is `http://localhost:11434` and a browser is not the point.
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
