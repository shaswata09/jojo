/**
 * The extension popup links the privacy notice (2026-11-21).
 *
 * The popup is plain JS with no build step, so it cannot import
 * `PRIVACY_URL` from core and spells the address itself. This holds the two
 * equal — a privacy link that drifts to a 404 looks like a notice was offered
 * and hides that it was not — and holds the control to the markup (D20: read
 * as source, as `popup-wiring.test.ts` does).
 */
import { describe, expect, it } from 'vitest'
import popupSource from '../../extension/popup.js?raw'
import popupHtml from '../../extension/popup.html?raw'
import { PRIVACY_URL } from '@jojo/service/core/privacy'

describe('the extension popup’s privacy link', () => {
  it('opens the same published notice core names', () => {
    expect(popupSource).toContain(`const PRIVACY_URL = '${PRIVACY_URL}'`)
    expect(popupSource).toMatch(
      /\$\('privacy'\)\.addEventListener\('click'[\s\S]*?chrome\.tabs\.create\(\{ url: PRIVACY_URL \}\)/,
    )
  })

  it('is a real control in the popup, labelled as the privacy notice', () => {
    expect(popupHtml).toMatch(
      /<button id="privacy" class="link" type="button">Privacy notice<\/button>/,
    )
  })
})
