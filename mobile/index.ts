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
 * Not awaited: nothing here should hold the first frame. The SDK's own default
 * is settled inside `analytics.ts` before any event of jojo's can be reported.
 */
void setUpAnalytics().then(() => report('app_opened', {}))

/*
 * The same handshake for Crashlytics, and it is required rather than tidy.
 *
 * `AndroidManifest.xml` starts the SDK with collection OFF on every launch, so
 * that a crash during startup is never sent by somebody who was never asked.
 * Without this line that default would never be lifted and the switch in
 * Settings would be decoration.
 */
void setUpCrashReporting()

AppRegistry.registerComponent('main', () => App)
