import { AppRegistry } from 'react-native'

import '@/lib/polyfills'
import { installLastResortHandlers } from '@/lib/last-resort'
import { report, setUp as setUpAnalytics } from '@/lib/analytics'
import { setUp as setUpCrashReporting } from '@/lib/crash'
import App from './App'

/*
 * The name registered here is a contract with three other files, and nothing
 * checks it: `MainActivity.getMainComponentName()` on Android and
 * `AppDelegate`'s `moduleName` on iOS both hand Metro the string "main" and
 * expect a component back. A mismatch is a runtime blank screen, not a build
 * error.
 *
 * This used to be `registerRootComponent(App)` from `expo`, which called
 * exactly this line and then set up Expo Go's environment. There is no Expo Go
 * here any more, so what is left is the one line it was wrapping.
 *
 * Polyfills are imported above the app, not beside it: `App` pulls in the
 * storage layer, and the storage layer touches `structuredClone` and `URL` as
 * soon as it evaluates.
 */
/*
 * Before the app, so a failure while the store is booting is still reported.
 * The error boundary in `App.tsx` covers render; this covers everything else —
 * unawaited promises, timers, native callbacks.
 */
installLastResortHandlers()

/*
 * BEFORE the app, and this is the load-bearing half of the analytics work.
 *
 * Firebase Analytics starts collecting the moment the native SDK initialises —
 * screen views, session starts, first opens — whether or not this app ever calls
 * it. `setUp` turns that OFF unless the build allows analytics and the person
 * using it has said yes, so the switch in Settings governs everything rather
 * than only the events jojo writes by hand. Running it after the first screen
 * mounted would leave a window where automatic events were sent regardless.
 *
 * EVEN THIS IS TOO LATE ON ITS OWN, which is why `mobile/firebase.json` exists:
 * the native SDK is up before Metro has evaluated a line of this file, so the
 * build-time dials there are what cover the gap. This line covers everything
 * after it. See `lib/analytics.ts` for the key-by-key reasoning.
 *
 * `app_opened` is inside the `.then` rather than beside it because `setUp` is
 * what settles the SDK's collection state; reporting first would send an event
 * through a collector that had not been told the answer yet. On a fresh install
 * it sends nothing at all — `analyticsEnabled()` is false until `ReportingStep`
 * has been shown, and `report` checks it. That is the intended shape: the first
 * launch of a never-asked phone is silent, and the second one is not.
 *
 * Not awaited: nothing here should hold the first frame.
 */
void setUpAnalytics().then(() => report('app_opened', {}))

/*
 * The same handshake for Crashlytics, and it is required rather than tidy.
 *
 * The SDK comes up with collection off on every launch — from
 * `firebase.json`'s `crashlytics_auto_collection_enabled`, NOT from jojo's
 * `AndroidManifest.xml`, which this comment used to name and which sets nothing
 * of the sort; `lib/crash.ts`'s `applyCollection` has the full chain. So a crash
 * during startup is never sent by somebody who was never asked. Without this
 * line that default would never be lifted and the switch in Settings would be
 * decoration.
 */
void setUpCrashReporting()

AppRegistry.registerComponent('main', () => App)
