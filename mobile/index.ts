import { AppRegistry } from 'react-native'

import '@/lib/polyfills'
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
AppRegistry.registerComponent('main', () => App)
