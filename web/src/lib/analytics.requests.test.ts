import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Q175 / Q174 — usage analytics records only when it is enabled, and never
 * before the person has been asked.
 *
 * `analyticsOn()` is the one gate `report()` checks before anything reaches the
 * SDK, so it is what is tested: the build's capability AND the person's answer,
 * where an unanswered question is not an answer. The first-run bug this pins:
 * `app_opened` fired at module scope, before the setup step that asks had been
 * drawn, because an unset preference read as the default of on.
 */

/** A localStorage that lives for one test. */
function fakeWindow() {
  const store = new Map<string, string>()
  return {
    store,
    window: {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    },
  }
}

/** The setup step that asks about crash reports and usage — see `onboarding.ts`. */
const ASKED = 'jojo.onboarding.crash'

async function load(env: Record<string, string>) {
  vi.resetModules()
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
  return import('./analytics')
}

const ALLOWED_BUILD = { VITE_ANALYTICS: 'true', VITE_FIREBASE_APP_ID: '1:2:web:3', VITE_ANALYTICS_ID: 'G-TEST' }

let fake: ReturnType<typeof fakeWindow>
beforeEach(() => {
  fake = fakeWindow()
  vi.stubGlobal('window', fake.window)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('Q175: analytics records only when enabled', () => {
  it('stays off before the reporting question has been asked, whatever the build allows', async () => {
    const analytics = await load(ALLOWED_BUILD)
    expect(analytics.ANALYTICS_CAPABILITY).toBe('allowed')
    expect(analytics.analyticsEnabled()).toBe(false)
    expect(analytics.analyticsOn()).toBe(false)
  })

  it('stays off once asked and left unanswered, because the default is no', async () => {
    /*
     * Reversed on 2026-11-21 (see `core/crash-config.ts`): this used to read
     * as yes, which made a question nobody answered into consent. Asked-and-
     * unanswered is the narrow case where the setup step's own write failed,
     * or a build that asked nothing marked the stage anyway.
     */
    const analytics = await load(ALLOWED_BUILD)
    fake.store.set(ASKED, new Date(0).toISOString())
    expect(analytics.analyticsOn()).toBe(false)
  })

  it('is on after an explicit yes, and off again once declined', async () => {
    const analytics = await load(ALLOWED_BUILD)
    fake.store.set(ASKED, new Date(0).toISOString())
    analytics.setAnalyticsEnabled(true)
    expect(fake.store.get('jojo/analytics/v1')).toBe('on')
    expect(analytics.analyticsOn()).toBe(true)

    analytics.setAnalyticsEnabled(false)
    expect(fake.store.get('jojo/analytics/v1')).toBe('off')
    expect(analytics.analyticsOn()).toBe(false)
  })

  it('keeps a yes stored before the default changed, read exactly as before', async () => {
    // Somebody who already said yes is not silently opted out by the new
    // default: the default answers only the unanswered.
    const analytics = await load(ALLOWED_BUILD)
    fake.store.set(ASKED, new Date(0).toISOString())
    fake.store.set('jojo/analytics/v1', 'on')
    expect(analytics.analyticsOn()).toBe(true)
  })

  it('stays off in a build without the capability, even after a yes', async () => {
    const analytics = await load({ VITE_ANALYTICS: '', VITE_FIREBASE_APP_ID: '1:2:web:3', VITE_ANALYTICS_ID: 'G-TEST' })
    fake.store.set(ASKED, new Date(0).toISOString())
    analytics.setAnalyticsEnabled(true)
    expect(analytics.ANALYTICS_CAPABILITY).toBe('off')
    expect(analytics.analyticsOn()).toBe(false)
  })
})
