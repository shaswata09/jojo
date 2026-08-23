/**
 * Asking for the camera, at the moment it is needed and not before.
 *
 * jojo has never asked for a camera, and the manifest and `Info.plist` entries
 * that make it possible were added for exactly one screen: reading the pairing
 * code off another device. So this is deliberately not a startup concern — a
 * permission prompt on first launch, for a feature most people never open, is
 * the kind of thing that gets an app declined by default.
 *
 * ## The two platforms ask differently, and only one of them can be asked twice
 *
 * ANDROID has an explicit runtime request, and a "don't ask again" state that
 * `request()` reports as `never_ask_again`. That state is permanent as far as
 * the app is concerned: calling `request()` again returns immediately without
 * showing anything. A screen that keeps offering a button that does nothing is
 * worse than one that says "this is in Settings now", so the two denials are
 * kept distinct here.
 *
 * IOS has no equivalent API in React Native's own surface. The system prompt
 * appears the first time the camera is actually used and never again, so
 * `ensureCamera` reports `granted` optimistically there and lets the camera
 * view itself be the thing that triggers the prompt. That is not a shortcut —
 * it is how the platform works, and pretending otherwise would mean a second,
 * jojo-drawn prompt in front of the real one.
 */

import { PermissionsAndroid, Platform } from 'react-native'

export type CameraAccess =
  /** Usable now. */
  | 'granted'
  /** Refused this time. Asking again is allowed and may work. */
  | 'denied'
  /** Refused permanently. Only Settings can change it — do not offer a retry. */
  | 'blocked'

export async function ensureCamera(): Promise<CameraAccess> {
  if (Platform.OS !== 'android') {
    // See the note above: iOS prompts on first use, from the camera view.
    return 'granted'
  }

  // Asked first, because `request()` on an already-granted permission is a
  // no-op that still costs a bridge round trip on every mount of the screen.
  if (await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA)) return 'granted'

  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA, {
    title: 'Read the pairing code',
    message:
      'jojo needs the camera to read the code shown on your other device. Nothing is recorded, and no image leaves this phone.',
    buttonPositive: 'Allow',
    buttonNegative: 'Not now',
  })

  if (result === PermissionsAndroid.RESULTS.GRANTED) return 'granted'
  // `never_ask_again` is the one that must not be retried: the system will not
  // show the prompt again, so a retry button would do nothing at all.
  if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) return 'blocked'
  return 'denied'
}

/** What to say, and whether offering a retry would be honest. */
export const CAMERA_REFUSED: Record<Exclude<CameraAccess, 'granted'>, string> = {
  denied: 'jojo needs the camera to read the code on your other device.',
  blocked:
    'The camera is turned off for jojo. Turn it on in your phone’s Settings, under Apps, to pair by scanning.',
}
