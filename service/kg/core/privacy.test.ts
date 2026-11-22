import { describe, expect, it } from 'vitest'
import { PRIVACY_PAGE, PRIVACY_URL } from './privacy'

/**
 * The privacy notice's address, pinned.
 *
 * Every consent screen links to it, so a typo here is a consent screen whose
 * "Privacy notice" link goes nowhere — on the phone and in the extension, where
 * nothing else would notice. The two spellings must also name the same file,
 * or the web would open one notice and the phone another.
 */
describe('where the privacy notice lives', () => {
  it('is a relative file name for the web, so it resolves under any base URL', () => {
    expect(PRIVACY_PAGE).toBe('privacy.html')
    expect(PRIVACY_PAGE.startsWith('/')).toBe(false)
  })

  it('is an absolute https address for the apps with no base URL', () => {
    expect(PRIVACY_URL).toBe('https://shaswata09.github.io/jojo/privacy.html')
    expect(new URL(PRIVACY_URL).protocol).toBe('https:')
  })

  it('names the same file in both spellings', () => {
    expect(PRIVACY_URL.endsWith(`/${PRIVACY_PAGE}`)).toBe(true)
  })
})
