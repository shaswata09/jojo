/**
 * Q247: the How you fit card has a Re-run control that reads the posting again
 * and replaces the stored reading.
 *
 * The control lives in JSX (D20: a narrow source read). What it sets off is held
 * in the service: `core/fit-request.test.ts` ("re-reads a cached posting when
 * the person asks again") and `tools/fit.test.ts` ("replaces a reading rather
 * than merging with it").
 */

import { describe, expect, it } from 'vitest'
import panel from './FitPanel.tsx?raw'
import en from '@/i18n/locales/en/applications.json'

describe('Q247 — the How you fit card offers Re-run', () => {
  it('is the card titled How you fit', () => {
    expect(panel).toMatch(
      /<h2 id=\{`fit-\$\{applicationId\}`\}[\s\S]*?\{t\('fit\.title'\)\}\s*<\/h2>/,
    )
    expect(en.fit.title).toBe('How you fit')
  })

  it('has a Re-run item wired to the hook’s rerun', () => {
    expect(panel).toMatch(
      /<MenuItem icon=\{RotateCw\} onSelect=\{fit\.rerun\}>\s*\{fit\.cleared \? t\('fit\.measure'\) : t\('fit\.rerun'\)\}/,
    )
    expect(en.fit.measure).toBe('Measure this posting')
    expect(en.fit.rerun).toBe('Re-run')
  })

  it('offers the same rerun after a failed read', () => {
    expect(panel).toMatch(/onClick=\{fit\.rerun\}>\s*\{t\('common\.tryAgain'\)\}/)
    expect(en.common.tryAgain).toBe('Try again')
  })
})
