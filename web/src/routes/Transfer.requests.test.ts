/**
 * Q124 and Q125: the transfer animation is jojo's own glowing-dot code, not a
 * QR code, and only the phone reads it with a camera.
 *
 * That the code itself works — encode, survive a real camera, decode — is
 * `service/kg/core/pulse.test.ts`, `pulse-read.test.ts` and `pulse-seam.test.ts`.
 * This pins the decisions around it, as source and manifests (D20): no QR
 * library in either app, the web page draws the pulse frames and never opens a
 * camera, the phone is the one that reads them, and the column beside the
 * animation on the web page is transfer details rather than a code to scan.
 */

import { describe, expect, it } from 'vitest'
import transferSource from './Transfer.tsx?raw'
import pairingSource from '@/lib/pairing-session.ts?raw'
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

const dependencies = (manifest: { dependencies?: object; devDependencies?: object }) => [
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.devDependencies ?? {}),
]

describe('the animation carries its own code (Q124)', () => {
  it('ships no QR library in either app', () => {
    for (const manifest of [webManifest, mobileManifest]) {
      expect(dependencies(manifest).filter((name) => /qr/i.test(name))).toEqual([])
    }
  })

  it('encodes the pairing offer into pulse frames, and the scene draws those frames', () => {
    expect(strip(pairingSource)).toContain('planPulse(encodeOffer(next.offer)).frames')
    expect(strip(sceneSource)).toMatch(/import \{[^}]*\bPULSE_GRID\b[^}]*\} from '@jojo\/service\/core\/pulse'/)
  })
})

describe('only the phone reads it (Q125)', () => {
  it('has the phone decode camera frames with jojo’s own reader', () => {
    const scanner = strip(scannerSource)
    expect(scanner).toContain("import { readPulse } from '@jojo/service/core/pulse-read'")
    expect(scanner).toMatch(/readPulse\(gray, SIDE, SIDE\)/)
  })

  it('never opens a camera in the web app', () => {
    const scanners = Object.entries(webSources)
      .filter(([, source]) => /getUserMedia|BarcodeDetector/.test(source))
      .map(([file]) => file)
    expect(Object.keys(webSources).length).toBeGreaterThan(50)
    expect(scanners).toEqual([])
  })

  it('puts transfer details beside the animation on the web page, not a code', () => {
    const page = strip(transferSource)
    const column = page.slice(page.indexOf('<TransferStage'))
    expect(column).toMatch(/<DetailsPanel\b/)
    expect(page).not.toMatch(/<QR|qrcode/i)
  })
})
