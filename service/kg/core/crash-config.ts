/**
 * L1 — whether crash reporting is on, decided in one place.
 *
 * TWO DIALS, and they are not the same question. A BUILD sets what a copy of
 * jojo is capable of: a build with reporting compiled out cannot report however
 * the settings are edited, which is what somebody packaging jojo for a
 * privacy-sensitive audience needs. A USER sets whether the capability is used.
 * The build can only ever take away.
 *
 * ON BY DEFAULT once a build allows it — changed deliberately, and the reasoning
 * is worth keeping because it used to be the other way round.
 *
 * The old default was off, on the argument that jojo's own copy ("nothing is
 * uploaded anywhere") had to stay true for anybody who had not deliberately made
 * it false. That copy has been corrected instead: what the app now claims, on
 * every screen that mentions this, is the narrower thing that stays true either
 * way — no RECORD of yours leaves, which `core/crash.ts` and `core/analytics.ts`
 * enforce rather than promise.
 *
 * The reason to flip it is that opt-in reporting from a product with no backend
 * produces a sample of people who go looking through Settings, which is not the
 * population whose crashes matter. The cost is that a build shipped to the EU
 * needs its consent step SEEN before first use rather than merely available —
 * which is why the setup flow asks on the last page and Settings keeps both
 * switches, and why the build dial below still exists: a packager who needs
 * opt-in ships with the capability off and turns nothing on.
 *
 * The BUILD dial is unchanged and still can only take away.
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
  /*
   * True, and it only ever applies where a build already said `allowed` —
   * `crashReportingOn` needs both, so this cannot switch anything on by itself.
   * The stored answer, once somebody gives one, always wins over this.
   */
  enabled: true,
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
