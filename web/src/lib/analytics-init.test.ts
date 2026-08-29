/**
 * The events jojo does NOT write.
 *
 * `core/analytics.ts` declares a closed vocabulary and `analytics.test.ts`
 * asserts that every parameter in it is a number or a value from a closed set,
 * so an `employer` cannot be added without a test going red. That covers
 * everything jojo sends on purpose, and it is the whole of what the suite could
 * see.
 *
 * The SDK sends one by itself. `@firebase/analytics` issues a gtag `config` on
 * initialisation, which fires a GA4 `page_view` carrying `page_location` — the
 * full URL — unless the settings say otherwise. jojo's URLs are
 * `/applications/<slug>`, and the slug is minted from the employer name the
 * user typed. So the vendor received the employer, which is the first sentence
 * of the thing `core/analytics.ts` exists to prevent, and no test could fail.
 *
 * This is that test. It reads the settings rather than the vocabulary.
 */

import { describe, expect, it } from 'vitest'
import { ANALYTICS_INIT } from './analytics'

describe('what the analytics SDK is initialised with', () => {
  it('turns off the automatic page_view', () => {
    // The one setting that stops the SDK sending an event jojo never wrote.
    expect(ANALYTICS_INIT.config.send_page_view).toBe(false)
  })

  it('never lets a path or a query reach the vendor', () => {
    /*
     * Disabling `page_view` stops the automatic EVENT. gtag still attaches the
     * current location to every SUBSEQUENT event unless the config overrides
     * it, and jojo reports events from every screen — so pinning this is not
     * belt-and-braces, it is the other half of the same hole.
     */
    const { page_location: where, page_referrer: from } = ANALYTICS_INIT.config
    expect(where.includes('/applications')).toBe(false)
    expect(where.includes('?')).toBe(false)
    expect(from).toBe('')
    // An origin has no path beyond the root: scheme, host, optional port.
    if (where !== '') expect(/^https?:\/\/[^/?#]+$/.test(where)).toBe(true)
  })

  it('sends a fixed title rather than the document’s', () => {
    // A document title on an application page carries the employer too.
    expect(ANALYTICS_INIT.config.page_title).toBe('jojo')
  })
})

describe('the module reaches the SDK entry point that accepts settings', () => {
  it('calls initializeAnalytics, not getAnalytics', async () => {
    /*
     * The two differ in exactly one way that matters: `getAnalytics(app)` takes
     * no settings, so it CANNOT turn the page_view off. A refactor back to it
     * would compile, run, and silently restore the leak — the settings object
     * above would still be exported and still be asserted, and still be passed
     * to nothing.
     */
    const source = (await import('./analytics.ts?raw')).default as string
    const body = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(body).toContain('initializeAnalytics(firebaseApp, ANALYTICS_INIT)')
    expect(body.includes('getAnalytics(')).toBe(false)
  })
})
