/**
 * The phone's BUILD switches for crash reporting and usage analytics.
 *
 * ## Why this is a file and not an environment variable
 *
 * The web app reads `VITE_CRASH_REPORTING` and `VITE_ANALYTICS`, because Vite
 * inlines those at build time. React Native has no equivalent: Metro replaces
 * `process.env.NODE_ENV` and nothing else, and `@react-native/babel-preset`
 * carries no environment-inlining plugin — verified against the preset rather
 * than assumed.
 *
 * These two constants used to be `process.env['CRASH_REPORTING']` and
 * `process.env['ANALYTICS']`, which read `undefined` on a device every time. The
 * capability was therefore always `off`, and the phone would have reported
 * nothing however the switches in Settings were set, with no error anywhere to
 * say so — the shape of bug this codebase treats as worst, because everything
 * looks like it is working.
 *
 * ## What these do and do not control
 *
 * These are the BUILD dial: what a copy of jojo is CAPABLE of. They can only
 * ever take away. Whether reporting actually happens needs all three of:
 *
 *   1. this file saying true,
 *   2. the Firebase config files being present in the native projects
 *      (`android/app/google-services.json`, `ios/jojo/GoogleService-Info.plist`)
 *      — both gitignored, so a fork has neither,
 *   3. the person using the app not having turned it off in Settings or in the
 *      setup flow.
 *
 * Somebody packaging jojo for an audience that must not report anything sets
 * both to `false` here, and no switch anywhere in the app can undo it.
 */

export const REPORTING = {
  /** Crashlytics. Reports carry the redacted message and stack, never a record. */
  crashes: true,
  /** Firebase Analytics. Events come from the closed list in `core/analytics.ts`. */
  analytics: true,
} as const
