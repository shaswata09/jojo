/**
 * L1 — whether crash reporting is on, decided in one place.
 *
 * TWO DIALS, and they are not the same question. A BUILD sets what a copy of
 * jojo is capable of: a build with reporting compiled out cannot report however
 * the settings are edited, which is what somebody packaging jojo for a
 * privacy-sensitive audience needs. A USER sets whether the capability is used.
 * The build can only ever take away.
 *
 * OFF BY DEFAULT, for everybody, until they say yes. This has gone back and
 * forth, and the history is worth keeping so it does not go round again.
 *
 * It started off, on the argument that jojo's own copy ("nothing is uploaded
 * anywhere") had to stay true for anybody who had not deliberately made it
 * false. It was then flipped ON, on the argument that opt-in reporting from a
 * product with no backend produces a sample of the people who go looking
 * through Settings, which is not the population whose crashes matter — and the
 * copy was narrowed to the claim that stays true either way: no RECORD of yours
 * leaves, which `core/crash.ts` and `core/analytics.ts` enforce rather than
 * promise.
 *
 * The owner reversed that on 2026-11-21, for consent law rather than for
 * sampling. A switch that is already on when somebody first sees it is a
 * pre-ticked box, and the EU's top court said in Planet49 (CJEU C-673/17, 2019)
 * that a pre-ticked box is not consent — the person has to DO something to say
 * yes. The ruling read the ePrivacy storage rule together with the GDPR's
 * meaning of consent, and the UK's PECR is the same rule under another name. Usage analytics writes an identifier to
 * the device and Crashlytics sends one, so both need a real yes, and a default
 * cannot give one. The sampling cost is real and is accepted: a biased sample
 * of consenting users is a better thing to have than an unbiased sample nobody
 * agreed to.
 *
 * What this changes for somebody who already answered: nothing. A stored
 * answer is read exactly as before and always wins over this default. What it
 * changes is the person who was never asked, or whose answer never got
 * written — they now read as no.
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
   * False: no until somebody says yes (see the header for why this stopped
   * being true on 2026-11-21). The setup step draws both switches from this,
   * so they start off, and somebody has to move one to report anything.
   * The stored answer, once somebody gives one, always wins over this.
   */
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
