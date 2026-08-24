/**
 * L1 — whether crash reporting is on, decided in one place.
 *
 * TWO DIALS, and they are not the same question. A BUILD sets what a copy of
 * jojo is capable of: a build with reporting compiled out cannot report however
 * the settings are edited, which is what somebody packaging jojo for a
 * privacy-sensitive audience needs. A USER sets whether the capability is used.
 * The build can only ever take away.
 *
 * OFF BY DEFAULT, and this is a promise rather than a preference. jojo's README
 * says "there is no account, no backend of ours, and nothing is uploaded
 * anywhere", and the Assistant screen says "Nothing is sent anywhere else".
 * Those sentences have to stay true for anybody who has not deliberately made
 * them false, so the default is off and the switch is opt-in. A default-on
 * reporter would make the app's own copy a lie on first launch.
 *
 * NO NETWORK HERE, as everywhere in core. This decides; an app shell injects
 * something that can send. Firebase Crashlytics is a native SDK and lives in
 * `mobile/`; the browser has no Crashlytics at all — Google does not ship one —
 * so `web/` keeps its reports on the device and shows them in Diagnostics.
 */

/** What a build allows. `off` compiles the capability out of reach. */
export type CrashCapability = 'allowed' | 'off'

export type CrashSettings = {
  /** The user's answer. Meaningless when the build says `off`. */
  enabled: boolean
}

export const CRASH_DEFAULTS: CrashSettings = {
  // See the header: the app's own copy is only true while this is false.
  enabled: false,
}

/**
 * Reads a build flag out of whatever the platform calls its config.
 *
 * Deliberately permissive about the shape and strict about the meaning: only an
 * explicit, recognisable "yes" allows it. An unset variable, a typo, a `"maybe"`
 * — every one of those is `off`, because the failure that matters here is
 * reporting when nobody asked, not failing to report when they did.
 */
export function crashCapability(raw: string | boolean | undefined | null): CrashCapability {
  if (raw === true) return 'allowed'
  if (typeof raw !== 'string') return 'off'
  const value = raw.trim().toLowerCase()
  return value === 'true' || value === '1' || value === 'on' || value === 'yes' ? 'allowed' : 'off'
}

/**
 * The only question the rest of the app should ask.
 *
 * Both dials, in one predicate, so no caller has to remember that a build can
 * veto a setting. Written as `capability === 'allowed' && settings.enabled` and
 * not as `!disabled` anywhere: a double negative is how a reporting flag gets
 * inverted by somebody refactoring in a hurry.
 */
export function crashReportingOn(
  capability: CrashCapability,
  settings: Pick<CrashSettings, 'enabled'>,
): boolean {
  return capability === 'allowed' && settings.enabled === true
}
