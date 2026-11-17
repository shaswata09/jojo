/**
 * Review 2026-11-17 (i18n-1, i18n-2, i18n-3, i18n-6, i18n-7): five places put
 * a sentence core writes in English into a translated screen — the
 * profile-read consent banner, the duplicate warning at Save, an offer's
 * "Respond by" date, the application picker's label and why a captured page
 * was refused. Each now goes through `domain`, whose English equals core's
 * (`domain-text.test.ts`). These guards keep the English helpers out of the
 * screens that show them.
 */

import { describe, expect, it } from 'vitest'
import profileOffer from '@/components/profile/ProfileUpdateOffer.tsx?raw'
import applicationDialog from '@/components/applications/ApplicationDialog.tsx?raw'
import offerBlock from '@/components/applications/OfferBlock.tsx?raw'
import applicationPicker from '@/components/vault/ApplicationPicker.tsx?raw'
import captureInbox from '@/components/vault/CaptureInbox.tsx?raw'
import captureBridge from '@/lib/capture-bridge.ts?raw'

/** Code only: a comment may still name the English helper it stands in for. */
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('core English kept out of translated screens', () => {
  for (const [file, raw, english, translated] of [
    [
      'components/profile/ProfileUpdateOffer.tsx',
      profileOffer,
      'twinOfferCopy',
      'domain.twinOffer(',
    ],
    [
      'components/applications/ApplicationDialog.tsx',
      applicationDialog,
      'duplicateMessage',
      'domain.duplicate(',
    ],
    [
      'components/applications/OfferBlock.tsx',
      offerBlock,
      'respondByLabel',
      'domain.shortDate(offer.respondBy)',
    ],
    [
      'components/vault/ApplicationPicker.tsx',
      applicationPicker,
      'applicationsLabel',
      'domain.picked(',
    ],
    [
      'components/vault/CaptureInbox.tsx',
      captureInbox,
      'CAPTURE_REJECTION_MESSAGE',
      'domain.captureRejected(',
    ],
    [
      'lib/capture-bridge.ts',
      captureBridge,
      'CAPTURE_REJECTION_MESSAGE',
      'domain.captureRejected(',
    ],
  ] as const) {
    it(`${file} says ${english}'s sentence in the language on screen`, () => {
      const text = code(raw)
      expect(text).not.toContain(english)
      expect(text).toContain(translated)
    })
  }
})
