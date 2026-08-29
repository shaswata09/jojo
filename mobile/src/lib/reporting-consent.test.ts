/**
 * Nothing reports before the question has been asked, on either dial.
 *
 * Two defects, one audit, and they compose into the same first launch.
 *
 * 1. `analyticsEnabled()` and `crashEnabled()` read an unset preference as
 *    `CRASH_DEFAULTS.enabled`, which is true. On a fresh install nobody has
 *    been asked anything, so `index.ts` handed both SDKs a yes and sent
 *    `app_opened` before `ReportingStep` had rendered. Measured on an empty
 *    AsyncStorage: both returned true.
 *
 * 2. There was no `mobile/firebase.json`, so every build-time dial in
 *    `@react-native-firebase` took its own default of ON — including
 *    `crashlytics_auto_collection_enabled`, which the Crashlytics init provider
 *    applies at PROCESS start, and
 *    `crashlytics_is_error_generation_on_js_crash_enabled`, which installs an
 *    SDK-owned global error handler that ships the RAW `error.message` and so
 *    walks straight past `core/crash.ts`'s redaction.
 *
 * WHY THE SECOND HALF IS TESTED BY READING A FILE. It has to be: those keys are
 * consumed by gradle and by `pod install`, never by JavaScript, and the only
 * thing this runner can prove is that the file says what the two modules'
 * headers claim it says. That is worth more than it sounds — a key deleted in a
 * merge, or misspelled, is silently ignored by both toolchains and produces a
 * build that collects by default with nothing anywhere to say so. The spelling
 * is checked against the schema shipped by the installed SDK for the same
 * reason.
 *
 * D20: no component is mounted. The consent gate lives in these two modules
 * rather than in the sheet precisely so that it can be asserted here.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** One string per key, which is all AsyncStorage is. */
const disk = new Map<string, string>()

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (k: string) => Promise.resolve(disk.get(k) ?? null),
    setItem: (k: string, v: string) => {
      disk.set(k, v)
      return Promise.resolve()
    },
    multiGet: (keys: string[]) =>
      Promise.resolve(keys.map((k) => [k, disk.get(k) ?? null] as [string, string | null])),
  },
}))

const { analyticsEnabled } = await import('./analytics')
const { crashEnabled } = await import('./crash')

/** The key `lib/onboarding.ts` writes when the reporting sheet is dismissed. */
const ASKED = 'jojo/onboarding/reporting'

beforeEach(() => {
  disk.clear()
})

describe.each([
  ['analytics', 'jojo/analytics/v1', analyticsEnabled],
  ['crash reporting', 'jojo/crash-reporting/v1', crashEnabled],
] as const)('%s', (_name, key, enabled) => {
  it('is off on a fresh install, where the question has not been asked yet', async () => {
    // The whole defect in one assertion. `index.ts` calls `setUp` and then
    // `report('app_opened')` before any screen exists; if this is true there,
    // the SDK is told yes by somebody who has been told nothing.
    expect(await enabled()).toBe(false)
  })

  it('takes the default once the question HAS been asked and left unanswered', async () => {
    // `ReportingStep` writes an answer on every exit path, so this is the
    // narrow case where the write itself failed. `CRASH_DEFAULTS.enabled` is
    // what settles it, and it must keep settling it — the fix is a second
    // condition on the unset case, not a new default of off.
    disk.set(ASKED, '2026-08-26T00:00:00.000Z')
    expect(await enabled()).toBe(true)
  })

  it('keeps an explicit yes', async () => {
    disk.set(ASKED, '2026-08-26T00:00:00.000Z')
    disk.set(key, 'on')
    expect(await enabled()).toBe(true)
  })

  it('keeps an explicit no across restarts', async () => {
    disk.set(ASKED, '2026-08-26T00:00:00.000Z')
    disk.set(key, 'off')
    expect(await enabled()).toBe(false)
  })

  it('honours a stored answer even if the stage was never marked', async () => {
    // Storage is two independent writes and they can land apart. A person who
    // has plainly answered must not be re-gated by the marker: the marker
    // decides the UNSET case only.
    disk.set(key, 'on')
    expect(await enabled()).toBe(true)
  })
})

describe('mobile/firebase.json', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  const config: unknown = JSON.parse(readFileSync(path.join(root, 'firebase.json'), 'utf8'))
  const dials = (config as { 'react-native': Record<string, unknown> })['react-native']

  it('exists, with the root key the SDKs actually read', () => {
    // `firebase-json.gradle` reads `json['react-native']` and nothing else; a
    // file with the dials at the top level parses, is found, and does nothing.
    expect(dials).toBeTypeOf('object')
  })

  it.each([
    // Collection off until the user says yes. These are the two the runtime
    // switches later override; the rest below cannot be overridden and should
    // not be.
    'analytics_auto_collection_enabled',
    'crashlytics_auto_collection_enabled',
    'app_data_collection_default_enabled',
    // The SDK's own global error handler, which sends `error.message` raw.
    // `recordCrash` sending only the redacted text is worth nothing while this
    // is on, because this path does not go through `recordCrash`.
    'crashlytics_is_error_generation_on_js_crash_enabled',
    // Identifiers and advertising signals for a product that has no ads.
    'google_analytics_automatic_screen_reporting_enabled',
    'google_analytics_adid_collection_enabled',
    'google_analytics_ssaid_collection_enabled',
    'analytics_idfv_collection_enabled',
    'analytics_default_allow_ad_storage',
    'analytics_default_allow_ad_user_data',
    'analytics_default_allow_ad_personalization_signals',
  ])('turns %s off', (dial) => {
    // `toBe(false)` rather than `toBeFalsy`: a missing key is `undefined`, is
    // falsy, and is exactly the state that made the SDK default to ON.
    expect(dials[dial]).toBe(false)
  })

  it.each([
    // Both are permanent: set in the config, no JavaScript can lift them. They
    // would turn the user's yes into a no with no way to tell from the app,
    // which is the same class of failure as reporting without a yes.
    'analytics_collection_deactivated',
    'perf_collection_deactivated',
  ])('does not set the irreversible %s', (dial) => {
    expect(dials[dial]).toBeUndefined()
  })

  it('spells every dial the way the installed SDK spells it', () => {
    // An unrecognised key is not an error anywhere in the toolchain — gradle
    // and the podspec copy the JSON through and the native side looks up names
    // it knows. A typo here is a silent revert of this whole fix, so the names
    // are checked against the schema that ships with the version installed.
    const schema: unknown = JSON.parse(
      readFileSync(
        path.join(root, 'node_modules', '@react-native-firebase', 'app', 'firebase-schema.json'),
        'utf8',
      ),
    )
    const known = Object.keys(
      (schema as { properties: { 'react-native': { properties: Record<string, unknown> } } })
        .properties['react-native'].properties,
    )

    // If this reads 0 the schema has moved rather than the keys being right,
    // and the loop below would pass while checking nothing.
    expect(known.length).toBeGreaterThan(10)
    for (const dial of Object.keys(dials)) expect(known).toContain(dial)
  })
})
