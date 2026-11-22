/**
 * jojo's privacy notice, in its two copies (2026-11-21).
 *
 * `docs/PRIVACY.md` is the text; `web/public/privacy.html` is the same text as
 * a page, served with the web app and linked from the phone, the extension, the
 * README and the Guide. Two copies of a notice are two chances for one of them
 * to stop saying what the other does — the exact drift `core/cloud-terms.ts`
 * was written to end for the provider notice — so what is pinned here is that
 * they agree on their structure and their date, that the page loads nothing
 * from anywhere, and that the claims it makes are the ones the code backs.
 *
 * Not the wording, which is free to improve. The claims below are the ones a
 * reader would act on, each tied to the file that makes it true.
 */
import { describe, expect, it } from 'vitest'
import { PRIVACY_PAGE, PRIVACY_URL } from '@jojo/service/core/privacy'
import { EVENTS } from '@jojo/service/core/analytics'

// `node:*` through a dynamic import with a narrow cast: the web tsconfig has no
// Node types, and the house pattern (see Onboarding.requests.test.ts) keeps it so.
const { readFileSync } = (
  // @ts-expect-error TS2307 — node:fs has no types under tsconfig.app.json (house pattern, Onboarding.requests.test.ts).
  await import('node:fs')
) as {
  readFileSync: (p: string, enc: 'utf8') => string
}
const path = (
  // @ts-expect-error TS2307 — node:path has no types under tsconfig.app.json (house pattern, Onboarding.requests.test.ts).
  await import('node:path')
) as {
  join: (...parts: string[]) => string
  resolve: (...parts: string[]) => string
  dirname: (p: string) => string
}
const { fileURLToPath } = (
  // @ts-expect-error TS2307 — node:url has no types under tsconfig.app.json (house pattern, Onboarding.requests.test.ts).
  await import('node:url')
) as { fileURLToPath: (u: string | URL) => string }


const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const markdown = readFileSync(path.join(ROOT, 'docs', 'PRIVACY.md'), 'utf8')
const page = readFileSync(path.join(ROOT, 'web', 'public', PRIVACY_PAGE), 'utf8')

/** Text of the page with tags and entities flattened, for phrase searches. */
const pageText = page
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')
const mdText = markdown.replace(/\*\*|`/g, '').replace(/\s+/g, ' ')

const headings = (text: string, pattern: RegExp) =>
  [...text.matchAll(pattern)].map((m) => (m[1] ?? '').replace(/&amp;/g, '&').trim())

describe('the privacy notice', () => {
  it('is published where core says it is', () => {
    expect(PRIVACY_URL.endsWith(`/${PRIVACY_PAGE}`)).toBe(true)
    expect(markdown).toContain(PRIVACY_URL)
  })

  it('has the same sections, in the same order, in both copies', () => {
    const md = headings(markdown, /^#{2,3} (.+)$/gm)
    const html = headings(page, /<h[23][^>]*>([\s\S]*?)<\/h[23]>/g)
    expect(md.length).toBeGreaterThan(10)
    expect(html).toEqual(md)
  })

  it('carries one effective date, the same in both', () => {
    const date = /Effective date: ([0-9]{1,2} [A-Z][a-z]+ [0-9]{4})/
    expect(date.exec(markdown)?.[1]).toBe('21 November 2026')
    expect(date.exec(page)?.[1]).toBe('21 November 2026')
  })

  it('loads nothing from anywhere — no script, no external style, font or image', () => {
    expect(page).not.toMatch(/<script/i)
    expect(page).not.toMatch(/<link\b/i)
    expect(page).not.toMatch(/<img\b/i)
    expect(page).not.toMatch(/@import|url\(/i)
    expect(page).toMatch(/content="default-src 'none'; style-src 'unsafe-inline'/)
  })

  it('works in both colour schemes and at phone width', () => {
    expect(page).toContain('name="viewport" content="width=device-width, initial-scale=1"')
    expect(page).toContain('@media (prefers-color-scheme: dark)')
  })

  it('names who is responsible and how to reach them, and nothing else as contact', () => {
    for (const text of [mdText, pageText]) {
      expect(text).toContain('Shaswata Mitra')
      expect(text).toContain('https://github.com/shaswata09/jojo/issues')
      expect(text).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i)
    }
  })

  /*
   * The claims a reader acts on, against the code that makes each true. If one
   * of these files changes what it does, the notice is the thing to update.
   */
  it('describes the analytics vocabulary core actually allows', () => {
    // Sixteen events; the notice lists each in words. If
    // the vocabulary grows, this fails until the notice says what was added.
    expect([...EVENTS].sort()).toEqual(
      [
        'app_opened',
        'screen_viewed',
        'application_created',
        'application_advanced',
        'assistant_asked',
        'assistant_tool_decided',
        'scout_pipeline_started',
        'scout_proposal_decided',
        'vault_item_added',
        'model_connected',
        'reader_connected',
        'backup_used',
        'transfer_completed',
        'tour_used',
        'model_failed',
        'error_caught',
      ].sort(),
    )
    for (const text of [mdText, pageText]) {
      expect(text).toContain('(0, 1, 2–5, 6–20, 21–50, 50+)')
      expect(text).toContain('The error message is not sent.')
    }
  })

  it('says both reporting switches start off, and how to stop each', () => {
    for (const text of [mdText, pageText]) {
      expect(text).toContain('both are off until you turn them on')
      expect(text).toContain('deletes the analytics cookies')
      expect(text).toContain('it resets the analytics data')
      expect(text).toContain('reports that have not been sent yet are deleted')
      expect(text).toContain('at most 14 months')
      expect(text).toContain('Crashlytics keeps crash reports for 90 days')
    }
  })

  it('says what a model provider receives, including other people’s details and background work', () => {
    for (const text of [mdText, pageText]) {
      expect(text).toContain("other people's details")
      expect(text).toContain('the duplicate check when you save an application')
      expect(text).toContain('your own agreement with that provider')
    }
  })

  // Crashlytics and Google Analytics sit under different Google terms: the
  // Firebase DPST covers Crashlytics, but Analytics for Firebase is governed by
  // the Google Ads Data Processing Terms accepted on the analytics property. An
  // earlier draft put both under the Firebase terms, which named the wrong
  // contract for half of what is sent.
  it('names the processing terms that actually cover each Google service', () => {
    for (const text of [mdText, pageText]) {
      expect(text).toContain(
        'Crash reports (Firebase Crashlytics): the Firebase Data Processing and Security Terms',
      )
      expect(text).toContain(
        'Usage analytics (Google Analytics for Firebase): the Google Ads Data Processing Terms',
      )
      expect(text).toContain('settings for sharing data with Google are turned off')
      expect(text).not.toContain(
        'For usage analytics and crash reports, Google acts as a processor for the maintainer, under the Firebase',
      )
    }
  })

  // "Download a backup exports all of it" is a web sentence. The phone's export
  // leaves out the contents of attached documents (screens.json exportNote says
  // so on the phone itself) and Transfer is what carries them, so a rights
  // bullet that promised one file with everything was untrue for phone users.
  it('says what a copy carries on each platform, not the web answer for both', () => {
    for (const text of [mdText, pageText]) {
      expect(text).toContain(
        'On the web, Settings → Download a backup exports all of it in one file, documents included.',
      )
      expect(text).toContain(
        'carries every record but not the contents of the documents you attached',
      )
      expect(text).toContain(
        'Transfer, under More, moves everything, documents included, to a computer.',
      )
    }
  })
})
