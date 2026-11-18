/**
 * Q329 (superseding Q124) and Q125: the computer shows the pairing key as a
 * standard QR code, and only the phone reads it with a camera.
 *
 * That the code itself works — the drawn symbol reads back as the exact offer
 * bytes, and a stranger's QR code is ignored — is
 * `mobile/src/lib/pairing-qr.test.ts`, which draws with the web's encoder and
 * reads with the phone's decoder. This pins the decisions around it, as source
 * and manifests (D20): which library does each half, where the code is drawn,
 * that the phone is the one that reads it, and that the column beside the stage
 * on the web page is transfer details rather than a second code.
 */

import { describe, expect, it } from 'vitest'
import transferSource from './Transfer.tsx?raw'
import pairingSource from '@/lib/pairing-session.ts?raw'
import stageSource from '@/components/transfer-ui/TransferStage.tsx?raw'
import sceneSource from '@/components/transfer/DataTransferScene.tsx?raw'
import scannerSource from '../../../mobile/src/components/transfer/PairingScanner.tsx?raw'
import webManifest from '../../package.json'
import mobileManifest from '../../../mobile/package.json'

/** Every non-test source file in this app, as text. */
const webSources = import.meta.glob(['/src/**/*.{ts,tsx}', '!/src/**/*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const strip = (source: string) =>
  source.replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')

describe('the key is a standard QR code (Q329)', () => {
  it('draws it with uqr on the computer and reads it with jsqr on the phone, both pinned', () => {
    // Exact versions: a pairing code is the one place two builds must agree.
    expect(webManifest.dependencies).toHaveProperty('uqr', '0.1.3')
    expect(mobileManifest.dependencies).toHaveProperty('jsqr', '1.4.0')
  })

  it('draws the pairing offer as a QR code on the stage card, and the scene carries nothing', () => {
    expect(strip(pairingSource)).toContain('setOffer(encodeOffer(next.offer))')
    expect(strip(stageSource)).toMatch(/<PairingQrCard offer=\{showing\}/)
    expect(strip(sceneSource)).not.toMatch(/offer|frames/)
  })
})

describe('only the phone reads it (Q125)', () => {
  it('has the phone read the code out of camera frames', () => {
    const scanner = strip(scannerSource)
    expect(scanner).toContain("import { readPairingQr } from '@/lib/pairing-qr'")
    expect(scanner).toMatch(/readPairingQr\(gray, SIDE, SIDE\)/)
  })

  it('never opens a camera in the web app', () => {
    const scanners = Object.entries(webSources)
      .filter(([, source]) => /getUserMedia|BarcodeDetector/.test(source))
      .map(([file]) => file)
    expect(Object.keys(webSources).length).toBeGreaterThan(50)
    expect(scanners).toEqual([])
  })

  it('puts transfer details in the column beside the stage, not a second code', () => {
    const page = strip(transferSource)
    const column = page.slice(page.indexOf('<TransferStage'))
    expect(column).toMatch(/<DetailsPanel\b/)
    expect(page.match(/<PairingQrCard\b/g)).toBeNull()
  })
})

describe('the group hints count in words that agree (review 3: i18n-8)', () => {
  it('words each count by its own plural key and joins the pieces', async () => {
    const code = strip(transferSource)
    expect(code).toMatch(/links: t\('groups\.vault\.links', \{ count: links\.length \}\)/)
    expect(code).toMatch(
      /reminders: t\('groups\.timeline\.reminders', \{ count: reminders\.length \}\)/,
    )
    expect(code).toMatch(/matches: t\('groups\.scout\.matches', \{ count: matches\.length \}\)/)

    const { createInstance } = await import('i18next')
    const en = (await import('@/i18n/locales/en/transfer.json')).default
    const ar = (await import('@/i18n/locales/ar/transfer.json')).default
    const i18n = createInstance()
    await i18n.init({
      lng: 'en',
      resources: { en: { transfer: en }, ar: { transfer: ar } },
      ns: ['transfer'],
      defaultNS: 'transfer',
      interpolation: { escapeValue: false },
    })
    const vault = (lng: string, links: number, snippets: number) =>
      i18n.t('groups.vault.hint', {
        lng,
        links: i18n.t('groups.vault.links', { lng, count: links }),
        snippets: i18n.t('groups.vault.snippets', { lng, count: snippets }),
      })
    expect(vault('en', 1, 2)).toBe('1 link · 2 snippets')
    expect(
      i18n.t('groups.timeline.hint', {
        reminders: i18n.t('groups.timeline.reminders', { count: 1 }),
        events: i18n.t('groups.timeline.events', { count: 1 }),
      }),
    ).toBe('1 reminds you, 1 is a dated event')
    // Arabic's dual and its 3–10 plural are different words, not one form.
    expect(vault('ar', 2, 5)).toBe('2 رابطان · 5 مقتطفات')
  })
})
