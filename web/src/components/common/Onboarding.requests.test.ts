import { describe, expect, it } from 'vitest'
import onboardingSource from './Onboarding.tsx?raw'
import settingsSource from '@/routes/Settings.tsx?raw'
import crashPanelSource from '@/components/settings/CrashPanel.tsx?raw'
import { nextSetupStage } from '@/lib/onboarding'

// @ts-expect-error TS2307 — node:fs has no types under tsconfig.app.json; the phone's sources are outside this app.
const fs = (await import('node:fs')) as { readFileSync: (p: string, enc: 'utf8') => string }

/** Repo-relative from this file's directory (web/src/components/common). */
const ROOT = new URL('../../../../', import.meta.url).pathname
const mobile = (rel: string) => fs.readFileSync(`${ROOT}mobile/src/${rel}`, 'utf8')

/**
 * Q174 — crash reporting asks first, on the last setup step, and Settings can
 * change the answer, on both platforms.
 *
 * D20 rules out mounting the dialog sequence; its order is `nextSetupStage`, a
 * plain function. That order is the decision: the question comes after every
 * other setup step and before the tour, because the tour navigates away the
 * moment it is accepted. The phone's order is still only branch order in its
 * component, so it is read from source. What the answer then does is tested in
 * `analytics.requests.test.ts` and `core/crash.test.ts`.
 */

/** Position of a branch in the source, failing loudly if it is gone. */
function at(source: string, needle: string): number {
  const i = source.indexOf(needle)
  expect(i, needle).toBeGreaterThan(-1)
  return i
}

describe('Q174: the reporting question and the switch that changes it', () => {
  it('asks on the web as the last setup step, after the others and before the tour', () => {
    const none = { details: false, model: false, reader: false, extension: false, crash: false, tour: false }
    const gate = (offered: Partial<typeof none>) => ({
      fresh: false,
      isBlank: false,
      modelConfigured: true,
      offered: { ...none, ...offered },
    })
    // Not before any other setup step…
    expect(nextSetupStage(gate({}))).toBe('model')
    expect(nextSetupStage(gate({ model: true }))).toBe('extension')
    expect(nextSetupStage(gate({ model: true, extension: true }))).toBe('reader')
    // …then it, and only then the tour.
    expect(nextSetupStage(gate({ model: true, extension: true, reader: true }))).toBe('crash')
    expect(nextSetupStage(gate({ model: true, extension: true, reader: true, crash: true }))).toBe('tour')
    // And the sequencer shows the reporting step for that stage.
    expect(onboardingSource).toMatch(/return <CrashStep onSkip=\{\(\) => finish\('crash'\)\}/)
  })

  it('asks on the phone before the tour, too', () => {
    const source = mobile('components/common/Onboarding.tsx')
    const ask = at(source, 'if (!offered.reporting && REPORTING_ASKABLE) {')
    expect(at(source, 'return <ReportingStep ')).toBeGreaterThan(ask)
    expect(ask).toBeLessThan(at(source, 'if (!offered.tour) {'))
  })

  it('lets Settings turn crash reports and usage on and off, on both platforms', () => {
    expect(settingsSource).toContain('<CrashPanel />')
    expect(crashPanelSource).toMatch(/setCrashEnabled\(next\)/)
    expect(crashPanelSource).toMatch(/setAnalyticsEnabled\(next\)/)

    expect(mobile('screens/SettingsScreen.tsx')).toContain('<CrashPanel />')
    const phonePanel = mobile('components/common/CrashPanel.tsx')
    expect(phonePanel).toMatch(/setCrashEnabled\(next\)/)
    expect(phonePanel).toMatch(/setAnalyticsEnabled\(next\)/)
  })
})
